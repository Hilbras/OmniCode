import { describe, expect, it } from 'vitest';

import { TeamErrors } from '#/agent/team/errors';
import {
  WorkflowBudgetExhaustedError,
  WorkflowBudgetLedger,
} from '#/agent/team/workflowBudget';

function thrownCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined;
  }
  return undefined;
}

describe('WorkflowBudgetLedger', () => {
  it('sets budgets and reports remaining turns, tokens, and time', () => {
    const ledger = new WorkflowBudgetLedger({ now: () => 100 });
    const budget = ledger.setBudget('wf', { turns: 2, tokens: 100, timeMs: 5_000 });
    expect(budget).toMatchObject({
      workflowId: 'wf',
      limits: { turns: 2, tokens: 100, timeMs: 5_000 },
      used: { turns: 0, tokens: 0, timeMs: 0 },
      reserved: { turns: 0, tokens: 0, timeMs: 0 },
      remaining: { turns: 2, tokens: 100, timeMs: 5_000 },
      createdAt: 100,
    });
    expect(ledger.remaining('wf')).toEqual({ turns: 2, tokens: 100, timeMs: 5_000 });
    expect(ledger.getBudget('missing')).toBeUndefined();
  });

  it('reserves capacity and records actual spend without silent overspend', () => {
    const ledger = new WorkflowBudgetLedger();
    ledger.setBudget('wf', { tokens: 100 });
    const reservation = ledger.reserve('wf', { tokens: 40 });
    expect(ledger.remaining('wf')).toEqual({ tokens: 60 });

    const recorded = ledger.record(reservation.id, { tokens: 30 });
    expect(recorded.used).toMatchObject({ tokens: 30 });
    expect(recorded.reserved).toMatchObject({ tokens: 0 });
    expect(recorded.remaining).toEqual({ tokens: 70 });

    const releasedReservation = ledger.reserve('wf', { tokens: 50 });
    const released = ledger.release(releasedReservation.id);
    expect(released.reserved).toMatchObject({ tokens: 0 });
    expect(released.remaining).toEqual({ tokens: 70 });
  });

  it('throws an explicit exhaustion error and leaves state unchanged', () => {
    const ledger = new WorkflowBudgetLedger({ now: () => 1 });
    ledger.setBudget('wf', { tokens: 100 });
    const held = ledger.reserve('wf', { tokens: 80 });

    let thrown: unknown;
    try {
      ledger.reserve('wf', { tokens: 30 });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(WorkflowBudgetExhaustedError);
    expect(thrown).toMatchObject({
      code: TeamErrors.codes.BUDGET_EXHAUSTED,
      workflowId: 'wf',
      unit: 'tokens',
      requested: 30,
      remaining: 20,
    });
    expect(ledger.getBudget('wf')?.reserved).toMatchObject({ tokens: 80 });
    expect(ledger.remaining('wf')).toEqual({ tokens: 20 });

    ledger.record(held.id);
    expect(ledger.remaining('wf')).toEqual({ tokens: 20 });
  });

  it('blocks a settlement that exceeds its reservation and available budget', () => {
    const ledger = new WorkflowBudgetLedger();
    ledger.setBudget('wf', { tokens: 100 });
    const reservation = ledger.reserve('wf', { tokens: 10 });

    expect(() => ledger.record(reservation.id, { tokens: 20 })).not.toThrow();
    expect(ledger.getBudget('wf')?.used).toMatchObject({ tokens: 20 });

    const second = ledger.reserve('wf', { tokens: 10 });
    expect(() => ledger.record(second.id, { tokens: 90 })).toThrow(WorkflowBudgetExhaustedError);
    expect(ledger.getBudget('wf')).toMatchObject({
      used: { tokens: 20 },
      reserved: { tokens: 10 },
      remaining: { tokens: 70 },
    });
  });

  it('enforces turns and time independently of tokens', () => {
    const ledger = new WorkflowBudgetLedger();
    ledger.setBudget('wf', { turns: 1, timeMs: 100 });
    ledger.spend('wf', { turns: 1 });
    expect(() => ledger.spend('wf', { turns: 1 })).toThrow(WorkflowBudgetExhaustedError);
    expect(() => ledger.spend('wf', { timeMs: 101 })).toThrow(WorkflowBudgetExhaustedError);
    expect(ledger.getBudget('wf')?.remaining).toEqual({ turns: 0, timeMs: 100 });
  });

  it('rejects duplicate budgets, unknown budgets, and invalid amounts', () => {
    const ledger = new WorkflowBudgetLedger();
    ledger.setBudget('wf', { tokens: 1 });
    expect(thrownCode(() => ledger.setBudget('wf', { tokens: 2 }))).toBe(
      TeamErrors.codes.BUDGET_ALREADY_SET,
    );
    expect(thrownCode(() => ledger.reserve('missing', { tokens: 1 }))).toBe(
      TeamErrors.codes.BUDGET_NOT_FOUND,
    );
    expect(thrownCode(() => ledger.reserve('wf', { tokens: -1 }))).toBe(
      TeamErrors.codes.BUDGET_INVALID,
    );
    expect(thrownCode(() => ledger.setBudget('bad', {}))).toBe(
      TeamErrors.codes.BUDGET_INVALID,
    );
    expect(thrownCode(() => ledger.record('unknown'))).toBe(
      TeamErrors.codes.BUDGET_RESERVATION_NOT_FOUND,
    );
  });
});
