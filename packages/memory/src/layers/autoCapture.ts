export type AutoCaptureCategory = 'fact' | 'preference';

export interface AutoCaptureStatement {
  readonly content: string;
  readonly category: AutoCaptureCategory;
  readonly scope: 'global' | 'repository';
}

const NAME_PATTERNS: readonly RegExp[] = [
  /\bmy name is ([A-Za-z][A-Za-z .'-]{1,60}?)(?:[.,!?]|$)/gi,
  /\bcall me ([A-Za-z][A-Za-z .'-]{1,60}?)(?:[.,!?]|$)/gi,
];

interface Pattern {
  readonly regex: RegExp;
  readonly category: AutoCaptureCategory;
  readonly scope: 'global' | 'repository';
}

const PATTERNS: readonly Pattern[] = [
  {
    regex: /\b(?:remember|keep in mind|don't forget|do not forget|note) (?:that )?(.+?)(?:\.|$)/gi,
    category: 'fact',
    scope: 'repository',
  },
  {
    regex: /\bsave (?:it|this|that)?\s*(?:to|in) memory[: ,-]*(.+?)(?:\.|$)/gi,
    category: 'fact',
    scope: 'repository',
  },
  {
    regex: /\b(?:my|our) (?:preference|convention|rule) is (?:that )?(.+?)(?:\.|$)/gi,
    category: 'preference',
    scope: 'global',
  },
  {
    regex: /\b(?:from now on|going forward),?\s+(?:always )?(.+?)(?:\.|$)/gi,
    category: 'preference',
    scope: 'global',
  },
];

export function extractAutoCaptureStatements(prompt: string): readonly AutoCaptureStatement[] {
  const found: AutoCaptureStatement[] = [];
  const seen = new Set<string>();
  for (const regex of NAME_PATTERNS) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(prompt)) !== null) {
      const name = match[1]?.trim();
      if (name === undefined || name.length === 0) continue;
      const content = `my name is ${name}`;
      const key = content.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ content, category: 'fact', scope: 'global' });
    }
  }
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(prompt)) !== null) {
      const content = match[1]?.trim();
      if (content === undefined || content.length === 0) continue;
      const key = content.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ content, category: pattern.category, scope: pattern.scope });
    }
  }
  return found;
}
