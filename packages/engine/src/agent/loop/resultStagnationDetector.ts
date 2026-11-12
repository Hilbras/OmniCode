/**
 * Tool-result stagnation detector.
 *
 * Where the streaming text detector watches the assistant's prose, this one
 * watches what the tools return: the same call producing the same output, a
 * read tool polling state it already observed, and a run of reads that keeps
 * re-reading the same paths after a write released the workspace. Those are
 * the shapes a stalled agent takes when it stops making progress but keeps
 * calling tools.
 *
 * The detector is pure and side-effect free; deciding what to do with a signal
 * (reminder, telemetry, turn cap) belongs to the caller.
 */

export type ResultStagnationKind = 'stateful-polling' | 'repeated-result' | 'read-churn';

export interface StagnationObservation {
  /** Tool name, for reporting only. */
  readonly name: string;
  /** Identity of the call: tool plus normalized arguments. */
  readonly callSignature: string;
  /** Identity of the result the call produced. */
  readonly outputSignature: string;
  /** True when the shared read-only predicate classified the call as a pure read. */
  readonly readOnly: boolean;
}

export interface ResultStagnationSignal {
  readonly kind: ResultStagnationKind;
  readonly tool: string;
  readonly occurrences: number;
  /** Human-readable evidence describing what repeated. */
  readonly detail: string;
}

export interface ResultStagnationDetectorOptions {
  /** Identical call+output pairs needed before a signal fires. Default 3. */
  readonly repeatThreshold?: number;
  /** Consecutive read-only calls needed before read-churn can fire. Default 4. */
  readonly readChurnThreshold?: number;
  /** Signatures retained per turn, bounding memory on very long turns. Default 512. */
  readonly maxSignaturesPerTurn?: number;
}

export interface ResultStagnationSnapshot {
  readonly signatureCounts: ReadonlyMap<string, number>;
  readonly runSignatures: ReadonlySet<string>;
  readonly consecutiveReads: number;
  readonly armed: boolean;
  readonly saturated: boolean;
}

const DEFAULTS = {
  repeatThreshold: 3,
  readChurnThreshold: 4,
  maxSignaturesPerTurn: 512,
} as const;

/** FNV-1a over the text; cheap, stable, and enough to tell two outputs apart. */
function digest(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Normalizes a tool result into a comparable signature without keeping the payload. */
export function outputSignatureOf(output: unknown): string {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? null);
  const normalized = text ?? '';
  return `${normalized.length}:${digest(normalized)}`;
}

/** Normalizes a tool call into a comparable signature without keeping the payload. */
export function callSignatureOf(name: string, args: unknown): string {
  const text = JSON.stringify(args ?? null) ?? '';
  return `${name}#${text.length}:${digest(text)}`;
}

export class ResultStagnationDetector {
  private readonly signatureCounts = new Map<string, number>();
  private readonly runSignatures = new Set<string>();
  private consecutiveReads = 0;
  private armed = false;
  private saturated = false;

  private readonly repeatThreshold: number;
  private readonly readChurnThreshold: number;
  private readonly maxSignaturesPerTurn: number;

  constructor(options: ResultStagnationDetectorOptions = {}) {
    this.repeatThreshold = positiveInteger(options.repeatThreshold, DEFAULTS.repeatThreshold);
    this.readChurnThreshold = positiveInteger(
      options.readChurnThreshold,
      DEFAULTS.readChurnThreshold,
    );
    this.maxSignaturesPerTurn = positiveInteger(
      options.maxSignaturesPerTurn,
      DEFAULTS.maxSignaturesPerTurn,
    );
  }

  push(observation: StagnationObservation): ResultStagnationSignal | undefined {
    if (!observation.readOnly) {
      // A non-read tool is what makes later re-reads suspicious: the world may
      // have changed, so a repeated read is now evidence of churn.
      this.armed = true;
      this.consecutiveReads = 0;
      this.runSignatures.clear();
      return this.record(observation);
    }

    this.consecutiveReads += 1;
    const key = signatureKey(observation);
    const repeatedInRun = this.runSignatures.has(key);
    this.runSignatures.add(key);

    if (this.armed && this.consecutiveReads >= this.readChurnThreshold && repeatedInRun) {
      return {
        kind: 'read-churn',
        tool: observation.name,
        occurrences: this.consecutiveReads,
        detail: `${observation.name} re-read state it already had ${this.consecutiveReads} calls into the read run`,
      };
    }

    return this.record(observation);
  }

  reset(): void {
    this.signatureCounts.clear();
    this.runSignatures.clear();
    this.consecutiveReads = 0;
    this.armed = false;
    this.saturated = false;
  }

  /** Captured before a step so a retried step does not double-count its observations. */
  snapshot(): ResultStagnationSnapshot {
    return {
      signatureCounts: new Map(this.signatureCounts),
      runSignatures: new Set(this.runSignatures),
      consecutiveReads: this.consecutiveReads,
      armed: this.armed,
      saturated: this.saturated,
    };
  }

  restore(snapshot: ResultStagnationSnapshot): void {
    this.signatureCounts.clear();
    for (const [key, count] of snapshot.signatureCounts) this.signatureCounts.set(key, count);
    this.runSignatures.clear();
    for (const key of snapshot.runSignatures) this.runSignatures.add(key);
    this.consecutiveReads = snapshot.consecutiveReads;
    this.armed = snapshot.armed;
    this.saturated = snapshot.saturated;
  }

  private record(observation: StagnationObservation): ResultStagnationSignal | undefined {
    const key = signatureKey(observation);
    const seen = this.signatureCounts.get(key);
    if (seen === undefined && this.signatureCounts.size >= this.maxSignaturesPerTurn) {
      // Bound memory rather than grow without limit; the turn already produced
      // more distinct results than a healthy one does.
      this.saturated = true;
      return undefined;
    }

    const occurrences = (seen ?? 0) + 1;
    this.signatureCounts.set(key, occurrences);
    if (occurrences < this.repeatThreshold) return undefined;

    return {
      kind: observation.readOnly ? 'stateful-polling' : 'repeated-result',
      tool: observation.name,
      occurrences,
      detail:
        occurrenceDetail(observation.name, occurrences) +
        (observation.readOnly ? ' and the output never changed' : ''),
    };
  }
}

function occurrenceDetail(name: string, occurrences: number): string {
  return `${name} produced the same result ${occurrences} times`;
}

function signatureKey(observation: StagnationObservation): string {
  return `${observation.callSignature}|${observation.outputSignature}`;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isInteger(value) && value >= 1 ? value : fallback;
}
