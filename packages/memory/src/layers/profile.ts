export interface ProfileStatement {
  readonly content: string;
  readonly subject: string;
}

const NAME_PATTERNS: readonly RegExp[] = [
  /\bmy name is ([A-Za-z][A-Za-z .'-]{1,60}?)(?:[.,!?]|$)/gi,
  /\bcall me ([A-Za-z][A-Za-z .'-]{1,60}?)(?:[.,!?]|$)/gi,
];

const LOCATION_PATTERN =
  /\bi(?:'m| am)? (?:live|based) in ([A-Za-z][A-Za-z .',-]{1,60}?)(?:[.!?]|$)/gi;
const TIMEZONE_PATTERN = /\bmy timezone is ([A-Za-z0-9/_+ -]{1,40}?)(?:[.!?]|$)/gi;

function clean(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim();
}

export function extractProfileStatements(prompt: string): readonly ProfileStatement[] {
  const found: ProfileStatement[] = [];
  const seen = new Set<string>();
  const push = (content: string, subject: string): void => {
    const key = `${subject}:${content.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ content, subject });
  };

  for (const pattern of NAME_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(prompt)) !== null) {
      const name = match[1] === undefined ? '' : clean(match[1]);
      if (name.length > 0) push(`my name is ${name}`, 'profile.name');
    }
  }

  for (const [pattern, subject, render] of [
    [LOCATION_PATTERN, 'profile.location', (value: string) => `I live in ${value}`],
    [TIMEZONE_PATTERN, 'profile.timezone', (value: string) => `my timezone is ${value}`],
  ] as const) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(prompt)) !== null) {
      const value = match[1] === undefined ? '' : clean(match[1]);
      if (value.length > 0) push(render(value), subject);
    }
  }

  return found;
}
