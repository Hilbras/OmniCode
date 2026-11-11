import { z } from 'zod';
import { normalize, sep } from 'pathe';

import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import type { AgentTool } from '@hilbras/omnicode-engine/tool/toolContract';
import type { PathClass } from '@hilbras/omnicode-engine/tool/path-access';

export const GIT_WORKTREE_TIMEOUT_MS = 20_000;
export const GIT_WORKTREE_MAX_OUTPUT_CHARS = 65_536;

export const branchNameSchema = z
  .string()
  .min(1)
  .max(200)
  .describe('New branch name. Must be a valid git branch name.');

export const WorktreeListInputSchema = z.object({}).strict();
export type WorktreeListInput = z.infer<typeof WorktreeListInputSchema>;

export const WorktreeCreateInputSchema = z.object({
  branch: branchNameSchema,
  path: z.string().min(1).describe('Worktree directory. Must be inside the repository.'),
  base: z.string().min(1).max(200).optional().describe('Optional base revision; defaults to HEAD.'),
});
export type WorktreeCreateInput = z.infer<typeof WorktreeCreateInputSchema>;

export const WorktreeRemoveInputSchema = z.object({
  path: z.string().min(1).describe('Registered worktree path. Dirty worktrees are refused.'),
});
export type WorktreeRemoveInput = z.infer<typeof WorktreeRemoveInputSchema>;

export interface WorktreeEntry {
  readonly path: string;
  readonly head?: string;
  readonly branch?: string;
  readonly bare: boolean;
  readonly detached: boolean;
  readonly locked: boolean;
  readonly prunable: boolean;
}

export function parseWorktreePorcelain(text: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: {
    path?: string;
    head?: string;
    branch?: string;
    bare: boolean;
    detached: boolean;
    locked: boolean;
    prunable: boolean;
  } = { bare: false, detached: false, locked: false, prunable: false };
  const flush = () => {
    if (current.path === undefined) return;
    entries.push({
      path: current.path,
      ...(current.head === undefined ? {} : { head: current.head }),
      ...(current.branch === undefined ? {} : { branch: current.branch }),
      bare: current.bare,
      detached: current.detached,
      locked: current.locked,
      prunable: current.prunable,
    });
    current = { bare: false, detached: false, locked: false, prunable: false };
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) current.path = line.slice('worktree '.length);
    else if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length);
    else if (line.startsWith('branch ')) current.branch = line.slice('branch '.length);
    else if (line === 'bare') current.bare = true;
    else if (line === 'detached') current.detached = true;
    else if (line.startsWith('locked')) current.locked = true;
    else if (line.startsWith('prunable')) current.prunable = true;
  }
  flush();
  return entries;
}

export function extractWorktreeBranch(entry: WorktreeEntry): string | undefined {
  return entry.branch?.replace(/^refs\/heads\//, '');
}

export function validateBranchName(name: string): string | undefined {
  if (name.length === 0 || name.length > 200) return 'Branch name must be 1-200 characters.';
  if (name.startsWith('-')) return 'Branch name must not start with "-".';
  if (name.endsWith('.') || name.endsWith('/') || name.endsWith('.lock')) {
    return 'Branch name has an invalid suffix.';
  }
  if (name.includes('..') || name.includes('@{') || name.includes('//')) {
    return 'Branch name contains an invalid sequence.';
  }
  if (/[\u0000-\u001f\u007f ~^:?*[\\]/.test(name)) {
    return 'Branch name contains a character git rejects.';
  }
  return undefined;
}

export function validateRefName(name: string): string | undefined {
  if (name.startsWith('-')) return 'Base revision must not start with "-".';
  if (/[\u0000-\u001f\u007f ~^:?*[\\]/.test(name)) {
    return 'Base revision contains a character git rejects.';
  }
  return undefined;
}

export function isPathInsideRepository(
  target: string,
  repoRoot: string,
  pathClass: PathClass,
): boolean {
  const candidate = comparable(normalize(target), pathClass);
  const root = comparable(normalize(repoRoot), pathClass);
  if (candidate === root) return false;
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate.startsWith(prefix);
}

function comparable(path: string, pathClass: PathClass): string {
  return pathClass === 'win32' ? path.toLowerCase() : path;
}

export interface IGitWorktreeListTool extends AgentTool<WorktreeListInput> {
  readonly _serviceBrand: undefined;
}
export const IGitWorktreeListTool = createDecorator<IGitWorktreeListTool>('gitWorktreeListTool');

export interface IGitWorktreeCreateTool extends AgentTool<WorktreeCreateInput> {
  readonly _serviceBrand: undefined;
}
export const IGitWorktreeCreateTool = createDecorator<IGitWorktreeCreateTool>('gitWorktreeCreateTool');

export interface IGitWorktreeRemoveTool extends AgentTool<WorktreeRemoveInput> {
  readonly _serviceBrand: undefined;
}
export const IGitWorktreeRemoveTool = createDecorator<IGitWorktreeRemoveTool>('gitWorktreeRemoveTool');
