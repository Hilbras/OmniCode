import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';

export interface IAgentFileReadCacheService {
  readonly _serviceBrand: undefined;

  record(path: string): Promise<void>;
  verify(path: string): Promise<string | undefined>;
}

export const IAgentFileReadCacheService =
  createDecorator<IAgentFileReadCacheService>('agentFileReadCacheService');

export const FILE_CHANGED_SINCE_READ = 'FILE_CHANGED_SINCE_READ';
