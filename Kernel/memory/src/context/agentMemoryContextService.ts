import { createDecorator } from '@hilbras/omnicode-core/_base/di/instantiation';
import { Service } from '@hilbras/omnicode-core/_base/di/service';
import { ILogService, type ILogger } from '@hilbras/omnicode-core/_base/log/log';
import { IHostFileSystem } from '@hilbras/omnicode-core/os/interface/hostFileSystem';
import { ISessionContext } from '@hilbras/omnicode-core/session/sessionContext/sessionContext';
import { IAgentContextMemoryService } from '@hilbras/omnicode-core/agent/contextMemory/contextMemory';

import type { MemorySearchQuery } from '#/contracts/memoryContract';
import type { MemoryScope, MemoryScopeTier } from '#/contracts/memoryTypes';
import type { RetrievalResult } from '#/contracts/retrieval';
import { IMemoryService } from '#/contracts/memoryContract';
import { resolveProjectIdentity } from '#/service/projectIdentity';

export type MemoryWriteScopeTier = Exclude<MemoryScopeTier, 'task'>;

export interface IAgentMemoryContextService {
  readonly _serviceBrand: undefined;
  search(query: MemorySearchQuery): Promise<RetrievalResult>;
  projectId(): Promise<string | undefined>;
  projectRoot(): string | undefined;
  lastUserPrompt(): string | undefined;
  sessionId(): string;
  workspaceId(): string;
  scopeFor(tier: MemoryWriteScopeTier): Promise<MemoryScope | undefined>;
}

export const IAgentMemoryContextService = createDecorator<IAgentMemoryContextService>(
  'agentMemoryContextService',
);

export const MEMORY_INJECTION_VARIANT = 'memory_canonical';
export const MEMORY_RESTORE_VARIANT = 'memory_task_restore';
export const MEMORY_PREFERENCES_VARIANT = 'memory_preferences';
export const MEMORY_PHRASES_VARIANT = 'memory_phrases';

export class AgentMemoryContextService extends Service implements IAgentMemoryContextService {
  declare readonly _serviceBrand: undefined;

  private readonly log: ILogger;
  private readonly fs: IHostFileSystem;
  private readonly session: ISessionContext;
  private readonly memory: IMemoryService;
  private readonly context: IAgentContextMemoryService;
  private rootPromise: Promise<void> | undefined;
  private resolvedProjectId: string | undefined;
  private resolvedRoot: string | undefined;

  constructor(
    @ILogService log: ILogService,
    @IHostFileSystem fs: IHostFileSystem,
    @ISessionContext session: ISessionContext,
    @IMemoryService memory: IMemoryService,
    @IAgentContextMemoryService context: IAgentContextMemoryService,
  ) {
    super();
    this.log = log.child({ memory: 'agent-context' });
    this.fs = fs;
    this.session = session;
    this.memory = memory;
    this.context = context;
  }

  async projectId(): Promise<string | undefined> {
    await this.resolveRoot();
    return this.resolvedProjectId;
  }

  projectRoot(): string | undefined {
    return this.resolvedRoot;
  }

  async search(query: MemorySearchQuery): Promise<RetrievalResult> {
    const projectId = await this.projectId();
    return this.memory.search({ workspaceId: this.session.workspaceId, projectId, ...query });
  }

  sessionId(): string {
    return this.session.sessionId;
  }

  workspaceId(): string {
    return this.session.workspaceId;
  }

  async scopeFor(tier: MemoryWriteScopeTier): Promise<MemoryScope | undefined> {
    if (tier === 'global') return { tier };
    if (tier === 'workspace') return { tier, workspaceId: this.session.workspaceId };
    const projectId = await this.projectId();
    if (projectId === undefined) return undefined;
    if (tier === 'repository') return { tier, workspaceId: this.session.workspaceId, projectId };
    return { tier, workspaceId: this.session.workspaceId, projectId, sessionId: this.session.sessionId };
  }

  lastUserPrompt(): string | undefined {
    const history = this.context.get();
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const message = history[index];
      if (message === undefined || message.origin?.kind !== 'user') continue;
      const text = message.content
        .map((part) => (part.type === 'text' ? part.text : ''))
        .join(' ')
        .trim();
      if (text.length > 0) return text;
    }
    return undefined;
  }

  private async resolveRoot(): Promise<void> {
    this.rootPromise ??= (async () => {
      const resolved = await resolveProjectIdentity(this.fs, this.session.cwd);
      if (resolved === undefined) {
        this.log.warn('memory project identity unavailable');
        return;
      }
      this.resolvedRoot = resolved.projectRoot;
      this.resolvedProjectId = resolved.projectId;
    })();
    return this.rootPromise;
  }
}