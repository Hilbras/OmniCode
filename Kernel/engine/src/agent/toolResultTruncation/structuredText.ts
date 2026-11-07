export interface StructuredTextOptions {
  readonly maxArrayItems: number;
  readonly maxStringChars: number;
  readonly entropyThreshold: number;
  readonly maxDepth: number;
}

export interface StructuredTextResult {
  readonly text: string;
  readonly removedValues: number;
  readonly removedItems: number;
}

export const DEFAULT_STRUCTURED_TEXT_OPTIONS: StructuredTextOptions = {
  maxArrayItems: 25,
  maxStringChars: 160,
  entropyThreshold: 0.85,
  maxDepth: 32,
};

const OMITTED_ITEMS_KEY = '__omitted_items';
const OMITTED_CHARS_KEY = '__omitted_chars';

export function normalizedEntropy(text: string): number {
  if (text.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    entropy -= p * Math.log2(p);
  }
  const maxEntropy = counts.size > 1 ? Math.log2(counts.size) : 1;
  return maxEntropy > 0 ? entropy / maxEntropy : 0;
}

export function isDenseIdentifier(value: string, threshold = 0.85): boolean {
  if (value.length === 0) return false;
  if (value.includes(' ')) return false;
  return normalizedEntropy(value) >= threshold;
}

export function compactStructuredText(
  raw: string,
  options: StructuredTextOptions = DEFAULT_STRUCTURED_TEXT_OPTIONS,
): StructuredTextResult | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const counters = { removedValues: 0, removedItems: 0 };
  const compacted = compactValue(parsed, options, 0, counters);
  if (counters.removedValues === 0 && counters.removedItems === 0) {
    const text = JSON.stringify(compacted);
    return text === undefined ? undefined : { text, removedValues: 0, removedItems: 0 };
  }
  const text = JSON.stringify(compacted);
  return text === undefined
    ? undefined
    : { text, removedValues: counters.removedValues, removedItems: counters.removedItems };
}

function compactValue(
  value: unknown,
  options: StructuredTextOptions,
  depth: number,
  counters: { removedValues: number; removedItems: number },
): unknown {
  if (depth >= options.maxDepth) return value;
  if (typeof value === 'string') return compactString(value, options, counters);
  if (Array.isArray(value)) return compactArray(value, options, depth, counters);
  if (value !== null && typeof value === 'object') {
    return compactObject(value as Record<string, unknown>, options, depth, counters);
  }
  return value;
}

function compactString(
  value: string,
  options: StructuredTextOptions,
  counters: { removedValues: number; removedItems: number },
): string {
  if (value.length <= options.maxStringChars) return value;
  if (isDenseIdentifier(value, options.entropyThreshold)) return value;
  counters.removedValues += 1;
  return `[${OMITTED_CHARS_KEY}:${value.length}]`;
}

function compactArray(
  value: readonly unknown[],
  options: StructuredTextOptions,
  depth: number,
  counters: { removedValues: number; removedItems: number },
): unknown[] {
  const out: unknown[] = [];
  const keep = Math.min(value.length, options.maxArrayItems);
  for (let index = 0; index < keep; index += 1) {
    out.push(compactValue(value[index], options, depth + 1, counters));
  }
  const omitted = value.length - keep;
  if (omitted > 0) {
    counters.removedItems += omitted;
    out.push({ [OMITTED_ITEMS_KEY]: omitted });
  }
  return out;
}

function compactObject(
  value: Record<string, unknown>,
  options: StructuredTextOptions,
  depth: number,
  counters: { removedValues: number; removedItems: number },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    out[key] = compactValue(value[key], options, depth + 1, counters);
  }
  return out;
}
