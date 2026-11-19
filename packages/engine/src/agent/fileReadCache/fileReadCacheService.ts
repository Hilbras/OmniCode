import { Disposable } from '@hilbras/omnicode-base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { IHostFileSystem } from '#/os/interface/hostFileSystem';
import type { ToolAccesses, ToolFileAccess } from '#/tool/toolContract';
import { IAgentToolExecutorService } from '#/agent/toolExecutor/toolExecutor';

import {
  FILE_CHANGED_SINCE_READ,
  FILE_READ_EVICTED,
  IAgentFileReadCacheService,
} from './fileReadCache';

interface CachedRead {
  readonly mtimeMs: number;
  readonly size: number;
}

function fileAccesses(accesses: ToolAccesses | undefined): readonly ToolFileAccess[] {
  return (accesses ?? []).filter((access): access is ToolFileAccess => access.kind === 'file');
}

function isWrite(access: ToolFileAccess): boolean {
  return access.operation === 'write' || access.operation === 'readwrite';
}

export class AgentFileReadCacheService
  extends Disposable
  implements IAgentFileReadCacheService
{
  declare readonly _serviceBrand: undefined;
  private readonly reads = new Map<string, CachedRead>();
  private readonly evictedReads = new Set<string>();

  constructor(
    @IHostFileSystem private readonly fs: IHostFileSystem,
    @IAgentToolExecutorService executor: IAgentToolExecutorService,
  ) {
    super();
    this._register(
      executor.onBeforeExecuteTool((event) => {
        const writes = fileAccesses(event.execution.accesses).filter(isWrite);
        if (writes.length === 0) return;
        event.waitUntil(async () => {
          for (const access of writes) {
            const stale = await this.verify(access.path);
            if (stale !== undefined) return { veto: { output: stale, isError: true } };
          }
          return undefined;
        });
      }),
    );
    this._register(
      executor.hooks.onDidExecuteTool.register(
        'file-read-cache',
        async (context, next) => {
          if (context.outcome === 'executed' && context.result.isError !== true) {
            for (const access of fileAccesses(context.accesses)) {
              if (access.operation === 'read' || isWrite(access)) await this.record(access.path);
            }
          }
          await next();
        },
      ),
    );
  }

  async record(path: string): Promise<void> {
    try {
      const stat = await this.fs.stat(path);
      if (!stat.isFile) return;
      this.reads.set(path, { mtimeMs: stat.mtimeMs ?? 0, size: stat.size });
      // A fresh read puts the content back in the model's context — re-arm.
      this.evictedReads.delete(path);
    } catch {
      this.reads.delete(path);
    }
  }

  /** A Read result was evicted: block writes until the model reads the file again. */
  disarm(path: string): void {
    this.evictedReads.add(path);
  }

  async verify(path: string): Promise<string | undefined> {
    if (this.evictedReads.has(path)) {
      return `${FILE_READ_EVICTED}: ${path} was read earlier but that result is no longer in your context. Read it again before writing.`;
    }
    const cached = this.reads.get(path);
    if (cached === undefined) return undefined;
    let stat;
    try {
      stat = await this.fs.stat(path);
    } catch {
      return undefined;
    }
    if (!stat.isFile) return undefined;
    if (stat.mtimeMs === cached.mtimeMs && stat.size === cached.size) return undefined;
    return `${FILE_CHANGED_SINCE_READ}: ${path} changed on disk after it was read. Read it again before writing.`;
  }
}

registerScopedService(
  LifecycleScope.Agent,
  IAgentFileReadCacheService,
  AgentFileReadCacheService,
  ScopeActivation.OnScopeCreated,
  'fileReadCache',
);
