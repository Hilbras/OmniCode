import { Service } from '@hilbras/omnicode-base/di/service';
import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { ILogService, type ILogger } from '@hilbras/omnicode-base/log/log';
import { IEventBus } from '@hilbras/omnicode-engine/app/event/eventBus';
import { IFlagService } from '@hilbras/omnicode-engine/app/flag/flag';
import { CompactionCompleted } from '@hilbras/omnicode-engine/agent/fullCompaction/compactionOps';
import { ISessionContext } from '@hilbras/omnicode-engine/session/sessionContext/sessionContext';

import { IAgentMemoryContextService } from '#/context/agentMemoryContextService';
import { IMemoryService } from '#/contracts/memoryContract';
import { MEMORY_FLAG_ID } from '#/feature/flag';

import { captureCompactionTaskState } from './compactionSummary';

export interface IMemoryCompactionCapture {
  readonly _serviceBrand: undefined;
}

export const IMemoryCompactionCapture = createDecorator<IMemoryCompactionCapture>(
  'memoryCompactionCapture',
);

/**
 * Turns a finished full compaction into the session's task state, so a resumed
 * or restarted session recovers its objective, decisions and next move from
 * memory even when the transcript is gone.
 *
 * The agent-scoped `IEventBus` view only delivers this agent's events, and the
 * subscription is registered on scope creation — with the flag off the handler
 * returns before touching the store, so behavior is unchanged.
 */
export class AgentMemoryCompactionCapture extends Service implements IMemoryCompactionCapture {
  declare readonly _serviceBrand: undefined;

  private readonly log: ILogger;

  constructor(
    @ILogService log: ILogService,
    @IMemoryService private readonly memory: IMemoryService,
    @ISessionContext private readonly session: ISessionContext,
    @IAgentMemoryContextService private readonly context: IAgentMemoryContextService,
    @IEventBus bus: IEventBus,
    @IFlagService private readonly flags: IFlagService,
  ) {
    super();
    this.log = log.child({ memory: 'compaction' });
    this._register(
      bus.subscribe(CompactionCompleted, (event) => {
        void this.capture(event.result.summary);
      }),
    );
  }

  private async capture(summary: string): Promise<void> {
    if (!this.flags.enabled(MEMORY_FLAG_ID) || !this.memory.enabled) return;
    try {
      const scope = await this.context.scopeFor('session');
      if (scope === undefined) return;
      const now = Date.now();
      const result = await captureCompactionTaskState(this.memory, {
        taskId: this.session.sessionId,
        scope,
        summary,
        evidence: [
          {
            kind: 'observation',
            ref: `session:${this.session.sessionId}`,
            state: 'present',
            observedAt: now,
          },
        ],
      });
      if (result === undefined) {
        this.log.info('compaction summary carried no task state');
        return;
      }
      if (result.status !== 'stored') {
        this.log.warn('compaction task state was not stored', {
          status: result.status,
          reason: result.reason,
        });
      }
    } catch (error) {
      this.log.warn('compaction task state capture failed', { error: String(error) });
    }
  }
}
