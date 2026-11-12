import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { TeamPersistence, TeamState } from './types';

const EMPTY_STATE: TeamState = { teams: [], members: [], tasks: [] };

export class FileTeamPersistence implements TeamPersistence {
  constructor(private readonly path: string) {}

  async load(): Promise<TeamState> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown;
      return isTeamState(parsed) ? parsed : EMPTY_STATE;
    } catch (error) {
      if (isMissingFile(error)) return EMPTY_STATE;
      throw error;
    }
  }

  async save(state: TeamState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temp, this.path);
  }
}

function isTeamState(value: unknown): value is TeamState {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record['teams']) && Array.isArray(record['members']) && Array.isArray(record['tasks']);
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}
