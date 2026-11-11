import { createHash, randomUUID } from 'node:crypto';
import { join } from 'pathe';

import type { IHostFileSystem } from '@hilbras/omnicode-engine/os/interface/hostFileSystem';

import { truncateTextAtCharBoundary } from '#/diagnostics/toolResultDiagnostics';
import { writeTextAtomic } from '#/shared/atomicWrite';

export const ARTIFACT_KIND = 'artifact' as const;
export const SOURCE_KIND = 'source' as const;
export type SessionRecordKind = typeof ARTIFACT_KIND | typeof SOURCE_KIND;

export const ARTIFACT_DIR = 'artifacts';
export const SOURCE_DIR = 'sources';
export const DEFAULT_ARTIFACT_MAX_CHARS = 256 * 1024;
export const MAX_ARTIFACT_CHARS = 1024 * 1024;
export const DEFAULT_SOURCE_EXCERPT_CHARS = 24_000;
export const MAX_SOURCE_EXCERPT_CHARS = 128 * 1024;
export const RECORD_NAME_MAX_CHARS = 200;
export const RECORD_NOTE_MAX_CHARS = 1_000;

export interface RecordProvenance {
  readonly sessionId: string;
  readonly agentId: string;
  readonly toolCallId?: string;
  readonly turnId?: number;
  readonly origin: 'agent-tool';
}

export interface RecordSourceLocation {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly totalLines: number;
}

export interface SessionRecord {
  readonly id: string;
  readonly kind: SessionRecordKind;
  readonly name: string;
  readonly mediaType?: string;
  readonly note?: string;
  readonly storedChars: number;
  readonly originalChars: number;
  readonly truncated: boolean;
  readonly originalSha256: string;
  readonly storedSha256: string;
  readonly createdAt: number;
  readonly provenance: RecordProvenance;
  readonly source?: RecordSourceLocation;
}

export interface SaveSessionRecordInput {
  readonly kind: SessionRecordKind;
  readonly name: string;
  readonly content: string;
  readonly maxChars: number;
  readonly mediaType?: string;
  readonly note?: string;
  readonly source?: RecordSourceLocation;
  readonly provenance: RecordProvenance;
}

export interface SaveSessionRecordResult {
  readonly record: SessionRecord;
  readonly path: string;
  readonly relativePath: string;
}

export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function recordFileName(kind: SessionRecordKind, id: string): string {
  return `${kind}-${id}.json`;
}

export class SessionRecordStore {
  constructor(
    private readonly fs: IHostFileSystem,
    private readonly sessionDir: string,
    private readonly idFactory: () => string = randomUUID,
    private readonly now: () => number = Date.now,
  ) {}

  async save(input: SaveSessionRecordInput): Promise<SaveSessionRecordResult> {
    if (input.name.trim().length === 0 || input.name.length > RECORD_NAME_MAX_CHARS) {
      throw new Error(`Record name must be 1-${String(RECORD_NAME_MAX_CHARS)} characters.`);
    }
    if (input.note !== undefined && input.note.length > RECORD_NOTE_MAX_CHARS) {
      throw new Error(`Record note must be at most ${String(RECORD_NOTE_MAX_CHARS)} characters.`);
    }
    const kindMax = input.kind === ARTIFACT_KIND ? MAX_ARTIFACT_CHARS : MAX_SOURCE_EXCERPT_CHARS;
    const maxChars = Math.max(1, Math.min(input.maxChars, kindMax));
    const stored = truncateTextAtCharBoundary(input.content, maxChars);
    const id = this.idFactory();
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) {
      throw new Error('Record id contains invalid characters.');
    }
    const directory = join(this.sessionDir, input.kind === ARTIFACT_KIND ? ARTIFACT_DIR : SOURCE_DIR);
    const path = join(directory, recordFileName(input.kind, id));
    const record: SessionRecord = {
      id,
      kind: input.kind,
      name: input.name,
      ...(input.mediaType === undefined ? {} : { mediaType: input.mediaType }),
      ...(input.note === undefined ? {} : { note: input.note }),
      storedChars: stored.length,
      originalChars: input.content.length,
      truncated: stored.length < input.content.length,
      originalSha256: sha256(input.content),
      storedSha256: sha256(stored),
      createdAt: this.now(),
      provenance: input.provenance,
      ...(input.source === undefined ? {} : { source: input.source }),
    };
    await writeTextAtomic(
      this.fs,
      path,
      `${JSON.stringify({ record, content: stored }, null, 2)}\n`,
    );
    return {
      record,
      path,
      relativePath: path.slice(this.sessionDir.length).replace(/^\/+/, ''),
    };
  }
}

export function sourceLines(text: string): string[] {
  if (text.length === 0) return [];
  const lines = text.split(/\r?\n/);
  if (text.endsWith('\n') && lines.at(-1) === '') lines.pop();
  return lines;
}

export function sourceLocation(
  path: string,
  lines: readonly string[],
  startLine: number,
  endLine: number,
): { source: RecordSourceLocation; content: string } {
  if (startLine < 1 || endLine < startLine || startLine > lines.length) {
    throw new Error(`Invalid line range ${String(startLine)}-${String(endLine)}.`);
  }
  const boundedEnd = Math.min(endLine, lines.length);
  const slice = lines.slice(startLine - 1, boundedEnd);
  return {
    source: {
      path,
      startLine,
      endLine: boundedEnd,
      totalLines: lines.length,
    },
    content: slice.join('\n'),
  };
}
