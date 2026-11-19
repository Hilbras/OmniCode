import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

import type { FileHistoryPatch } from './patchRender';

export interface FileBackupEntry {
  readonly key: string | null;
  readonly version: number;
  readonly contentHash?: string;
  readonly size?: number;
  readonly oversize?: boolean;
  readonly mtimeMs?: number;
}

export type FileHistoryCheckpointPhase = 'start' | 'end';

export interface FileHistoryCheckpointRecord {
  readonly turnId: number;
  readonly phase?: FileHistoryCheckpointPhase;
  readonly entries: Readonly<Record<string, FileBackupEntry>>;
}

export interface FileHistoryState {
  readonly checkpoints: readonly FileHistoryCheckpointRecord[];
  readonly tracked: readonly string[];
}

export type FileHistoryChangeStatus = 'added' | 'modified' | 'deleted';

export interface FileHistoryChange {
  readonly path: string;
  readonly status: FileHistoryChangeStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly binary?: boolean;
  readonly oversize?: boolean;
}

export interface FileHistoryContent {
  readonly version: number;
  readonly content?: string;
  readonly binary?: boolean;
}

export type FileHistoryRestoreState =
  | 'restored'
  | 'unchanged'
  | 'conflict'
  | 'oversize'
  | 'unavailable';

export interface FileHistoryRestoreOutcome {
  readonly path: string;
  readonly state: FileHistoryRestoreState;
  readonly detail?: string;
}

export interface FileHistoryRestoreResult {
  readonly turnId: number;
  readonly files: readonly FileHistoryRestoreOutcome[];
}

export interface FileHistoryRestoreOptions {
  readonly force?: boolean;
}

export interface FileHistoryTurnSummary {
  readonly turnId: number;
  readonly changes: readonly FileHistoryChange[];
}

/** Scope of a rendered patch: one turn, or every retained turn merged per path. */
export type FileHistoryPatchScope = 'turn' | 'session';

export interface FileHistoryPatchInput {
  readonly scope: FileHistoryPatchScope;
  /** Target turn for `scope: 'turn'`; defaults to the latest recorded turn. */
  readonly turnId?: number;
  /** Render the reverse patch (after → before). */
  readonly reverse?: boolean;
}

export interface IAgentFileHistoryService {
  readonly _serviceBrand: undefined;

  history(): FileHistoryState;
  settled(): Promise<void>;
  captureForActiveTurn(path: string): Promise<void>;
  changes(turnId: number): Promise<FileHistoryChange[]>;
  turnRecorded(turnId: number): Promise<boolean>;
  contentAt(
    turnId: number,
    path: string,
    phase?: FileHistoryCheckpointPhase,
  ): Promise<FileHistoryContent | undefined>;
  turns(): Promise<FileHistoryTurnSummary[]>;
  restore(
    turnId: number,
    paths?: readonly string[],
    options?: FileHistoryRestoreOptions,
  ): Promise<FileHistoryRestoreResult>;
  /**
   * Complete, uncapped unified diff over the durable checkpoints — the format
   * `git apply` accepts. Binary and oversize files are excluded with a reason
   * rather than rendered partially. An `unavailable` result means the scope
   * names a turn with no recorded history.
   */
  patch(input: FileHistoryPatchInput): Promise<FileHistoryPatchResult>;
}

export const IAgentFileHistoryService: ServiceIdentifier<IAgentFileHistoryService> =
  createDecorator<IAgentFileHistoryService>('agentFileHistoryService');

export const FILE_HISTORY_BLOB_PREFIX = 'file-history';

export interface FileHistoryPatchResult {
  readonly scope: FileHistoryPatchScope;
  readonly turnId?: number;
  readonly patch: FileHistoryPatch;
}
