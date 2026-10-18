import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type CassetteMode = 'replay' | 'record';

export const CASSETTE_RECORD_ENV = 'OMNICODE_CASSETTE_RECORD';

const REDACTED_HEADERS = new Set(['authorization', 'api-key', 'x-api-key', 'cookie', 'set-cookie']);

const UNREPLAYABLE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'set-cookie',
]);

export interface CassetteRequestRecord {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

export interface CassetteResponseRecord {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface CassetteEntry {
  readonly key: string;
  readonly request: CassetteRequestRecord;
  readonly response: CassetteResponseRecord;
}

export interface CassetteFile {
  readonly version: 1;
  readonly name: string;
  readonly entries: readonly CassetteEntry[];
}

export interface FetchCassetteOptions {
  readonly file: string;
  readonly name: string;
  readonly mode: CassetteMode;
  readonly inner?: typeof globalThis.fetch;
}

export interface FetchCassette {
  readonly mode: CassetteMode;
  readonly calls: readonly CassetteRequestRecord[];
  readonly missed: readonly string[];
  readonly recorded: readonly CassetteEntry[];
  readonly fetch: typeof globalThis.fetch;
  flush(): Promise<void>;
}

export function cassetteKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${url}`;
}

export function cassetteModeFromEnv(name: string): CassetteMode {
  const raw = process.env[CASSETTE_RECORD_ENV];
  if (raw === undefined || raw === '') return 'replay';
  if (raw === '1' || raw === 'true') return 'record';
  return raw.split(',').some((token) => token.trim() === name) ? 'record' : 'replay';
}

export function isPreservedEnvKey(key: string): boolean {
  return key === CASSETTE_RECORD_ENV;
}

function toHeaders(
  source: ConstructorParameters<typeof Headers>[0] | undefined | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (source === undefined || source === null) return out;
  new Headers(source).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function redact(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = REDACTED_HEADERS.has(key.toLowerCase()) ? '[redacted]' : value;
  }
  return out;
}

function keepReplayable(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!UNREPLAYABLE_HEADERS.has(key.toLowerCase())) out[key] = value;
  }
  return out;
}

async function toRequestRecord(
  input: Parameters<typeof globalThis.fetch>[0],
  init: RequestInit | undefined,
): Promise<CassetteRequestRecord> {
  if (input instanceof Request) {
    const headers = toHeaders(input.headers);
    return { method: input.method, url: input.url, headers, body: await readBody(input) };
  }
  const url = input instanceof URL ? input.href : input;
  const headers = toHeaders(init?.headers);
  const body = typeof init?.body === 'string' ? init.body : null;
  return { method: (init?.method ?? 'GET').toUpperCase(), url, headers, body };
}

async function readBody(request: Request): Promise<string | null> {
  try {
    return await request.clone().text();
  } catch {
    return null;
  }
}

function toResponse(record: CassetteResponseRecord): Response {
  const headers = new Headers(record.headers);
  if (record.status === 204 || record.status === 304) {
    return new Response(null, { status: record.status, statusText: record.statusText, headers });
  }
  return new Response(record.body, {
    status: record.status,
    statusText: record.statusText,
    headers,
  });
}

function serialize(name: string, entries: readonly CassetteEntry[]): string {
  const file: CassetteFile = { version: 1, name, entries };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export async function readCassette(file: string): Promise<CassetteFile | undefined> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  const parsed = JSON.parse(text) as CassetteFile;
  if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error(`cassette ${file} is not a version 1 cassette file`);
  }
  return parsed;
}

export async function openFetchCassette(options: FetchCassetteOptions): Promise<FetchCassette> {
  const inner = options.inner ?? globalThis.fetch;
  const calls: CassetteRequestRecord[] = [];
  const missed: string[] = [];
  const recorded: CassetteEntry[] = [];
  const counters = new Map<string, number>();

  const replayable = new Map<string, CassetteResponseRecord[]>();
  if (options.mode === 'replay') {
    const file = await readCassette(options.file);
    if (file === undefined) {
      throw new Error(
        `cassette "${options.name}" is missing at ${options.file}; record it with ${CASSETTE_RECORD_ENV}=1`,
      );
    }
    for (const entry of file.entries) {
      const bucket = replayable.get(entry.key);
      if (bucket === undefined) {
        replayable.set(entry.key, [entry.response]);
      } else {
        bucket.push(entry.response);
      }
    }
  }

  async function cassetteFetch(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: RequestInit,
  ): Promise<Response> {
    const call = await toRequestRecord(input, init);
    calls.push({ ...call, headers: redact(call.headers) });
    const key = cassetteKey(call.method, call.url);
    const index = counters.get(key) ?? 0;
    counters.set(key, index + 1);

    if (options.mode === 'replay') {
      const response = replayable.get(key)?.[index];
      if (response === undefined) {
        const detail = `cassette "${options.name}" has no entry #${index} for "${key}"`;
        missed.push(detail);
        throw new Error(detail);
      }
      return toResponse(response);
    }

    const response = await inner(input, init);
    const body = await response.clone().text();
    recorded.push({
      key,
      request: { ...call, headers: redact(call.headers) },
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: keepReplayable(toHeaders(response.headers)),
        body,
      },
    });
    return response;
  }

  return {
    mode: options.mode,
    calls,
    missed,
    recorded,
    fetch: cassetteFetch as typeof globalThis.fetch,
    async flush() {
      if (options.mode !== 'record') return;
      await mkdir(dirname(options.file), { recursive: true });
      await writeFile(options.file, serialize(options.name, recorded), 'utf8');
    },
  };
}

export async function withFetchCassette<T>(
  options: FetchCassetteOptions,
  run: (cassette: FetchCassette) => Promise<T>,
): Promise<T> {
  const cassette = await openFetchCassette(options);
  const original = globalThis.fetch;
  globalThis.fetch = cassette.fetch;
  try {
    return await run(cassette);
  } finally {
    globalThis.fetch = original;
    await cassette.flush();
  }
}
