import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';
import type { ScopeSeed } from '@hilbras/omnicode-base/di/scope';
import type { Event } from '@hilbras/omnicode-base/event';
import type { WatchChange } from '#human/utils/watch';

export interface ISessionInstructionsProvider {
  readonly _serviceBrand: undefined;

  readonly ready: Promise<void>;
  readonly agentsMd: string | undefined;
  readonly agentsMdWarning: string | undefined;
  readonly agentsMdPaths: readonly string[] | undefined;
  readonly onDidChange: Event<readonly WatchChange[]>;
}

export const ISessionInstructionsProvider: ServiceIdentifier<ISessionInstructionsProvider> =
  createDecorator<ISessionInstructionsProvider>('sessionInstructionsProvider');

export function sessionInstructionsProviderSeed(
  provider: ISessionInstructionsProvider,
): ScopeSeed {
  return [[ISessionInstructionsProvider as ServiceIdentifier<unknown>, provider]];
}
