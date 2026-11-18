export interface ProfileStatement {
  readonly content: string;
  readonly subject: string;
}

interface Rule {
  readonly regex: RegExp;
  readonly subject: string;
  readonly render: (value: string, match: RegExpExecArray) => string;
}

const NAME_RULES: readonly Rule[] = [
  {
    regex: /\bmy name is ([A-Za-z][A-Za-z .'-]{1,60}?)(?:[.,!?]|$)/gi,
    subject: 'profile.name',
    render: (value) => `my name is ${value}`,
  },
  {
    regex: /\bcall me ([A-Za-z][A-Za-z .'-]{1,60}?)(?:[.,!?]|$)/gi,
    subject: 'profile.name',
    render: (value) => `my name is ${value}`,
  },
];

const RULES: readonly Rule[] = [
  {
    regex: /\bi(?:'m| am)? (?:live|based) in ([A-Za-z][A-Za-z .',-]{1,60}?)(?:[.!?]|$)/gi,
    subject: 'profile.location',
    render: (value) => `I live in ${value}`,
  },
  {
    regex: /\bi(?:'m| am) from ([A-Za-z][A-Za-z .',-]{1,60}?)(?:[.!?]|$)/gi,
    subject: 'profile.location',
    render: (value) => `I live in ${value}`,
  },
  {
    regex: /\bmy (?:location|city|town) is ([A-Za-z][A-Za-z .',-]{1,60}?)(?:[.!?]|$)/gi,
    subject: 'profile.location',
    render: (value) => `I live in ${value}`,
  },
  {
    regex: /\bmy timezone is ([A-Za-z0-9/_+ -]{1,40}?)(?:[.!?]|$)/gi,
    subject: 'profile.timezone',
    render: (value) => `my timezone is ${value}`,
  },
  {
    regex: /\bi(?:'m| am) in the ([A-Za-z0-9/_+ -]{1,40}?) timezone/gi,
    subject: 'profile.timezone',
    render: (value) => `my timezone is ${value}`,
  },
  {
    regex: /\bi work as (?:an? )?([A-Za-z][A-Za-z -]{1,60}?)(?:[.!?]|$)/gi,
    subject: 'profile.occupation',
    render: (value) => `I work as ${value}`,
  },
  {
    regex: /\bmy (?:job|role|position) is (?:an? )?([A-Za-z][A-Za-z -]{1,60}?)(?:[.!?]|$)/gi,
    subject: 'profile.occupation',
    render: (value) => `I work as ${value}`,
  },
  {
    regex: /\bi work at ([A-Za-z0-9][A-Za-z0-9 .&,'-]{1,60}?)(?:[.!?]|$)/gi,
    subject: 'profile.employer',
    render: (value) => `I work at ${value}`,
  },
  {
    regex: /\bmy (?:company|employer) is ([A-Za-z0-9][A-Za-z0-9 .&,'-]{1,60}?)(?:[.!?]|$)/gi,
    subject: 'profile.employer',
    render: (value) => `I work at ${value}`,
  },
  {
    regex: /\bi speak ([A-Za-z][A-Za-z ,-]{1,40}?)(?:[.!?]|$)/gi,
    subject: 'profile.language',
    render: (value) => `I speak ${value}`,
  },
  {
    regex: /\bmy (?:native )?language is ([A-Za-z][A-Za-z ,-]{1,40}?)(?:[.!?]|$)/gi,
    subject: 'profile.language',
    render: (value) => `I speak ${value}`,
  },
  {
    regex: /\bi (?:prefer|like|always use|usually use) ([A-Za-z0-9][A-Za-z0-9 ._+/-]{1,40}?)(?:[.!?]|$)/gi,
    subject: 'profile.preference',
    render: (value) => `I prefer ${value}`,
  },
  {
    regex: /\bi (?:don't|do not) (?:like|want|use) ([A-Za-z0-9][A-Za-z0-9 ._+/-]{1,40}?)(?:[.!?]|$)/gi,
    subject: 'profile.preference',
    render: (value) => `I avoid ${value}`,
  },
  {
    regex: /\bi use (?!the\b|a\b|an\b)([A-Za-z0-9][A-Za-z0-9._+-]{0,30}?)(?:[.!?]|$)/gi,
    subject: 'profile.preference',
    render: (value) => `I use ${value}`,
  },
  {
    regex:
      /\bmy (editor|shell|terminal|package manager|os|operating system) is ([A-Za-z0-9][A-Za-z0-9 ._+/-]{1,40}?)(?:[.!?]|$)/gi,
    subject: 'profile.preference',
    render: (_value, match) => `my ${String(match[1])} is ${String(match[2])}`,
  },
];

const NOTE_RULES: readonly Rule[] = [
  {
    regex: /\b(?:remember|keep in mind|note) (?:that )?(I .+?)(?:[.!?]|$)/gi,
    subject: 'profile.note',
    render: (value) => value,
  },
  {
    regex: /\babout me[:,-]?\s+(.+?)(?:[.!?]|$)/gi,
    subject: 'profile.note',
    render: (value) => value,
  },
];

function clean(value: string): string {
  return value.replaceAll(/\s+/g, ' ').trim();
}

function clause(value: string): string {
  const [first] = clean(value).split(/\s+(?:and|but|so|because)\s+/i);
  return (first ?? '').replace(/[,;]$/, '').trim();
}

function slug(value: string): string {
  const words = clean(value).toLowerCase().split(' ').filter((word) => word.length > 0).slice(0, 4);
  const joined = words.join('-').replaceAll(/[^a-z0-9-]/g, '');
  return joined.length > 0 ? joined : 'statement';
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

  for (const rule of [...NAME_RULES, ...RULES, ...NOTE_RULES]) {
    rule.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.regex.exec(prompt)) !== null) {
      const raw = match[2] ?? match[1];
      const value =
        raw === undefined ? '' : rule.subject === 'profile.name' ? clean(raw) : clause(raw);
      if (value.length === 0) continue;
      const content = rule.render(value, match);
      const subject =
        rule.subject === 'profile.note' || rule.subject === 'profile.preference'
          ? `${rule.subject}.${slug(content)}`
          : rule.subject;
      push(content, subject);
    }
  }

  return found;
}
