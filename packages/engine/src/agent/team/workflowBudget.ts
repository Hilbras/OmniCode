import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { Error2 } from '#/errors';

import { TeamErrors } from './errors';

export type WorkflowBudgetUnit = 'turns' | 'tokens' | 'timeMs';

export type WorkflowBudgetAmount = Partial<Record<WorkflowBudgetUnit, number>>;

export type WorkflowBudgetLimits = WorkflowBudgetAmount;

export interface WorkflowBudgetReservation {
  readonly id: string;
  readonly workflowId: string;
  readonly amounts: WorkflowBudgetAmount;
  readonly createdAt: number;
  readonly settledAt: number | undefined;
}

export interface WorkflowBudgetSnapshot {
  readonly workflowId: string;
  readonly limits: WorkflowBudgetAmount;
  readonly used: WorkflowBudgetAmount;
  readonly reserved: WorkflowBudgetAmount;
  readonly remaining: WorkflowBudgetAmount;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WorkflowBudgetLedgerOptions {
  readonly now?: () => number;
  readonly idFactory?: () => string;
}

const UNITS: readonly WorkflowBudgetUnit[] = ['turns', 'tokens', 'timeMs'];
const UNIT_SET: ReadonlySet<string> = new Set<string>(UNITS);

interface UnitTotals {
  turns: number;
  tokens: number;
  timeMs: number;
}

interface BudgetState {
  readonly workflowId: string;
  readonly limits: WorkflowBudgetAmount;
  readonly used: UnitTotals;
  readonly reserved: UnitTotals;
  readonly createdAt: number;
  updatedAt: number;
}

interface ReservationState {
  readonly id: string;
  readonly workflowId: string;
  readonly amounts: UnitTotals;
  readonly createdAt: number;
  settledAt: number | undefined;
}

function isUnit(value: string): value is WorkflowBudgetUnit {
  return UNIT_SET.has(value);
}

function zeroTotals(): UnitTotals {
  return { turns: 0, tokens: 0, timeMs: 0 };
}

function totalsFrom(amount: WorkflowBudgetAmount): UnitTotals {
  return {
    turns: amount.turns ?? 0,
    tokens: amount.tokens ?? 0,
    timeMs: amount.timeMs ?? 0,
  };
}

function amountFromTotals(totals: UnitTotals): WorkflowBudgetAmount {
  return { turns: totals.turns, tokens: totals.tokens, timeMs: totals.timeMs };
}

function normalizeAmount(
  amount: WorkflowBudgetAmount,
  message: string,
  details: Readonly<Record<string, unknown>>,
): UnitTotals {
  let defined = 0;
  for (const [key, value] of Object.entries(amount)) {
    if (value === undefined) continue;
    if (!isUnit(key)) {
      throw new Error2(TeamErrors.codes.BUDGET_INVALID, `${message}: unknown unit ${key}`, {
        details: { ...details, unit: key },
      });
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new Error2(TeamErrors.codes.BUDGET_INVALID, `${message}: invalid ${key} amount`, {
        details: { ...details, unit: key, value },
      });
    }
    defined += 1;
  }
  if (defined === 0) {
    throw new Error2(TeamErrors.codes.BUDGET_INVALID, `${message}: no budget units supplied`, {
      details,
    });
  }
  return totalsFrom(amount);
}

function definedAmounts(totals: UnitTotals): WorkflowBudgetAmount {
  return amountFromTotals(totals);
}

export class WorkflowBudgetExhaustedError extends Error2 {
  readonly workflowId: string;
  readonly unit: WorkflowBudgetUnit;
  readonly requested: number;
  readonly remaining: number;

  constructor(workflowId: string, unit: WorkflowBudgetUnit, requested: number, remaining: number) {
    super(
      TeamErrors.codes.BUDGET_EXHAUSTED,
      `Workflow ${workflowId} exhausted ${unit}: requested ${String(requested)}, remaining ${String(remaining)}.`,
      {
        name: 'WorkflowBudgetExhaustedError',
        details: { workflowId, unit, requested, remaining },
      },
    );
    this.workflowId = workflowId;
    this.unit = unit;
    this.requested = requested;
    this.remaining = remaining;
  }
}

export class WorkflowBudgetLedger {
  private readonly now: () => number;
  private readonly idFactory: () => string;
  private sequence = 0;
  private readonly budgets = new Map<string, BudgetState>();
  private readonly reservations = new Map<string, ReservationState>();

  constructor(options: WorkflowBudgetLedgerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.idFactory =
      options.idFactory ??
      (() => {
        this.sequence += 1;
        return `budget-reservation-${String(this.sequence)}`;
      });
  }

  setBudget(workflowId: string, limits: WorkflowBudgetLimits): WorkflowBudgetSnapshot {
    const id = this.requireWorkflowId(workflowId);
    if (this.budgets.has(id)) {
      throw new Error2(TeamErrors.codes.BUDGET_ALREADY_SET, `Budget already set for ${id}.`, {
        details: { workflowId: id },
      });
    }
    normalizeAmount(limits, `Invalid budget for ${id}`, { workflowId: id });
    const timestamp = this.now();
    const state: BudgetState = {
      workflowId: id,
      limits: { ...limits },
      used: zeroTotals(),
      reserved: zeroTotals(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.budgets.set(id, state);
    return this.snapshotOf(state);
  }

  getBudget(workflowId: string): WorkflowBudgetSnapshot | undefined {
    const state = this.budgets.get(workflowId);
    return state === undefined ? undefined : this.snapshotOf(state);
  }

  remaining(workflowId: string): WorkflowBudgetAmount {
    return this.requireBudget(workflowId).remaining;
  }

  reserve(workflowId: string, amount: WorkflowBudgetAmount): WorkflowBudgetReservation {
    const id = this.requireWorkflowId(workflowId);
    const state = this.requireBudgetState(id);
    const requested = normalizeAmount(amount, `Invalid reservation for ${id}`, {
      workflowId: id,
    });
    for (const unit of UNITS) {
      const wanted = requested[unit];
      if (wanted === 0) continue;
      const available = this.remainingFor(state, unit);
      if (wanted > available) {
        throw new WorkflowBudgetExhaustedError(id, unit, wanted, available);
      }
    }
    const timestamp = this.now();
    const reservation: ReservationState = {
      id: this.idFactory(),
      workflowId: id,
      amounts: requested,
      createdAt: timestamp,
      settledAt: undefined,
    };
    state.reserved.turns += requested.turns;
    state.reserved.tokens += requested.tokens;
    state.reserved.timeMs += requested.timeMs;
    state.updatedAt = timestamp;
    this.reservations.set(reservation.id, reservation);
    return this.reservationOf(reservation);
  }

  record(reservationId: string, actual?: WorkflowBudgetAmount): WorkflowBudgetSnapshot {
    const reservation = this.reservations.get(reservationId);
    if (reservation === undefined) {
      throw new Error2(
        TeamErrors.codes.BUDGET_RESERVATION_NOT_FOUND,
        `Budget reservation not found: ${reservationId}`,
        { details: { reservationId } },
      );
    }
    if (reservation.settledAt !== undefined) {
      throw new Error2(
        TeamErrors.codes.BUDGET_RESERVATION_SETTLED,
        `Budget reservation already settled: ${reservationId}`,
        { details: { reservationId } },
      );
    }
    const state = this.requireBudgetState(reservation.workflowId);
    const spend =
      actual === undefined
        ? reservation.amounts
        : normalizeAmount(actual, `Invalid spend for ${reservation.workflowId}`, {
            workflowId: reservation.workflowId,
            reservationId,
          });

    for (const unit of UNITS) {
      const wanted = spend[unit];
      if (wanted === 0) continue;
      const available =
        this.remainingFor(state, unit) + reservation.amounts[unit];
      if (wanted > available) {
        throw new WorkflowBudgetExhaustedError(
          reservation.workflowId,
          unit,
          wanted,
          available,
        );
      }
    }

    const timestamp = this.now();
    state.used.turns += spend.turns;
    state.used.tokens += spend.tokens;
    state.used.timeMs += spend.timeMs;
    state.reserved.turns = Math.max(0, state.reserved.turns - reservation.amounts.turns);
    state.reserved.tokens = Math.max(0, state.reserved.tokens - reservation.amounts.tokens);
    state.reserved.timeMs = Math.max(0, state.reserved.timeMs - reservation.amounts.timeMs);
    state.updatedAt = timestamp;
    reservation.settledAt = timestamp;
    return this.snapshotOf(state);
  }

  release(reservationId: string): WorkflowBudgetSnapshot {
    const reservation = this.reservations.get(reservationId);
    if (reservation === undefined) {
      throw new Error2(
        TeamErrors.codes.BUDGET_RESERVATION_NOT_FOUND,
        `Budget reservation not found: ${reservationId}`,
        { details: { reservationId } },
      );
    }
    if (reservation.settledAt !== undefined) {
      throw new Error2(
        TeamErrors.codes.BUDGET_RESERVATION_SETTLED,
        `Budget reservation already settled: ${reservationId}`,
        { details: { reservationId } },
      );
    }
    const state = this.requireBudgetState(reservation.workflowId);
    const timestamp = this.now();
    state.reserved.turns = Math.max(0, state.reserved.turns - reservation.amounts.turns);
    state.reserved.tokens = Math.max(0, state.reserved.tokens - reservation.amounts.tokens);
    state.reserved.timeMs = Math.max(0, state.reserved.timeMs - reservation.amounts.timeMs);
    state.updatedAt = timestamp;
    reservation.settledAt = timestamp;
    return this.snapshotOf(state);
  }

  spend(workflowId: string, amount: WorkflowBudgetAmount): WorkflowBudgetSnapshot {
    const reservation = this.reserve(workflowId, amount);
    try {
      return this.record(reservation.id);
    } catch (error) {
      this.release(reservation.id);
      throw error;
    }
  }

  private requireWorkflowId(workflowId: string): string {
    const id = workflowId.trim();
    if (id.length === 0) {
      throw new Error2(TeamErrors.codes.BUDGET_INVALID, 'Workflow id must not be empty.');
    }
    return id;
  }

  private requireBudget(workflowId: string): WorkflowBudgetSnapshot {
    const state = this.budgets.get(workflowId);
    if (state === undefined) {
      throw new Error2(TeamErrors.codes.BUDGET_NOT_FOUND, `Budget not found: ${workflowId}`, {
        details: { workflowId },
      });
    }
    return this.snapshotOf(state);
  }

  private requireBudgetState(workflowId: string): BudgetState {
    const state = this.budgets.get(workflowId);
    if (state === undefined) {
      throw new Error2(TeamErrors.codes.BUDGET_NOT_FOUND, `Budget not found: ${workflowId}`, {
        details: { workflowId },
      });
    }
    return state;
  }

  private remainingFor(state: BudgetState, unit: WorkflowBudgetUnit): number {
    const limit = state.limits[unit];
    if (limit === undefined) return Number.POSITIVE_INFINITY;
    return Math.max(0, limit - state.used[unit] - state.reserved[unit]);
  }

  private snapshotOf(state: BudgetState): WorkflowBudgetSnapshot {
    const remaining: WorkflowBudgetAmount = {};
    for (const unit of UNITS) {
      const limit = state.limits[unit];
      if (limit === undefined) continue;
      remaining[unit] = this.remainingFor(state, unit);
    }
    return {
      workflowId: state.workflowId,
      limits: { ...state.limits },
      used: amountFromTotals(state.used),
      reserved: amountFromTotals(state.reserved),
      remaining,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    };
  }

  private reservationOf(reservation: ReservationState): WorkflowBudgetReservation {
    return {
      id: reservation.id,
      workflowId: reservation.workflowId,
      amounts: definedAmounts(reservation.amounts),
      createdAt: reservation.createdAt,
      settledAt: reservation.settledAt,
    };
  }
}

export const IWorkflowBudgetLedger = createDecorator<WorkflowBudgetLedger>('workflowBudgetLedger');

registerScopedService(LifecycleScope.Session, IWorkflowBudgetLedger, WorkflowBudgetLedger, ScopeActivation.OnDemand, 'agentTask');
