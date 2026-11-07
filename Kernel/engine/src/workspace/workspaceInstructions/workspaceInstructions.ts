import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import type { Event } from '@hilbras/omnicode-base/event';
import type { WatchChange } from '#human/utils/watch';
import type { ISessionInstructionsProvider } from '#/session/sessionInstructions/instructionsProvider';

export interface WorkspaceInstructionsSnapshot {
  readonly agentsMd: string | undefined;
  readonly agentsMdWarning: string | undefined;
  readonly agentsMdPaths: readonly string[] | undefined;
}

export interface IWorkspaceInstructionsService {
  readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly snapshot: WorkspaceInstructionsSnapshot;
  readonly onDidChange: Event<readonly WatchChange[]>;
  reload(): Promise<void>;
  sessionProvider(): ISessionInstructionsProvider;
}

export const IWorkspaceInstructionsService: ServiceIdentifier<IWorkspaceInstructionsService> =
  createDecorator<IWorkspaceInstructionsService>('workspaceInstructionsService');
