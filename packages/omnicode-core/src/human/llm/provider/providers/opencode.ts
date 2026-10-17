import type { ProviderConnection } from '#/llm/protocol/connection';

export const OPENCODE_FREE_BASE_URL = 'https://opencode.ai/inference/v1';
export const OPENCODE_FREE_CLIENT_VERSION = '2.0.29';

const SESSION_PREFIX_MASK = (1n << 48n) - 1n;
const MAX_COUNTER_PER_MS = 16;
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

export const OPENCODE_SESSION_PATTERN = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;

let lastTimestamp = 0;
let counter = 0;
let cached: { readonly sessionId: string; readonly mintedAt: number } | undefined;

function nextRandomBase62_14(): string {
  let out = '';
  for (let i = 0; i < 14; i++) {
    out += BASE62[Math.floor(Math.random() * BASE62.length)];
  }
  return out;
}

function createSessionId(timestamp: number, sequence: number): string {
  const extraMs = Math.floor(sequence / MAX_COUNTER_PER_MS);
  const effectiveCounter = (sequence % MAX_COUNTER_PER_MS) + 1;
  const current = BigInt(timestamp + extraMs) * 0x1000n + BigInt(effectiveCounter);
  const value = ~current & SESSION_PREFIX_MASK;
  return `ses_${value.toString(16).padStart(12, '0')}${nextRandomBase62_14()}`;
}

function mint(now: number): string {
  if (now !== lastTimestamp) {
    lastTimestamp = now;
    counter = 0;
  }
  counter++;
  return createSessionId(now, counter - 1);
}

export function opencodeFreeSessionId(now: number = Date.now()): string {
  const existing = cached;
  if (existing !== undefined && now - existing.mintedAt < SESSION_TTL_MS) {
    return existing.sessionId;
  }
  const sessionId = mint(now);
  cached = { sessionId, mintedAt: now };
  return sessionId;
}

export function resetOpencodeFreeSession(): void {
  cached = undefined;
  lastTimestamp = 0;
  counter = 0;
}

export function opencodeFreeTierHeaders(sessionId: string): Record<string, string> {
  return {
    Accept: 'text/event-stream',
    'User-Agent': `opencode/latest/${OPENCODE_FREE_CLIENT_VERSION}/cli`,
    'x-opencode-client': 'cli',
    'x-opencode-project': 'global',
    'x-opencode-session': sessionId,
    'x-opencode-session-id': sessionId,
    'x-session-affinity': sessionId,
    'x-session-id': sessionId,
  };
}

export const OPENCODE_FINGERPRINT_TOOL_NAMES = ['read', 'shell'] as const;

const OPENCODE_FINGERPRINT_TOOL_DEFINITIONS: Readonly<
  Record<(typeof OPENCODE_FINGERPRINT_TOOL_NAMES)[number], { description: string; parameters: Record<string, unknown> }>
> = {
  read: {
    description:
      'Read the contents of a file or directory. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>. The prefix is for reference and is not part of the file content. Directory entries are returned one per line. Use offset and limit to read large files or directories in sections. Prefer one larger read over many small slices, and use grep to find specific content in large files.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File or directory to read' },
        offset: {
          type: 'integer',
          minimum: 0,
          description: 'The line or directory entry to start reading from (1-based)',
        },
        limit: {
          type: 'integer',
          minimum: 0,
          description:
            'The maximum number of lines or directory entries to read (defaults to and capped at 2000)',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  shell: {
    description:
      'Execute a shell command and return its output. Commands run on Linux using bash. Quote file paths containing spaces or special characters. Prefer dedicated tools over shell commands when possible. When output is large, the full result is saved to a file and a truncated preview is returned. Rely on automatic truncation unless filtering the output is more useful. Commands accept an optional timeout, background commands have no timeout by default. Background commands return immediately, and you will be notified when they complete.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command string to execute' },
        workdir: {
          type: 'string',
          description:
            'Working directory to execute the command in. Defaults to the current working directory. When possible, avoid changing directories in the command and set the working directory here instead.',
        },
        timeout: {
          type: 'integer',
          minimum: 0,
          description:
            'Timeout in milliseconds. Set to 0 to disable the timeout. Defaults to 120000 for foreground commands. Background commands have no timeout by default.',
        },
        background: {
          type: 'boolean',
          description:
            'Run the command in the background and return immediately (useful for dev servers and long-running builds). You do not need to use & at the end of the command when using this parameter. You will be notified when it completes. DO NOT poll for completion.',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
  },
};

export function opencodeFingerprintTools(): readonly Record<string, unknown>[] {
  return OPENCODE_FINGERPRINT_TOOL_NAMES.map((name) => ({
    type: 'function',
    function: {
      name,
      description: OPENCODE_FINGERPRINT_TOOL_DEFINITIONS[name].description,
      parameters: OPENCODE_FINGERPRINT_TOOL_DEFINITIONS[name].parameters,
    },
  }));
}

export const OPENCODE_PLACEHOLDER_NOTE = `Do not call the ${OPENCODE_FINGERPRINT_TOOL_NAMES.map((n) => `\`${n}\``).join(' or ')} tools; they are placeholders that do nothing. Use the other tools you have been given instead.`;

const MIN_ANSWER_TOKENS = 1024;
const THINKING_BUDGET = 4096;
const MIN_PLAIN_TOKENS = 512;
const MAX_OUTPUT_TOKENS = 131072;
const REASONING_MODEL_HINTS = [
  'muse',
  'mimo',
  'nemotron',
  'longcat',
  'cat-jam',
  'pickle',
  'step-',
  'deepseek',
];

function wireToolName(tool: unknown): string {
  if (tool === null || typeof tool !== 'object') return '';
  const record = tool as Record<string, unknown>;
  if (typeof record['name'] === 'string') return record['name'].trim();
  const fn = record['function'];
  if (fn !== null && typeof fn === 'object') {
    const name = (fn as Record<string, unknown>)['name'];
    if (typeof name === 'string') return name.trim();
  }
  return '';
}

function wireToolBody(tool: Record<string, unknown>): Record<string, unknown> {
  const fn = tool['function'];
  if (fn !== null && typeof fn === 'object') return fn as Record<string, unknown>;
  const copy = { ...tool };
  delete copy['type'];
  return copy;
}

export interface FreeTierTokenBudget {
  readonly remainingContextTokens?: number;
  readonly thinkingRequested: boolean;
}

function effectiveMaxTokens(
  requested: unknown,
  modelId: string,
  budget: FreeTierTokenBudget,
): number {
  const wanted =
    typeof requested === 'number' && Number.isFinite(requested) && requested >= 0
      ? Math.floor(requested)
      : MAX_OUTPUT_TOKENS;
  const id = modelId.toLowerCase();
  const reasoning =
    budget.thinkingRequested && REASONING_MODEL_HINTS.some((hint) => id.includes(hint));
  const floor = Math.max(wanted, reasoning ? MIN_ANSWER_TOKENS : MIN_PLAIN_TOKENS);
  const withThinking = floor + (reasoning ? THINKING_BUDGET : 0);
  const capped =
    budget.remainingContextTokens === undefined
      ? withThinking
      : Math.min(withThinking, Math.max(1, budget.remainingContextTokens));
  return Math.min(capped, MAX_OUTPUT_TOKENS);
}

export function applyOpencodeFreeTierPayload(
  params: Record<string, unknown>,
  modelId: string,
  budget: FreeTierTokenBudget = { thinkingRequested: true },
): Record<string, unknown> {
  const next = { ...params };
  const taken = new Set<string>();
  const exact = new Set<string>();
  const clientTools = Array.isArray(next['tools']) ? (next['tools'] as unknown[]) : [];
  const aliased = clientTools.map((tool) => {
    if (tool === null || typeof tool !== 'object') return tool;
    const name = wireToolName(tool);
    if (name === '') return tool;
    taken.add(name);
    const collision =
      !(OPENCODE_FINGERPRINT_TOOL_NAMES as readonly string[]).includes(name) ||
      JSON.stringify(wireToolBody(tool as Record<string, unknown>)) !==
        JSON.stringify({
          name,
          description: OPENCODE_FINGERPRINT_TOOL_DEFINITIONS[
            name as (typeof OPENCODE_FINGERPRINT_TOOL_NAMES)[number]
          ].description,
          parameters:
            OPENCODE_FINGERPRINT_TOOL_DEFINITIONS[
              name as (typeof OPENCODE_FINGERPRINT_TOOL_NAMES)[number]
            ].parameters,
        });
    if (!collision) {
      exact.add(name);
      return tool;
    }
    let alias = `${name}_client`;
    for (let i = 2; taken.has(alias); i++) alias = `${name}_client${i}`;
    taken.add(alias);
    const body = wireToolBody(tool as Record<string, unknown>);
    const hasFn = (tool as Record<string, unknown>)['function'] !== undefined;
    return hasFn
      ? { type: 'function', function: { ...body, name: alias } }
      : { ...(tool as Record<string, unknown>), name: alias };
  });
  next['tools'] = [
    ...aliased,
    ...opencodeFingerprintTools().filter((tool) => {
      const name = wireToolName(tool);
      return !exact.has(name);
    }),
  ];

  const messages = Array.isArray(next['messages']) ? (next['messages'] as unknown[]) : [];
  next['messages'] = [{ role: 'system', content: OPENCODE_PLACEHOLDER_NOTE }, ...messages];

  for (const key of ['max_completion_tokens', 'max_tokens'] as const) {
    if (typeof next[key] === 'number') {
      next[key] = effectiveMaxTokens(next[key], modelId, budget);
    }
  }
  return next;
}

export const opencodeFreeTierConnection: ProviderConnection = {
  endpoint: () => ({ defaultBaseUrl: OPENCODE_FREE_BASE_URL }),
  defaultHeaders: () => opencodeFreeTierHeaders(opencodeFreeSessionId()),
};