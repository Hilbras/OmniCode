import { describe, expect, it } from 'vitest';

import type { IEventBus } from '#/app/event/eventBus';
import type {
  ContextInjectionContext,
  ContextInjectionProvider,
  ReminderNotification,
  ReminderRegistration,
} from '#/features/reminder/types';
import type { IAgentReminderService } from '#/features/reminder/reminderService';
import { AssistantDelta, ThinkingDelta } from '#/agent/loop/turnEvents';
import { TurnEnded } from '#/agent/loop/turnOps';
import { ToolCallStarted, ToolResultEvent } from '#/agent/toolExecutor/toolExecutorEvents';
import { AgentTextLoopWatchService } from '#/agent/loop/textLoopWatchService';
import {
  DEFAULT_LOOP_REMINDER_CAP,
  RESULT_STAGNATION_REMINDER_VARIANT,
  TEXT_LOOP_REMINDER_VARIANT,
  resolveLoopWatchConfig,
} from '#/agent/loop/textLoopWatch';

const PROSE = [
  'I checked the parser and the fixture it uses.',
  'The failing assertion comes from the tokenizer step.',
  'Before changing anything I want to confirm the expected output.',
  'That means running the focused suite one more time.',
  'The suite is green on this machine for the touched files.',
  'Next I will update the fixture and rerun the same command.',
].join('\n');

interface FakeBus {
  readonly bus: IEventBus;
  emit(cls: unknown, event: unknown): void;
}

function makeBus(): FakeBus {
  const handlers = new Map<unknown, Set<(event: unknown) => void>>();
  return {
    bus: {
      subscribe(cls: unknown, handler?: (event: unknown) => void) {
        const key = handler === undefined ? undefined : cls;
        const fn = (handler ?? cls) as (event: unknown) => void;
        const set = handlers.get(key) ?? new Set<(event: unknown) => void>();
        set.add(fn);
        handlers.set(key, set);
        return { dispose: () => set.delete(fn) };
      },
      publish() {},
    } as unknown as IEventBus,
    emit(cls, event) {
      for (const handler of handlers.get(cls) ?? []) handler(event);
    },
  };
}

interface FakeReminder {
  readonly reminder: IAgentReminderService;
  /** Call a registered provider the way the step-boundary injector does. */
  consume(variant?: string): unknown;
  readonly notifyCalls: ReminderNotification[];
  readonly variants: string[];
}

function makeReminder(): FakeReminder {
  const providers = new Map<string, ContextInjectionProvider>();
  const notifyCalls: ReminderNotification[] = [];
  const variants: string[] = [];
  return {
    reminder: {
      register<D>(variant: string, provider: ContextInjectionProvider<D>): ReminderRegistration {
        variants.push(variant);
        providers.set(variant, provider as ContextInjectionProvider);
        return { dispose: () => providers.delete(variant) };
      },
      notify(_content: string, notification: ReminderNotification) {
        notifyCalls.push(notification);
      },
      async reconcileWhenIdle() {},
    } as unknown as IAgentReminderService,
    consume: (variant: string = TEXT_LOOP_REMINDER_VARIANT) =>
      providers.get(variant)?.({
        injectedPositions: [],
        lastInjectedAt: null,
        lastInjection: undefined,
        lastDisclosure: undefined,
        isNewTurn: false,
      } as ContextInjectionContext<unknown>),
    notifyCalls,
    variants,
  };
}

function makeWatch(env: NodeJS.ProcessEnv = {}) {
  const bus = makeBus();
  const reminder = makeReminder();
  const service = new AgentTextLoopWatchService(bus.bus, reminder.reminder, env);
  return { bus, reminder, service };
}

const LOOP_LINE = 'Let me check the configuration file once more.';
const LOOP_TEXT = `${PROSE}\n${LOOP_LINE}\n${LOOP_LINE}\n${LOOP_LINE}\n${LOOP_LINE}\n`;

let callSeq = 0;
function toolCall(
  bus: FakeBus,
  options: { turnId?: number; name?: string; args?: unknown } = {},
): string {
  callSeq += 1;
  const toolCallId = `call_${callSeq}`;
  bus.emit(ToolCallStarted, {
    agentId: 'agent',
    turnId: options.turnId ?? 1,
    toolCallId,
    name: options.name ?? 'Read',
    args: options.args ?? { file_path: '/repo/src/index.ts' },
  });
  return toolCallId;
}

function toolResult(
  bus: FakeBus,
  toolCallId: string,
  output: unknown,
  extra: { turnId?: number; synthetic?: boolean; isError?: boolean } = {},
): void {
  bus.emit(ToolResultEvent, {
    agentId: 'agent',
    turnId: extra.turnId ?? 1,
    toolCallId,
    output,
    ...(extra.synthetic === undefined ? {} : { synthetic: extra.synthetic }),
    ...(extra.isError === undefined ? {} : { isError: extra.isError }),
  });
}

function repeatTool(
  bus: FakeBus,
  times: number,
  options: { name?: string; args?: unknown; output?: unknown; turnId?: number } = {},
): void {
  for (let i = 0; i < times; i += 1) {
    const id = toolCall(bus, options);
    toolResult(bus, id, options.output ?? 'unchanged', { turnId: options.turnId });
  }
}

describe('AgentTextLoopWatchService', () => {
  it('registers both reminder variants and stays quiet on normal text', () => {
    const { bus, reminder } = makeWatch();
    expect(reminder.variants).toContain(TEXT_LOOP_REMINDER_VARIANT);
    expect(reminder.variants).toContain(RESULT_STAGNATION_REMINDER_VARIANT);

    bus.emit(AssistantDelta, { turnId: 1, delta: PROSE });
    expect(reminder.consume()).toBeUndefined();
  });

  it('queues one reminder when streamed text loops', () => {
    const { bus, reminder } = makeWatch();
    bus.emit(AssistantDelta, { turnId: 1, delta: LOOP_TEXT });

    const text = reminder.consume();
    expect(text).toContain('the same phrase was emitted repeatedly');
    expect(text).toContain('let me check the configuration file');
    // Consuming clears the queue: nothing more is injected for the same detection.
    expect(reminder.consume()).toBeUndefined();
    expect(reminder.notifyCalls).toEqual([]);
  });

  it('watches thinking deltas too', () => {
    const { bus, reminder } = makeWatch();
    bus.emit(ThinkingDelta, { turnId: 4, delta: `${PROSE}\n${'Step done. '.repeat(8)}` });
    expect(reminder.consume()).toContain('the text restarts the same cycle');
  });

  it('resets between turns', () => {
    const { bus, reminder } = makeWatch();
    bus.emit(AssistantDelta, { turnId: 1, delta: LOOP_TEXT });
    bus.emit(AssistantDelta, { turnId: 2, delta: PROSE });
    expect(reminder.consume()).toBeUndefined();

    bus.emit(AssistantDelta, { turnId: 2, delta: LOOP_TEXT });
    expect(reminder.consume()).toContain('the same phrase was emitted repeatedly');
  });

  it('drops the pending reminder when the turn ends', () => {
    const { bus, reminder } = makeWatch();
    bus.emit(AssistantDelta, { turnId: 1, delta: LOOP_TEXT });
    bus.emit(TurnEnded, { turnId: 1, reason: 'completed' });
    expect(reminder.consume()).toBeUndefined();
  });

  it('can be disabled by environment', () => {
    const { bus, reminder } = makeWatch({ OMNICODE_TEXT_LOOP_BREAKER: '0' });
    bus.emit(AssistantDelta, { turnId: 1, delta: LOOP_TEXT });
    expect(reminder.consume()).toBeUndefined();
  });
});

describe('AgentTextLoopWatchService — result stagnation', () => {
  it('stays quiet while tool results keep differing', () => {
    const { bus, reminder } = makeWatch();
    for (let i = 0; i < 6; i += 1) {
      const id = toolCall(bus, { args: { command: `ls dir${i}` } });
      toolResult(bus, id, `entry-${i}`);
    }
    expect(reminder.consume(RESULT_STAGNATION_REMINDER_VARIANT)).toBeUndefined();
  });

  it('flags a non-read tool repeating the identical result', () => {
    const { bus, reminder } = makeWatch();
    repeatTool(bus, 3, { name: 'Bash', args: { command: 'make build' }, output: 'same error' });

    const text = reminder.consume(RESULT_STAGNATION_REMINDER_VARIANT);
    expect(text).toContain('the same call keeps returning the same result');
    expect(text).toContain('Bash produced the same result 3 times');
    // One signal per pending slot: a second consume is empty.
    expect(reminder.consume(RESULT_STAGNATION_REMINDER_VARIANT)).toBeUndefined();
    // The text channel is untouched by a tool channel detection.
    expect(reminder.consume(TEXT_LOOP_REMINDER_VARIANT)).toBeUndefined();
  });

  it('flags a read tool polling state it already observed', () => {
    const { bus, reminder } = makeWatch();
    repeatTool(bus, 3, { name: 'Read', output: 'same file body' });
    expect(reminder.consume(RESULT_STAGNATION_REMINDER_VARIANT)).toContain(
      'a read is polling state it already observed',
    );
  });

  it('reports a single reminder while an earlier one is still pending', () => {
    const { bus, reminder } = makeWatch();
    repeatTool(bus, 3, { name: 'Bash', args: { command: 'make build' }, output: 'same error' });
    repeatTool(bus, 3, {
      name: 'Read',
      args: { file_path: '/repo/other.ts' },
      output: 'same file body',
    });
    expect(reminder.consume(RESULT_STAGNATION_REMINDER_VARIANT)).toBeDefined();
    expect(reminder.consume(RESULT_STAGNATION_REMINDER_VARIANT)).toBeUndefined();
  });

  it('ignores synthetic results produced by the runtime itself', () => {
    const { bus, reminder } = makeWatch();
    repeatTool(bus, 4, { name: 'Bash', args: { command: 'make build' }, output: 'denied' });
    // Re-run the same shape with synthetic results: the detector must not count them,
    // so a fresh turn stays quiet.
    bus.emit(TurnEnded, { turnId: 1, reason: 'completed' });
    for (let i = 0; i < 6; i += 1) {
      const id = toolCall(bus, { turnId: 2, name: 'Bash', args: { command: 'make build' } });
      toolResult(bus, id, 'aborted', { turnId: 2, synthetic: true });
    }
    expect(reminder.consume(RESULT_STAGNATION_REMINDER_VARIANT)).toBeUndefined();
  });

  it('resets its tool memory between turns', () => {
    const { bus, reminder } = makeWatch();
    repeatTool(bus, 2, { name: 'Read', output: 'same file body' });
    bus.emit(TurnEnded, { turnId: 1, reason: 'completed' });
    repeatTool(bus, 2, { turnId: 2, name: 'Read', output: 'same file body' });
    expect(reminder.consume(RESULT_STAGNATION_REMINDER_VARIANT)).toBeUndefined();
  });

  it('can be disabled by environment', () => {
    const { bus, reminder } = makeWatch({ OMNICODE_RESULT_STAGNATION_BREAKER: 'off' });
    repeatTool(bus, 5, { name: 'Bash', args: { command: 'make build' }, output: 'same error' });
    expect(reminder.consume(RESULT_STAGNATION_REMINDER_VARIANT)).toBeUndefined();
  });

  it('drops a pending tool reminder when the turn ends', () => {
    const { bus, reminder } = makeWatch();
    repeatTool(bus, 3, { name: 'Bash', args: { command: 'make build' }, output: 'same error' });
    bus.emit(TurnEnded, { turnId: 1, reason: 'completed' });
    expect(reminder.consume(RESULT_STAGNATION_REMINDER_VARIANT)).toBeUndefined();
  });
});

describe('AgentTextLoopWatchService — per-turn reminder cap', () => {
  /** Drives a fresh detection and consumes it, returning whether a reminder came out. */
  function fire(bus: FakeBus, reminder: FakeReminder, turnId: number): boolean {
    const name = `Probe${callSeq}`;
    repeatTool(bus, 3, { turnId, name, args: { command: 'make build' }, output: 'same error' });
    return reminder.consume(RESULT_STAGNATION_REMINDER_VARIANT) !== undefined;
  }

  it('silences the watch after the default cap within one turn', () => {
    const { bus, reminder } = makeWatch();
    const fired = Array.from({ length: DEFAULT_LOOP_REMINDER_CAP + 2 }, () =>
      fire(bus, reminder, 1),
    );
    expect(fired.slice(0, DEFAULT_LOOP_REMINDER_CAP).every(Boolean)).toBe(true);
    expect(fired.slice(DEFAULT_LOOP_REMINDER_CAP).every((value) => !value)).toBe(true);
  });

  it('honours an explicit cap and refills on the next turn', () => {
    const { bus, reminder } = makeWatch({ OMNICODE_LOOP_REMINDER_CAP: '1' });
    expect(fire(bus, reminder, 1)).toBe(true);
    expect(fire(bus, reminder, 1)).toBe(false);

    bus.emit(TurnEnded, { turnId: 1, reason: 'completed' });
    expect(fire(bus, reminder, 2)).toBe(true);
  });

  it('shares one budget across the text and tool channels', () => {
    const { bus, reminder } = makeWatch({ OMNICODE_LOOP_REMINDER_CAP: '1' });
    bus.emit(AssistantDelta, { turnId: 1, delta: LOOP_TEXT });
    expect(reminder.consume(TEXT_LOOP_REMINDER_VARIANT)).toBeDefined();

    repeatTool(bus, 3, { name: 'Read', output: 'same file body' });
    expect(reminder.consume(RESULT_STAGNATION_REMINDER_VARIANT)).toBeUndefined();
  });

  it('treats a junk cap as the default', () => {
    const cap = (env: NodeJS.ProcessEnv) => resolveLoopWatchConfig(env).reminderCap;
    expect(cap({})).toBe(DEFAULT_LOOP_REMINDER_CAP);
    expect(cap({ OMNICODE_LOOP_REMINDER_CAP: 'nope' })).toBe(DEFAULT_LOOP_REMINDER_CAP);
    expect(cap({ OMNICODE_LOOP_REMINDER_CAP: '0' })).toBe(DEFAULT_LOOP_REMINDER_CAP);
    expect(cap({ OMNICODE_LOOP_REMINDER_CAP: '5' })).toBe(5);
  });

  it('honours runtime overrides without touching the environment', () => {
    const { bus, reminder, service } = makeWatch();
    service.configure({ reminderCap: 1 });
    expect(fire(bus, reminder, 1)).toBe(true);
    expect(fire(bus, reminder, 1)).toBe(false);
  });
});
