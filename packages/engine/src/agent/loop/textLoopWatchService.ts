import { Disposable } from '@hilbras/omnicode-base/di/lifecycle';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { LifecycleScope } from '#/app/scopes';
import { IEventBus } from '#/app/event/eventBus';
import { IAgentReminderService } from '#/features/reminder/reminderService';
import { isReadOnlyToolName } from '#/tool/read-only-command';
import { ToolCallStarted, ToolResultEvent } from '#/agent/toolExecutor/toolExecutorEvents';

import { LoopSignalDetected, type LoopSignalKind } from './loopWatchEvents';
import { AssistantDelta, ThinkingDelta } from './turnEvents';
import { TurnEnded } from './turnOps';
import { TextLoopDetector, type TextLoopSignal } from './textLoopDetector';
import {
  ResultStagnationDetector,
  callSignatureOf,
  outputSignatureOf,
  type ResultStagnationSignal,
} from './resultStagnationDetector';
import {
  IAgentTextLoopWatchService,
  RESULT_STAGNATION_REMINDER_VARIANT,
  TEXT_LOOP_REMINDER_VARIANT,
  resolveLoopWatchConfig,
  type LoopWatchConfig,
  type LoopWatchConfigOverrides,
} from './textLoopWatch';

const LOOP_KIND_LABEL: Record<TextLoopSignal['kind'], string> = {
  'repeated-phrase': 'the same phrase was emitted repeatedly',
  'alternating-blocks': 'two blocks alternate back and forth',
  'periodic-text': 'the text restarts the same cycle',
};

const STAGNATION_KIND_LABEL: Record<ResultStagnationSignal['kind'], string> = {
  'repeated-result': 'the same call keeps returning the same result',
  'stateful-polling': 'a read is polling state it already observed',
  'read-churn': 'the agent keeps re-reading what it already read',
};

function reminderText(signal: TextLoopSignal): string {
  return [
    `Streamed output looks stuck: ${LOOP_KIND_LABEL[signal.kind]} (${signal.detail}).`,
    'Stop repeating it. State in one sentence what new information the next action should produce,',
    'then either take the cheapest action that could disprove the current approach, ask the user for the',
    'missing decision, or deliver the result you already have and name what remains uncertain.',
  ].join(' ');
}

function stagnationReminderText(signal: ResultStagnationSignal): string {
  return [
    `Tool results look stuck: ${STAGNATION_KIND_LABEL[signal.kind]} (${signal.detail}).`,
    'Repeating the same call will not produce new information. Say in one sentence what you expected the',
    'next result to change, then either try a materially different call, stop polling and act on what you',
    'already have, ask the user for the missing decision, or report the result you have and what remains',
    'uncertain.',
  ].join(' ');
}

/** Positive integer from env; anything else leaves the default untouched. */
export function resolveLoopReminderCap(env: NodeJS.ProcessEnv = process.env): number {
  return resolveLoopWatchConfig(env).reminderCap;
}

interface PendingToolCall {
  readonly name: string;
  readonly args: unknown;
}

/**
 * Watches the agent's *outputs* for two degenerate shapes and queues at most one
 * reminder per shape before the model's next step: repeated streamed prose
 * (`text_loop`) and repeated tool results (`result_stagnation`). It never
 * mutates history mid-stream and never stops a turn — a false positive costs
 * one sentence of context. A per-turn cap
 * (`OMNICODE_LOOP_REMINDER_CAP`, default 3) bounds how often either channel can
 * speak in one turn so a stuck agent is not nagged on every step.
 */
export class AgentTextLoopWatchService
  extends Disposable
  implements IAgentTextLoopWatchService
{
  declare readonly _serviceBrand: undefined;

  private readonly textDetector = new TextLoopDetector();
  private readonly stagnationDetector = new ResultStagnationDetector();
  private readonly pendingToolCalls = new Map<string, PendingToolCall>();

  private activeTurnId: number | undefined;
  private pendingText: TextLoopSignal | undefined;
  private pendingStagnation: ResultStagnationSignal | undefined;
  private remindersThisTurn = 0;

  private config: LoopWatchConfig;

  constructor(
    @IEventBus private readonly eventBus: IEventBus,
    @IAgentReminderService reminder: IAgentReminderService,
    env?: NodeJS.ProcessEnv,
    @IAgentScopeContext private readonly scopeContext?: IAgentScopeContext,
  ) {
    super();
    this.config = resolveLoopWatchConfig(env ?? process.env);

    this._register(
      eventBus.subscribe(AssistantDelta, (event) => this.observeText(event.turnId, event.delta)),
    );
    this._register(
      eventBus.subscribe(ThinkingDelta, (event) => this.observeText(event.turnId, event.delta)),
    );
    this._register(
      eventBus.subscribe(ToolCallStarted, (event) =>
        this.observeToolCall(event.turnId, event.toolCallId, event.name, event.args),
      ),
    );
    this._register(
      eventBus.subscribe(ToolResultEvent, (event) =>
        this.observeToolResult(event.turnId, event.toolCallId, event.output, event.synthetic === true),
      ),
    );
    this._register(eventBus.subscribe(TurnEnded, () => this.reset()));

    this._register(
      reminder.register(TEXT_LOOP_REMINDER_VARIANT, () => {
        const signal = this.pendingText;
        this.pendingText = undefined;
        if (signal === undefined || this.remindersThisTurn >= this.config.reminderCap) {
          return undefined;
        }
        this.remindersThisTurn += 1;
        return reminderText(signal);
      }),
    );
    this._register(
      reminder.register(RESULT_STAGNATION_REMINDER_VARIANT, () => {
        const signal = this.pendingStagnation;
        this.pendingStagnation = undefined;
        if (signal === undefined || this.remindersThisTurn >= this.config.reminderCap) {
          return undefined;
        }
        this.remindersThisTurn += 1;
        return stagnationReminderText(signal);
      }),
    );
  }

  configure(overrides: LoopWatchConfigOverrides): void {
    this.config = { ...this.config, ...overrides };
  }

  private observeText(turnId: number, delta: string): void {
    if (!this.config.textEnabled || delta.length === 0) return;
    if (this.syncTurn(turnId)) return;
    if (this.pendingText !== undefined) {
      this.textDetector.push(delta);
      return;
    }
    this.pendingText = this.textDetector.push(delta);
    this.announceSignal(turnId, 'text_loop', this.pendingText);
  }

  /**
   * One user-visible event per newly detected signal, mirroring the pending
   * reminder: a signal that is already pending (waiting for the reminder
   * slot) must not re-announce on every further matching delta. Advisory
   * only — the turn keeps running either way.
   */
  private announceSignal(
    turnId: number,
    kind: LoopSignalKind,
    signal: TextLoopSignal | ResultStagnationSignal | undefined,
  ): void {
    if (signal === undefined) return;
    this.eventBus.publish(
      new LoopSignalDetected({
        agentId: this.scopeContext?.agentId ?? '',
        turnId,
        kind,
        detail: signal.detail,
      }),
    );
  }

  private observeToolCall(
    turnId: number,
    toolCallId: string,
    name: string,
    args: unknown,
  ): void {
    if (!this.config.stagnationEnabled) return;
    if (this.syncTurn(turnId)) return;
    this.pendingToolCalls.set(toolCallId, { name, args });
  }

  private observeToolResult(
    turnId: number,
    toolCallId: string,
    output: unknown,
    synthetic: boolean,
  ): void {
    if (!this.config.stagnationEnabled) return;
    const call = this.pendingToolCalls.get(toolCallId);
    if (call === undefined) return;
    this.pendingToolCalls.delete(toolCallId);

    // Synthetic results are produced by the runtime itself (aborts, permission
    // refusals, dedupe replays); they say nothing about workspace state.
    if (synthetic) return;
    if (this.syncTurn(turnId)) return;
    if (this.pendingStagnation !== undefined) return;

    this.pendingStagnation = this.stagnationDetector.push({
      name: call.name,
      callSignature: callSignatureOf(call.name, call.args),
      outputSignature: outputSignatureOf(output),
      readOnly: isReadOnlyToolName(call.name),
    });
    this.announceSignal(turnId, 'result_stagnation', this.pendingStagnation);
  }

  /**
   * Aligns the watchers with the turn that just produced an observation.
   * Returns true when the observation belongs to an older turn that ended
   * without a `TurnEnded` (late event) and must be ignored.
   */
  private syncTurn(turnId: number): boolean {
    if (turnId === this.activeTurnId) return false;
    if (this.activeTurnId !== undefined && turnId < this.activeTurnId) return true;
    this.activeTurnId = turnId;
    this.pendingText = undefined;
    this.pendingStagnation = undefined;
    this.pendingToolCalls.clear();
    this.remindersThisTurn = 0;
    this.textDetector.reset();
    this.stagnationDetector.reset();
    return false;
  }

  private reset(): void {
    this.activeTurnId = undefined;
    this.pendingText = undefined;
    this.pendingStagnation = undefined;
    this.pendingToolCalls.clear();
    this.remindersThisTurn = 0;
    this.textDetector.reset();
    this.stagnationDetector.reset();
  }
}

registerScopedService(
  LifecycleScope.Agent,
  IAgentTextLoopWatchService,
  AgentTextLoopWatchService,
  ScopeActivation.OnScopeCreated,
  'textLoopWatch',
);
