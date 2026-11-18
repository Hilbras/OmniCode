export interface StreamJsonInputOptions {
  readonly onLine?: (value: unknown) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return undefined;
  const direct = value['text'];
  if (typeof direct === 'string') return direct;
  const content = value['content'];
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const part of content) {
    if (!isRecord(part)) continue;
    if (part['type'] === 'text' && typeof part['text'] === 'string') parts.push(part['text']);
  }
  return parts.length > 0 ? parts.join('') : undefined;
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
  let raw = '';
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    raw += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
  }
  return raw;
}

export async function readStreamJsonPrompt(
  stream: NodeJS.ReadableStream,
  options: StreamJsonInputOptions = {},
): Promise<string> {
  const raw = await readAll(stream);
  const texts: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      throw new Error(`Invalid JSON input line: ${trimmed.slice(0, 120)}`);
    }
    options.onLine?.(parsed);
    if (isRecord(parsed) && parsed['type'] !== undefined && parsed['type'] !== 'user' && parsed['type'] !== 'text') {
      continue;
    }
    const text = textOf(parsed);
    if (text === undefined || text.length === 0) {
      throw new Error('Every stream-json input line must carry text.');
    }
    texts.push(text);
  }
  if (texts.length === 0) throw new Error('No input received on stdin.');
  return texts.join('\n');
}

export async function readTextPrompt(stream: NodeJS.ReadableStream): Promise<string> {
  const text = await readAll(stream);
  if (text.trim().length === 0) throw new Error('No input received on stdin.');
  return text;
}
