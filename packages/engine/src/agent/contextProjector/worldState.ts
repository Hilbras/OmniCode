/**
 * Typed world-state snapshots and merge-patch deltas.
 *
 * A replayed session shows the model a rendered world state — the summary, the
 * pending tasks, the open goals. When that state is re-rendered from scratch on
 * every step it is stable but expensive; when it is diffed blindly it can drift
 * from what the model actually saw. This module is the middle ground:
 *
 * - State is a flat map of typed scalars (strings, numbers, booleans, null) and
 *   string lists. Nothing nested, so a delta cannot smuggle structure.
 * - A delta is RFC 7396 merge-patch: `null` deletes a key, a value replaces it.
 * - A snapshot is the value the model last rendered. A delta derived from it is
 *   only meaningful against that baseline; after compaction the baseline is
 *   stale and must be reset (`resetBaseline`), which forces a full render.
 * - Undiffable input (a non-object) degrades to a full render rather than a
 *   guessed delta.
 *
 * The functions are pure; persistence of the baseline belongs to the caller.
 */

export type WorldStateScalar = string | number | boolean | null;
export type WorldStateValue = WorldStateScalar | readonly string[];
export type WorldState = Readonly<Record<string, WorldStateValue>>;

/** RFC 7396 merge patch; `null` removes the key. */
export type WorldStateDelta = Readonly<Record<string, WorldStateValue>>;

export type WorldStateRender =
  | { readonly kind: 'full'; readonly state: WorldState }
  | { readonly kind: 'delta'; readonly delta: WorldStateDelta };

export interface WorldStateBaseline {
  readonly value: WorldState;
  readonly version: number;
}

function isScalar(value: unknown): value is WorldStateScalar {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

function isValue(value: unknown): value is WorldStateValue {
  return isScalar(value) || (Array.isArray(value) && value.every((entry) => typeof entry === 'string'));
}

/** Returns the state when every entry is a flat typed value, else `undefined`. */
export function asWorldState(value: unknown): WorldState | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const out: Record<string, WorldStateValue> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!isValue(entry)) return undefined;
    out[key] = entry;
  }
  return out;
}

function sameValue(left: WorldStateValue, right: WorldStateValue): boolean {
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((entry, index) => entry === right[index]);
  }
  return left === right;
}

/** Delta from `baseline` to `next`; empty when nothing changed. */
export function diffWorldState(baseline: WorldState, next: WorldState): WorldStateDelta {
  const delta: Record<string, WorldStateValue> = {};
  for (const key of Object.keys(baseline)) {
    if (!(key in next)) delta[key] = null;
  }
  for (const [key, value] of Object.entries(next)) {
    const previous = baseline[key];
    if (previous !== undefined && sameValue(previous, value)) continue;
    delta[key] = value;
  }
  return delta;
}

/** Applies a merge patch; `null` deletes. Returns a new object. */
export function applyWorldStateDelta(state: WorldState, delta: WorldStateDelta): WorldState {
  const out: Record<string, WorldStateValue> = { ...state };
  for (const [key, value] of Object.entries(delta)) {
    if (value === null) delete out[key];
    else out[key] = value;
  }
  return out;
}

export function isDeltaEmpty(delta: WorldStateDelta): boolean {
  return Object.keys(delta).length === 0;
}

export interface WorldStateTrackerOptions {
  /** Deltas allowed before forcing a full render; default 8. */
  readonly maxDeltasBeforeFull?: number;
}

/**
 * Tracks the render baseline across steps. Choosing delta vs full render is the
 * only decision it makes; `resetBaseline` (compaction) forces a full render.
 */
export class WorldStateTracker {
  private baseline: WorldStateBaseline | undefined;
  private deltasSinceFull = 0;
  private readonly maxDeltasBeforeFull: number;

  constructor(options: WorldStateTrackerOptions = {}) {
    const limit = options.maxDeltasBeforeFull;
    this.maxDeltasBeforeFull = limit !== undefined && Number.isInteger(limit) && limit >= 1 ? limit : 8;
  }

  /** Chooses what to emit for `state` and advances the baseline. */
  next(state: WorldState): WorldStateRender {
    if (this.baseline === undefined || this.deltasSinceFull >= this.maxDeltasBeforeFull) {
      this.baseline = { value: state, version: (this.baseline?.version ?? 0) + 1 };
      this.deltasSinceFull = 0;
      return { kind: 'full', state };
    }
    const delta = diffWorldState(this.baseline.value, state);
    if (isDeltaEmpty(delta)) return { kind: 'delta', delta };
    this.baseline = { value: state, version: this.baseline.version };
    this.deltasSinceFull += 1;
    return { kind: 'delta', delta };
  }

  /** Marks the current state as already rendered (no output) without diffing. */
  seed(state: WorldState): void {
    this.baseline = { value: state, version: (this.baseline?.version ?? 0) + 1 };
    this.deltasSinceFull = 0;
  }

  /** Drops the baseline so the next render is full. Call after compaction. */
  resetBaseline(): void {
    this.baseline = undefined;
    this.deltasSinceFull = 0;
  }

  currentBaseline(): WorldStateBaseline | undefined {
    return this.baseline;
  }
}

/** Renders a delta-only section; falls back to a full render when undiffable. */
export function renderWorldState(render: WorldStateRender): string {
  if (render.kind === 'full') {
    const entries = Object.entries(render.state).map(([key, value]) => `- ${key}: ${formatValue(value)}`);
    return ['## World State', ...(entries.length === 0 ? ['(empty)'] : entries)].join('\n');
  }
  const entries = Object.entries(render.delta).map(([key, value]) =>
    value === null ? `- ${key}: (removed)` : `- ${key}: ${formatValue(value)}`,
  );
  return ['## World State Changes', ...(entries.length === 0 ? ['(no changes)'] : entries)].join('\n');
}

/** Converts arbitrary state into a render, degrading to `full` when undiffable. */
export function renderUndiffableFallback(value: unknown): WorldStateRender {
  const state = asWorldState(value);
  if (state !== undefined) return { kind: 'full', state };
  return { kind: 'full', state: { unrenderable: String(typeof value) } };
}

function formatValue(value: WorldStateValue): string {
  if (value === null) return 'none';
  if (Array.isArray(value)) return value.length === 0 ? '(none)' : value.join(', ');
  return String(value);
}
