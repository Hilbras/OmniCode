import { randomUUID } from 'node:crypto';

import { createDecorator, IInstantiationService } from '@hilbras/omnicode-base/di/instantiation';
import type { IDisposable } from '@hilbras/omnicode-base/di/lifecycle';
import type {
  BundledSkillActivation,
  PromptOrigin,
  SkillActivationOrigin,
} from '#/agent/contextMemory/types';
import { IAgentLoopService, type PromptLaunchResult, type Turn } from '#/agent/loop/loop';
import { promptMetadataTextFromContentParts } from '#/agent/prompt/promptMetadataText';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { IEventService } from '#/app/event/event';
import { IEventBus } from '#/app/event/eventBus';
import { ITelemetryService } from '#/app/telemetry/telemetry';
import { TurnEnded } from '#/agent/loop/turnOps';
import { IAgentToolRegistryService } from '#/agent/toolRegistry/toolRegistry';
import { ErrorCodes, Error2 } from '#/errors';
import { ISkillCuratorService } from '#/features/skill/curator/curatorService';
import type { ContentPart } from '#human/llm/message';
import { skillActivationPart } from '#human/agent/origin';
import { MAIN_AGENT_ID } from '#/session/agentLifecycle/agentLifecycle';
import { ISessionContext } from '#/session/sessionContext/sessionContext';
import { ISessionMetadata } from '#/session/sessionMetadata/sessionMetadata';
import { applyPromptMetadataUpdate } from '#/session/sessionMetadata/promptMetadata';
import { IEventDispatcher } from '#/state/eventDispatcher';
import { IAgentLLMRequesterService } from '#/agent/llmRequester/llmRequester';
import { IAgentToolExecutorService } from '#/agent/toolExecutor/toolExecutor';

import { isUserActivatableSkillType, type SkillDefinition } from './catalog/types';
import { promptMetadataTextFromSkill, renderUserSlashSkillPrompt } from './prompt';
import { ISessionSkillCatalog } from './session/skillCatalog';
import type {
  PromptSkillActivation,
  PromptWithSkillsInput,
  PromptWithSkillsResult,
  SkillActivationInput,
} from './skill';
import { SkillActivated } from './skillOps';
import {
  SkillToolEnforcer,
  labelSkillContent,
  type IActiveSkillGrant,
} from './enforcement';

export interface IAgentSkillService {
  readonly _serviceBrand: undefined;
  activate(input: SkillActivationInput): Promise<PromptLaunchResult>;
  promptWithSkills(input: PromptWithSkillsInput): Promise<PromptWithSkillsResult>;
  recordModelToolActivation(origin: SkillActivationOrigin): void;
}

export const IAgentSkillService = createDecorator<IAgentSkillService>('agentSkillService');

export class AgentSkillService implements IAgentSkillService, IActiveSkillGrant {
  declare readonly _serviceBrand: undefined;

  constructor(
    @ISessionSkillCatalog private readonly catalog: ISessionSkillCatalog,
    @IAgentLoopService private readonly loop: IAgentLoopService,
    @ISessionMetadata private readonly metadata: ISessionMetadata,
    @IEventService private readonly eventService: IEventService,
    @ISessionContext private readonly sessionContext: ISessionContext,
    @ITelemetryService private readonly telemetry: ITelemetryService,
    @IEventDispatcher private readonly dispatcher: IEventDispatcher,
    @IAgentScopeContext private readonly scopeContext: IAgentScopeContext,
    @IEventBus eventBus?: IEventBus,
    @IAgentToolRegistryService private readonly toolRegistry?: IAgentToolRegistryService,
    @IAgentLLMRequesterService requester?: IAgentLLMRequesterService,
    @IInstantiationService private readonly instantiation?: IInstantiationService,
    @ISkillCuratorService private readonly curator?: ISkillCuratorService,
  ) {
    this.bindExecutorGrant();
    // Push the grant into the requester so it can narrow the offered tool list
    // without a DI dependency on this service (which would cycle through the loop).
    requester?.setSkillGrant?.(this);
    // A skill's tool grant lasts exactly one turn; it never leaks into the next.
    this.turnEndSubscription = eventBus?.subscribe(TurnEnded, () => this.enforcer.deactivate());
  }

  private readonly turnEndSubscription: IDisposable | undefined;

  /** Tool-grant boundary and provenance for the active skill turn. */
  readonly enforcer = new SkillToolEnforcer();

  /**
   * Binds the executor's skill guard. The executor is resolved lazily inside
   * this agent scope: injecting it would register an eager edge that the
   * tool-executor tests (which have no skill feature) cannot satisfy.
   */
  private bindExecutorGrant(): void {
    const instantiation = this.instantiation;
    if (instantiation === undefined) return;
    try {
      instantiation.invokeFunction((accessor) =>
        accessor.get(IAgentToolExecutorService).setSkillGrant?.(this),
      );
    } catch {
      // Executor not available in this scope; the request-path filter still applies.
    }
  }

  /**
   * Tools the profile would offer, narrowed by the active skill's grant. The
   * request path calls this; `enforcer.enforceTool` still refuses a call the
   * model makes for a hidden tool.
   */
  /** Wraps project/plugin skill text in an untrusted envelope before it reaches the model. */
  private labelContent(skill: Pick<SkillDefinition, 'name' | 'source' | 'path' | 'metadata'>, content: string): string {
    const trust = skill.source === 'project' || skill.source === 'extra' ? 'untrusted' as const : 'trusted' as const;
    return labelSkillContent(
      { skillName: skill.name, source: skill.source, path: skill.path, trust, activatedAt: Date.now() },
      content,
    );
  }

  allowedToolNames(): readonly string[] | undefined {
    const grant = this.enforcer.activeGrant();
    if (grant === undefined) return undefined;
    if (grant.allowedTools === undefined && grant.disallowedTools === undefined) return undefined;
    return this.enforcer.visibleTools(
      (this.toolRegistry?.list() ?? []).map((tool) => tool.name),
    );
  }

  visibleToolNames(): readonly string[] {
    const registry = this.toolRegistry;
    if (registry === undefined) return [];
    return this.enforcer.visibleTools(registry.list().map((tool) => tool.name));
  }

  async activate(input: SkillActivationInput): Promise<PromptLaunchResult> {
    const catalog = this.catalog;
    await catalog.ready;
    const skill = catalog.catalog.getSkill(input.name);
    if (skill === undefined) {
      throw new Error2(ErrorCodes.SKILL_NOT_FOUND, `Skill "${input.name}" was not found`);
    }
    if (!isUserActivatableSkillType(skill.metadata.type)) {
      throw new Error2(
        ErrorCodes.SKILL_TYPE_UNSUPPORTED,
        `Skill "${skill.name}" cannot be activated by the user`,
      );
    }

    this.enforcer.activate(skill);
    const skillArgs = input.args ?? '';
    const skillContent = this.renderSkillPrompt(skill, skillArgs);
    const content: ContentPart[] = [
      {
        type: 'text',
        text: renderUserSlashSkillPrompt({
          skillName: skill.name,
          skillArgs,
          skillContent: this.labelContent(skill, skillContent),
          skillSource: skill.source,
          skillDir: skill.dir,
        }),
      },
      ...(input.content ?? []),
    ];

    const turn = await this.recordActivation(
      {
        kind: 'skill_activation',
        activationId: randomUUID(),
        skillName: skill.name,
        trigger: 'user-slash',
        skillType: skill.metadata.type,
        skillPath: skill.path,
        skillSource: skill.source,
        skillArgs: input.args,
        attachments: input.attachments,
        clientMetadata: input.clientMetadata,
      },
      content,
    );
    if (turn === undefined) {
      throw new Error2(
        ErrorCodes.TURN_AGENT_BUSY,
        'Cannot activate skill while another turn is active',
      );
    }
    await turn.ready.catch(() => undefined);
    if (turn.id === undefined) {
      throw new Error2(ErrorCodes.INTERNAL, 'Skill activation turn ended before it started');
    }
    if (this.scopeContext.agentContext.agentId === MAIN_AGENT_ID) {
      await applyPromptMetadataUpdate(
        {
          metadata: this.metadata,
          eventService: this.eventService,
          sessionId: this.sessionContext.sessionId,
        },
        promptMetadataTextFromSkill(input),
      );
    }
    return { turn_id: turn.id };
  }

  async promptWithSkills(input: PromptWithSkillsInput): Promise<PromptWithSkillsResult> {
    if (input.input.length === 0) {
      throw new Error2(ErrorCodes.REQUEST_INVALID, 'promptWithSkills requires a non-empty prompt');
    }
    if (input.skills.length === 0) {
      throw new Error2(
        ErrorCodes.REQUEST_INVALID,
        'promptWithSkills requires at least one skill',
      );
    }
    const catalog = this.catalog;
    await catalog.ready;
    const prepared = input.skills.map((skill) => this.prepareBundled(skill));
    if (this.scopeContext.agentContext.agentId === MAIN_AGENT_ID) {
      await applyPromptMetadataUpdate(
        {
          metadata: this.metadata,
          eventService: this.eventService,
          sessionId: this.sessionContext.sessionId,
        },
        promptMetadataTextFromContentParts(input.input, input.clientMetadata),
      );
    }
    for (const activation of prepared) {
      void this.recordActivation(activation.origin);
    }
    const status = this.loop.snapshot();
    const { id } = this.loop.submit({
      message: {
        role: 'user',
        content: [...prepared.map((activation) => activation.part), ...input.input],
      },
      meta: {
        origin: {
          kind: 'user',
          skillActivations: prepared.map((activation) => activation.entry),
          clientMetadata: input.clientMetadata,
          attachments: input.attachments,
        } as PromptOrigin,
        tracked: true,
      },
    });
    const handle = this.loop.promptHandle(id)!;
    if (status.state === 'running' || status.paused || status.queue.length > 0) {
      return { prompt_id: id, created_at: handle.createdAt, state: 'queued' };
    }
    await Promise.race([handle.launched, handle.completion]);
    const turn = await handle.launched;
    if (turn === undefined && handle.state !== 'blocked') {
      throw new Error2(ErrorCodes.INTERNAL, 'promptWithSkills failed to launch a turn');
    }
    if (turn !== undefined) await turn.ready.catch(() => undefined);
    return {
      turn_id: turn?.id,
      prompt_id: id,
      created_at: handle.createdAt,
      state: handle.state === 'blocked' ? 'blocked' : 'running',
    };
  }

  recordModelToolActivation(origin: SkillActivationOrigin): void {
    this.armEnforcerForModelTool(origin);
    void this.recordActivation(origin);
  }

  /**
   * The Skill tool loads a skill mid-turn without launching a turn of its
   * own. The grant arms here from the same catalog the tool resolved the
   * skill from and clears on TurnEnded like every explicit activation. A
   * skill the catalog no longer knows arms without metadata, which records
   * provenance but leaves tools unrestricted rather than inventing a grant.
   */
  private armEnforcerForModelTool(origin: SkillActivationOrigin): void {
    const skill = this.catalog.catalog.getSkill(origin.skillName);
    const definition = skill ?? {
      name: origin.skillName,
      source: origin.skillSource ?? 'extra',
      path: origin.skillPath ?? '',
      metadata: {},
    };
    this.enforcer.activate(definition);
  }

  private prepareBundled(input: PromptSkillActivation): {
    readonly origin: SkillActivationOrigin;
    readonly part: ContentPart;
    readonly entry: BundledSkillActivation;
  } {
    const catalog = this.catalog;
    const skill = catalog.catalog.getSkill(input.name);
    if (skill === undefined) {
      throw new Error2(ErrorCodes.SKILL_NOT_FOUND, `Skill "${input.name}" was not found`);
    }
    if (!isUserActivatableSkillType(skill.metadata.type)) {
      throw new Error2(
        ErrorCodes.SKILL_TYPE_UNSUPPORTED,
        `Skill "${skill.name}" cannot be activated by the user`,
      );
    }

    this.enforcer.activate(skill);
    const skillArgs = input.args ?? '';
    const skillContent = this.renderSkillPrompt(skill, skillArgs);
    const activationId = randomUUID();
    const origin: SkillActivationOrigin = {
      kind: 'skill_activation',
      activationId,
      skillName: skill.name,
      trigger: 'user-slash',
      skillType: skill.metadata.type,
      skillPath: skill.path,
      skillSource: skill.source,
      skillArgs: input.args,
    };
    return {
      origin,
      part: skillActivationPart(
        renderUserSlashSkillPrompt({
          skillName: skill.name,
          skillArgs,
          skillContent: this.labelContent(skill, skillContent),
          skillSource: skill.source,
          skillDir: skill.dir,
        }),
        activationId,
      ),
      entry: {
        activationId: origin.activationId,
        skillName: origin.skillName,
        skillArgs: origin.skillArgs,
        skillType: origin.skillType,
        skillPath: origin.skillPath,
        skillSource: origin.skillSource,
      },
    };
  }

  private async recordActivation(
    origin: SkillActivationOrigin,
    input?: readonly ContentPart[],
  ): Promise<Turn | undefined> {
    await this.dispatcher.dispatch(
      new SkillActivated({
        agentId: this.scopeContext.agentContext.agentId,
        activationId: origin.activationId,
        skillName: origin.skillName,
        trigger: origin.trigger,
        skillArgs: origin.skillArgs,
        skillPath: origin.skillPath,
        skillSource: origin.skillSource,
      }),
    );
    this.publishActivation(origin);
    this.recordCuratorUsage(origin);

    if (input === undefined) return undefined;
    const steer = this.loop.snapshot().state === 'running';
    const { id } = this.loop.submit(
      {
        message: { role: 'user', content: [...input] },
        meta: { origin, tracked: !steer },
      },
      { steerIfActive: steer },
    );
    return this.loop.promptHandle(id)!.launched;
  }

  /**
   * Curation is bookkeeping, so a store failure must never fail the activation
   * being recorded: the write is fire-and-forget and its errors are dropped.
   * Activations with no resolved source or path carry no usable ref and are
   * skipped rather than recorded with invented provenance.
   */
  private recordCuratorUsage(origin: SkillActivationOrigin): void {
    const curator = this.curator;
    if (curator === undefined) return;
    const { skillSource, skillPath } = origin;
    if (skillSource === undefined || skillPath === undefined) return;
    void curator
      .recordUsage(
        { name: origin.skillName, source: skillSource, path: skillPath },
        { trigger: origin.trigger },
      )
      .catch(() => undefined);
  }

  private renderSkillPrompt(skill: SkillDefinition, rawArgs: string): string {
    return this.catalog.catalog.renderSkillPrompt(skill, rawArgs, {
      sessionId: this.sessionContext.sessionId,
    });
  }

  private publishActivation(origin: SkillActivationOrigin): void {
    this.telemetry.track2('skill_invoked', {
      skill_name: origin.skillName,
      trigger: origin.trigger,
    });
    if (origin.skillType === 'flow') {
      this.telemetry.track2('flow_invoked', {
        flow_name: origin.skillName,
      });
    }
  }
}
