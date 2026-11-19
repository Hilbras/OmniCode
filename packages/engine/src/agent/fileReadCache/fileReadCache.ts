import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';

export interface IAgentFileReadCacheService {
  readonly _serviceBrand: undefined;

  record(path: string): Promise<void>;
  verify(path: string): Promise<string | undefined>;
  /** Mark a read whose result was evicted from context: a write must re-read first. */
  disarm(path: string): void;
}

export const IAgentFileReadCacheService =
  createDecorator<IAgentFileReadCacheService>('agentFileReadCacheService');

export const FILE_CHANGED_SINCE_READ = 'FILE_CHANGED_SINCE_READ';
export const FILE_READ_EVICTED = 'FILE_READ_EVICTED';
