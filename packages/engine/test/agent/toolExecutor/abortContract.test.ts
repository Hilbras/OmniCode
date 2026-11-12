import { describe, expect, it } from 'vitest';

import { AbortContract } from '#/agent/toolExecutor/abortContract';

function clock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    advance(ms: number) {
      value += ms;
    },
  };
}

describe('AbortContract', () => {
  it('completes normally and reports handler time', () => {
    const time = clock();
    const contract = new AbortContract<string>({ now: time.now });
    expect(contract.markStarted()).toBe(true);
    time.advance(120);
    expect(contract.complete('ok')).toBe(true);

    expect(contract.state).toBe('completed');
    expect(contract.settledOutcome()).toEqual({ kind: 'completed', value: 'ok' });
    expect(contract.accounting()).toEqual({ released: false, handlerMs: 120, drainMs: 0 });
  });

  it('abort before start: never handled, zero handler time, one release', () => {
    const time = clock();
    const contract = new AbortContract({ now: time.now });
    expect(contract.abort('user cancel')).toBe(true);
    time.advance(50);
    expect(contract.markStarted()).toBe(false);

    expect(contract.state).toBe('aborted');
    expect(contract.settledOutcome()).toEqual({
      kind: 'aborted',
      reason: 'user cancel',
      handled: false,
    });
    expect(contract.accounting()).toEqual({ released: false, handlerMs: 0, drainMs: 0 });
    expect(contract.release()).toBe(true);
    expect(contract.release()).toBe(false);
    expect(contract.accounting().released).toBe(true);
  });

  it('abort mid-handler keeps the result single and reports the time that really ran', () => {
    const time = clock();
    const contract = new AbortContract({ now: time.now });
    contract.markStarted();
    time.advance(80);
    expect(contract.abort('timeout')).toBe(true);
    time.advance(5);
    // A late finish is discarded: the abort already latched the outcome.
    expect(contract.complete('late value')).toBe(false);
    expect(contract.fail(new Error('late'))).toBe(false);

    expect(contract.settledOutcome()).toEqual({
      kind: 'aborted',
      reason: 'timeout',
      handled: true,
    });
    expect(contract.accounting()).toEqual({ released: false, handlerMs: 80, drainMs: 0 });
  });

  it('a late abort after completion changes nothing', () => {
    const time = clock();
    const contract = new AbortContract({ now: time.now });
    contract.markStarted();
    contract.complete(1);
    expect(contract.abort('too late')).toBe(false);
    expect(contract.state).toBe('completed');
    expect(contract.settledOutcome()).toEqual({ kind: 'completed', value: 1 });
  });

  it('repeated abort paths still produce exactly one terminal outcome', () => {
    const contract = new AbortContract();
    contract.markStarted();
    expect(contract.abort('first')).toBe(true);
    expect(contract.abort('second')).toBe(false);
    expect(contract.release()).toBe(true);
    expect(contract.release()).toBe(false);
    expect(contract.settledOutcome()).toMatchObject({ kind: 'aborted', reason: 'first' });
  });

  it('fail() while running is an error completion, not an abort', () => {
    const contract = new AbortContract();
    contract.markStarted();
    expect(contract.fail(new Error('boom'))).toBe(true);
    expect(contract.state).toBe('completed');
  });

  it('a late failure after abort is discarded and drain stays at abort time', () => {
    const time = clock();
    const contract = new AbortContract({ now: time.now });
    contract.markStarted();
    contract.abort('signal');
    time.advance(2_000);
    expect(contract.fail(new Error('late'))).toBe(false);
    expect(contract.accounting().drainMs).toBe(0);
  });

  it('reset returns a finished contract to idle', () => {
    const contract = new AbortContract();
    contract.markStarted();
    contract.complete('x');
    contract.release();
    contract.reset();
    expect(contract.state).toBe('idle');
    expect(contract.settledOutcome()).toBeUndefined();
    expect(contract.release()).toBe(true);
  });
});
