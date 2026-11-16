export type FrontmatterAttributes = Record<string, string | string[]>;

export type FrontmatterParseResult =
  | { readonly ok: true; readonly attributes: FrontmatterAttributes; readonly body: string }
  | { readonly ok: false; readonly reason: string };

function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (first === last && (first === '"' || first === "'")) {
      const inner = value.slice(1, -1);
      return first === '"' ? inner.replaceAll(/\\(["\\nrt])/g, (_, escape: string) => {
        if (escape === 'n') return '\n';
        if (escape === 'r') return '\r';
        if (escape === 't') return '\t';
        return escape;
      }) : inner.replaceAll("''", "'");
    }
  }
  return value;
}

function splitInlineList(value: string): string[] {
  const inner = value.slice(1, -1).trim();
  if (inner === '') return [];
  return inner
    .split(',')
    .map((part) => unquote(part.trim()))
    .filter((part) => part !== '');
}

export function parseFrontmatter(text: string): FrontmatterParseResult {
  const source = text.startsWith('\uFEFF') ? text.slice(1) : text;
  const firstBreak = source.indexOf('\n');
  const firstLine = (firstBreak === -1 ? source : source.slice(0, firstBreak)).replace(/\r$/, '');
  if (firstLine.trim() !== '---') {
    return { ok: true, attributes: {}, body: source };
  }

  const lines = source.slice(firstBreak + 1).split('\n');
  let closeIndex = -1;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]?.replace(/\r$/, '') ?? '';
    if (line.trim() === '---' || line.trim() === '...') {
      closeIndex = index;
      break;
    }
  }
  if (closeIndex === -1) {
    return { ok: false, reason: 'unterminated frontmatter' };
  }

  const attributes: FrontmatterAttributes = {};
  let listKey: string | undefined;
  for (const rawLine of lines.slice(0, closeIndex)) {
    const line = rawLine.replace(/\r$/, '');
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;

    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem !== null) {
      if (listKey === undefined) return { ok: false, reason: 'list item without a key' };
      const item = unquote((listItem[1] ?? '').trim());
      const current = attributes[listKey];
      const list = typeof current === 'string' ? (current === '' ? [] : [current]) : [...(current ?? [])];
      if (item !== '') list.push(item);
      attributes[listKey] = list;
      continue;
    }

    const pair = /^([A-Za-z0-9_-]+):(.*)$/.exec(line);
    if (pair === null) {
      if (/^\s+\S/.test(line)) continue;
      return { ok: false, reason: `unsupported frontmatter line: ${line}` };
    }

    const key = pair[1] ?? '';
    const rawValue = (pair[2] ?? '').trim();
    listKey = key;

    if (rawValue === '') {
      attributes[key] = '';
      continue;
    }
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      attributes[key] = splitInlineList(rawValue);
      continue;
    }
    attributes[key] = unquote(rawValue);
  }

  return {
    ok: true,
    attributes,
    body: lines
      .slice(closeIndex + 1)
      .join('\n')
      .replace(/^\n+/, ''),
  };
}

export function readAttribute(
  attributes: FrontmatterAttributes,
  key: string,
): string | undefined {
  const value = attributes[key];
  if (typeof value === 'string') return value === '' ? undefined : value;
  return undefined;
}

export function readListAttribute(
  attributes: FrontmatterAttributes,
  key: string,
): string[] | undefined {
  const value = attributes[key];
  if (Array.isArray(value)) return value.length > 0 ? value : undefined;
  if (typeof value === 'string' && value !== '') {
    const items = value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '');
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}
