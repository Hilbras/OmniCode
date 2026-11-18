const OPT_OUT_PATTERNS: readonly RegExp[] = [
  /\bdon'?t (?:remember|save|store|keep) (?:this|that|it|anything)\b/i,
  /\bdo not (?:remember|save|store|keep) (?:this|that|it|anything)\b/i,
  /\bforget (?:this|that|it|this turn|what i (?:just )?said)\b/i,
  /\boff the record\b/i,
  /\bno memory (?:of|for) (?:this|that)\b/i,
  /\b(?:keep|leave) (?:this|that|it) out of (?:your )?memory\b/i,
];

export function isMemoryOptOut(text: string): boolean {
  return OPT_OUT_PATTERNS.some((pattern) => pattern.test(text));
}
