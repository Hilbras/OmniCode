import { Disposable } from '@hilbras/omnicode-base/di/lifecycle';
import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { ILogService, type ILogger } from '@hilbras/omnicode-base/log/log';
import { IAgentLLMRequesterService } from '@hilbras/omnicode-engine/agent/llmRequester/llmRequester';
import { IAgentScopeContext } from '@hilbras/omnicode-engine/agent/scopeContext/scopeContext';
import { TurnEnded } from '@hilbras/omnicode-engine/agent/loop/turnOps';
import { IEventBus } from '@hilbras/omnicode-engine/app/event/eventBus';
import { IFlagService } from '@hilbras/omnicode-engine/app/flag/flag';
import { IEventDispatcher } from '@hilbras/omnicode-engine/state/eventDispatcher';
import { createUserMessage, type Message } from '@hilbras/omnicode-engine/llm-adapter/contract/message';

import { IAgentMemoryContextService } from '#/context/agentMemoryContextService';
import { MemorySaved } from '#/context/memoryEvents';
import { IMemoryService } from '#/contracts/memoryContract';
import { TRUST_RANK, type MemoryScope } from '#/contracts/memoryTypes';
import { MEMORY_FLAG_ID, MEMORY_WRITER_FLAG_ID } from '#/feature/flag';
import {
  parseWriterResponse,
  validateWriterOperations,
  type MemoryWriterSaveOperation,
  type MemoryWriterTurn,
} from '#/writer/memoryWriter';
import { isMemoryOptOut } from '#/writer/memoryOptOut';

const WRITER_TIMEOUT_MS = 15_000;
const MAX_TURN_CHARS = 4_000;
const MIN_USER_CHARS = 12;

const WRITER_SYSTEM_PROMPT = [
  'You extract durable memory from one conversation turn.',
  'Return JSON only: {"operations":[...]} with at most 4 operations.',
  'Allowed operations:',
  '  {"op":"save","subject":"<key>","content":"<one sentence>","quote":"<verbatim user text>","category":"fact|preference"}',
  '  {"op":"forget","subject":"<key>"}',
  '  {"op":"none"}',
  'Rules:',
  '- Only save something about the user, their preferences, or their project that will still matter next week.',
  '- "quote" MUST be copied verbatim from the user message; never paraphrase it.',
  '- Never save secrets, credentials, one-off tasks, or anything the assistant inferred.',
  '- Use a stable dotted subject: profile.name, profile.location, profile.occupation, profile.employer, profile.language, profile.timezone, profile.preference.<slug>, profile.note.<slug>, or project.<slug>.',
  '- If nothing is durable, return {"operations":[{"op":"none"}]}.',
].join('\n');

export interface IMemoryWriterService {
  readonly _serviceBrand: undefined;
}

export const IMemoryWriterService = createDecorator<IMemoryWriterService>('memoryWriterService');

export class AgentMemoryWriterService extends Disposable implements IMemoryWriterService {
  declare readonly _serviceBrand: undefined;

  private readonly log: ILogger;

  constructor(
    @ILogService log: ILogService,
    @IMemoryService private readonly memory: IMemoryService,
    @IAgentMemoryContextService private readonly context: IAgentMemoryContextService,
    @IAgentLLMRequesterService private readonly requester: IAgentLLMRequesterService,
    @IEventBus eventBus: IEventBus,
    @IFlagService private readonly flags: IFlagService,
    @IAgentScopeContext private readonly scopeContext: IAgentScopeContext,
    @IEventDispatcher private readonly dispatcher: IEventDispatcher,
  ) {
    super();
    this.log = log.child({ memory: 'writer' });
    this._register(eventBus.subscribe(TurnEnded, (event) => void this.handleTurnEnded(event.reason)));
  }

  async handleTurnEnded(reason: TurnEnded['reason']): Promise<void> {
    if (reason !== 'completed') return;
    if (!this.memory.enabled) return;
    if (!this.flags.enabled(MEMORY_FLAG_ID)) return;
    if (!this.flags.enabled(MEMORY_WRITER_FLAG_ID)) return;

    const userMessage = this.context.lastUserPrompt();
    if (userMessage === undefined || userMessage.trim().length < MIN_USER_CHARS) return;
    if (isMemoryOptOut(userMessage)) return;
    const assistantMessage = this.lastAssistantMessage();
    if (assistantMessage === undefined) return;

    try {
      const profile = await this.profile();
      const turn: MemoryWriterTurn = {
        userMessage: truncate(userMessage, MAX_TURN_CHARS),
        assistantMessage: truncate(assistantMessage, MAX_TURN_CHARS),
        profile,
      };
      const response = await this.requester.request(
        {
          systemPrompt: WRITER_SYSTEM_PROMPT,
          messages: [writerMessage(turn)],
          tools: [],
          isolated: true,
          maxOutputSize: 512,
        },
        undefined,
        AbortSignal.timeout(WRITER_TIMEOUT_MS),
      );
      const parsed = parseWriterResponse(textOf(response.message));
      const validation = validateWriterOperations(turn, parsed);
      if (validation.rejected.length > 0) {
        this.log.info('memory writer rejected proposals', {
          reasons: validation.rejected.map((entry) => entry.reason),
        });
      }
      for (const operation of validation.accepted) {
        await this.save(operation);
      }
      for (const operation of validation.forget) {
        await this.forget(operation.subject);
      }
    } catch (error) {
      this.log.info('memory writer skipped', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  private lastAssistantMessage(): string | undefined {
    const history = this.context.getHistory();
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const message = history[index];
      if (message === undefined || message.role !== 'assistant') continue;
      const text = message.content
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join('')
        .trim();
      if (text.length > 0) return text;
    }
    return undefined;
  }

  private async profile(): Promise<readonly { subject: string; content: string }[]> {
    const records = await this.memory.list({
      scopes: ['global'],
      categories: ['fact', 'preference'],
      tiers: ['working', 'distilled'],
      lifecycle: ['active'],
      limit: 20,
    });
    return records
      .filter(
        (record) =>
          record.subject?.startsWith('profile.') === true &&
          TRUST_RANK[record.trust] >= TRUST_RANK.trusted,
      )
      .slice(0, 8)
      .map((record) => ({ subject: record.subject as string, content: record.content }));
  }

  private async save(operation: MemoryWriterSaveOperation): Promise<void> {
    const existing = await this.memory.list({
      scopes: ['global', 'repository'],
      tiers: ['working', 'distilled'],
      lifecycle: ['active'],
      limit: 50,
    });
    const correction = existing.some(
      (record) => record.subject === operation.subject && TRUST_RANK[record.trust] >= TRUST_RANK.trusted,
    );
    const scope: MemoryScope = operation.subject.startsWith('profile.')
      ? { tier: 'global' }
      : ((await this.context.scopeFor('repository')) ?? { tier: 'global' });
    const captured = await this.memory.capture({
      content: operation.content,
      tier: 'distilled',
      category: operation.category,
      sourceType: correction ? 'user_correction' : 'user_statement',
      origin: 'user',
      scope,
      subject: operation.subject,
    });
    if (captured.status === 'stored' && captured.record !== undefined) {
      await this.dispatcher.dispatch(
        new MemorySaved({
          agentId: this.scopeContext.agentId,
          memoryId: captured.record.id,
          content: captured.record.content,
          category: captured.record.category,
          trust: captured.record.trust,
          scope: captured.record.scope.tier,
        }),
      );
    }
  }

  private async forget(subject: string): Promise<void> {
    const records = await this.memory.list({
      scopes: ['global', 'repository'],
      lifecycle: ['active'],
      limit: 50,
    });
    const target = records.find((record) => record.subject === subject);
    if (target === undefined) return;
    await this.memory.invalidate(target.id, 'user retracted');
  }
}

function writerMessage(turn: MemoryWriterTurn): Message {
  return createUserMessage(
    [
      `Current profile:\n${(turn.profile ?? []).map((entry) => `- ${entry.subject}: ${entry.content}`).join('\n') || '(empty)'}`,
      `User message:\n${turn.userMessage}`,
      `Assistant reply:\n${turn.assistantMessage ?? ''}`,
    ].join('\n\n'),
  );
}

function textOf(message: Message): string {
  return message.content.map((part) => (part.type === 'text' ? part.text : '')).join('');
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}
