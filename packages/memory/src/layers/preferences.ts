const PREFERENCE_PATTERNS: readonly RegExp[] = [
  /\bi (?:prefer|like|always use|always want|want) (.+?)(?:\.|$)/gi,
  /\b(?:from now on|going forward),?\s+(.+?)(?:\.|$)/gi,
  /\bi (?:don't|do not) (?:like|want) (.+?)(?:\.|$)/gi,
  /\b(?:always|never) (.+?)(?:\.|$)/gi,
];

export function extractPreferences(prompt: string): readonly string[] {
  const found: string[] = [];
  for (const pattern of PREFERENCE_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(prompt)) !== null) {
      const phrase = match[1]?.trim();
      if (phrase !== undefined && phrase.length > 0) found.push(phrase);
    }
  }
  return dedupe(found);
}

export function preferenceSubject(phrase: string): string {
  const slug = phrase
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug.length > 0 ? `pref:${slug}` : 'pref:statement';
}

function dedupe(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}