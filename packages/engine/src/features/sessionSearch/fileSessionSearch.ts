import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';

import { IBootstrapService } from '#/app/bootstrap/bootstrap';

import { LocalSessionSearchService, type SessionSearchDocument } from './localSessionSearch';
import type { ISessionSearchService, SessionSearchPage, SessionSearchQuery } from './sessionSearch';

const WIRE_FILENAME = 'wire.jsonl';
const MAX_DEPTH = 4;
const MAX_FILES = 2_000;
const MAX_DOCUMENTS = 10_000;
const SKIPPED_DIRS: ReadonlySet<string> = new Set(['.index-cache', 'blobs', 'attachments']);
const NON_USER_ORIGINS: ReadonlySet<string> = new Set([
  'injection',
  'system_trigger',
  'retry',
  'compaction_summary',
]);

interface WireMessage {
  readonly role?: unknown;
  readonly content?: unknown;
  readonly origin?: { readonly kind?: unknown };
}

export class FileSessionSearchSource {
  constructor(private readonly sessionsDir: string) {}

  async list(): Promise<readonly SessionSearchDocument[]> {
    const files = await collectWireFiles(this.sessionsDir);
    const documents: SessionSearchDocument[] = [];
    const titles = new Map<string, string>();
    for (const file of files) {
      if (documents.length >= MAX_DOCUMENTS) break;
      const layout = layoutOf(this.sessionsDir, file);
      if (layout === undefined) continue;
      let text: string;
      try {
        text = await readFile(file, 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        if (documents.length >= MAX_DOCUMENTS) break;
        const document = documentOf(line, layout, titles);
        if (document !== undefined) documents.push(document);
      }
    }
    return documents;
  }
}

export class FileSessionSearchService implements ISessionSearchService {
  declare readonly _serviceBrand: undefined;
  private readonly delegate: LocalSessionSearchService;

  constructor(@IBootstrapService bootstrap: IBootstrapService) {
    this.delegate = new LocalSessionSearchService(new FileSessionSearchSource(bootstrap.sessionsDir));
  }

  search(query: SessionSearchQuery): Promise<SessionSearchPage> {
    return this.delegate.search(query);
  }
}

interface SessionLayout {
  readonly sessionId: string;
  readonly agentId: string;
}

function layoutOf(root: string, file: string): SessionLayout | undefined {
  const parts = relative(root, dirname(file)).split(sep).filter((part) => part.length > 0);
  if (parts.length === 0) return undefined;
  const agentsIndex = parts.indexOf('agents');
  if (agentsIndex !== -1 && agentsIndex + 2 <= parts.length) {
    const sessionId = parts[agentsIndex - 1];
    const agentId = parts[agentsIndex + 1];
    if (sessionId === undefined || agentId === undefined) return undefined;
    return { sessionId, agentId };
  }
  return { sessionId: basename(dirname(file)), agentId: 'main' };
}

async function collectWireFiles(root: string): Promise<readonly string[]> {
  const files: string[] = [];
  async function walk(directory: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) return;
      if (entry.isSymbolicLink()) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name)) continue;
        await walk(path, depth + 1);
        continue;
      }
      if (entry.isFile() && entry.name === WIRE_FILENAME) files.push(path);
    }
  }
  await walk(root, 0);
  return files;
}

function documentOf(
  line: string,
  layout: SessionLayout,
  titles: Map<string, string>,
): SessionSearchDocument | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  let record: unknown;
  try {
    record = JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const entry = record as {
    type?: unknown;
    time?: unknown;
    agentId?: unknown;
    message?: WireMessage;
    userInput?: unknown;
  };
  if (entry.type !== 'context.append_message') return undefined;
  const message = entry.message;
  if (message === null || typeof message !== 'object') return undefined;
  const role = message.role === 'user' || message.role === 'assistant' ? message.role : undefined;
  if (role === undefined) return undefined;
  if (role === 'user' && typeof message.origin?.kind === 'string') {
    if (NON_USER_ORIGINS.has(message.origin.kind)) return undefined;
  }
  const text = textOf(message.content);
  if (text.trim().length === 0) return undefined;
  const titleKey = layout.sessionId;
  if (role === 'user' && !titles.has(titleKey)) {
    titles.set(titleKey, text.trim().slice(0, 80));
  }
  const agentId = typeof entry.agentId === 'string' ? entry.agentId : layout.agentId;
  return {
    sessionId: layout.sessionId,
    sessionTitle: titles.get(titleKey) ?? layout.sessionId,
    agentId,
    role,
    text,
    time: normalizeTime(entry.time),
  };
}

function textOf(content: unknown): string {
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const part of content) {
    if (part === null || typeof part !== 'object') continue;
    const candidate = part as { type?: unknown; text?: unknown };
    if (candidate.type === 'text' && typeof candidate.text === 'string') text += candidate.text;
  }
  return text;
}

function normalizeTime(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return value > 1e12 ? Math.floor(value) : Math.floor(value * 1000);
}
