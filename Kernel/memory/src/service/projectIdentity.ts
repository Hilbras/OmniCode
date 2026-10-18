import { findGitWorkTree } from '@hilbras/omnicode-core/app/git/workTree';
import type { IHostFileSystem } from '@hilbras/omnicode-core/os/interface/hostFileSystem';

import { hashContent } from './memoryRecordFactory';

export interface ProjectIdentity {
  readonly projectId: string;
  readonly projectRoot: string;
}

export async function resolveProjectIdentity(
  fs: IHostFileSystem,
  cwd: string,
): Promise<ProjectIdentity | undefined> {
  try {
    const workTree = await findGitWorkTree(fs, cwd);
    const projectRoot = workTree?.root ?? cwd;
    return { projectRoot, projectId: hashContent(projectRoot).slice(0, 16) };
  } catch {
    return undefined;
  }
}