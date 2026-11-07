import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import type { FsDiffResponse, FsGitStatusResponse } from '#/app/git/git';

export interface IWorkspaceGitService {
  readonly _serviceBrand: undefined;

  status(pathFilter?: ReadonlySet<string>): Promise<FsGitStatusResponse>;
  diff(relPath: string, absPath: string): Promise<FsDiffResponse>;
}

export const IWorkspaceGitService: ServiceIdentifier<IWorkspaceGitService> =
  createDecorator<IWorkspaceGitService>('workspaceGitService');
