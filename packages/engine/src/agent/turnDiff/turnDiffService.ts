import { Disposable } from '@hilbras/omnicode-base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { TurnEnded } from '#/agent/loop/turnOps';
import { TurnStarted } from '#/agent/loop/turnEvents';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { IAgentToolExecutorService } from '#/agent/toolExecutor/toolExecutor';
import type { WillExecuteToolEvent } from '#/agent/toolExecutor/toolHooks';
import { IEventBus } from '#/app/event/eventBus';
import { IHostFileSystem } from '#/os/interface/hostFileSystem';
import { ISessionWorkspaceContext } from '#/session/workspaceContext/workspaceContext';
import type { ToolAccesses } from '#/tool/toolContract';

import { IAgentTurnDiffService, type TurnDiffSnapshot } from './turnDiff';
import { turnDiffPath } from './turnDiffOps';
import { TurnDiffTracker, type TurnDiffCapture } from './turnDiffTracker';

/** Files above this size are reported as oversize rather than read and diffed. */
const MAX_TRACKED_FILE_BYTES = 1_000_000;

/**
 * Records which files each turn changed and how much.
 *
 * The pre-write content is captured on the tool-execution hook, before the
 * tool runs; the post-write content is captured after it, and again when the
 * turn ends so a write with no reported access cannot hide a delta. Snapshots
 * are in memory and bounded; the CLI `/diff` command reads them.
 */
export class AgentTurnDiffService extends Disposable implements IAgentTurnDiffService {
  declare readonly _serviceBrand: undefined;

  private readonly tracker = new TurnDiffTracker();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    @IEventBus eventBus: IEventBus,
    @IAgentToolExecutorService toolExecutor: IAgentToolExecutorService,
    @IHostFileSystem private readonly fs: IHostFileSystem,
    @ISessionWorkspaceContext private readonly workspace: ISessionWorkspaceContext,
    @IAgentScopeContext private readonly agentCtx: IAgentScopeContext,
  ) {
    super();
    this._register(
      eventBus.subscribe(TurnStarted, (event) => {
        if (event.agentId !== this.agentCtx.agentId) return;
        this.tracker.begin(event.turnId);
      }),
    );
    this._register(
      eventBus.subscribe(TurnEnded, (event) => {
        if (event.agentId !== this.agentCtx.agentId) return;
        void this.enqueue(() => this.finalize(event.turnId));
      }),
    );
    this._register(
      toolExecutor.onWillExecuteTool((event) => {
        const paths = writePaths(event.execution.accesses);
        if (paths.length === 0) return;
        event.waitUntil(this.enqueue(() => this.captureBefore(event.turnId, paths)));
      }),
    );
    this._register(
      toolExecutor.hooks.onDidExecuteTool.register('turnDiff', async (ctx, next) => {
        if (ctx.outcome === 'executed') {
          const paths = writePaths(ctx.accesses);
          if (paths.length > 0) await this.enqueue(() => this.captureAfter(ctx.turnId, paths));
        }
        await next();
      }),
    );
  }

  activeTurn(): number | undefined {
    return this.tracker.activeTurn();
  }

  settled(): Promise<void> {
    return this.queue;
  }

  snapshot(turnId: number): Promise<TurnDiffSnapshot | undefined> {
    return this.enqueueValue(async () => this.tracker.snapshot(turnId));
  }

  latest(): Promise<TurnDiffSnapshot | undefined> {
    return this.enqueueValue(async () => {
      const turnId = this.tracker.activeTurn() ?? this.tracker.latestTurn();
      return turnId === undefined ? undefined : this.tracker.snapshot(turnId);
    });
  }

  turns(): Promise<readonly TurnDiffSnapshot[]> {
    return this.enqueueValue(async () => this.tracker.closedSnapshots());
  }

  private async captureBefore(turnId: number, paths: readonly string[]): Promise<void> {
    for (const raw of paths) {
      const path = turnDiffPath(raw, this.workspace.workDir);
      if (this.tracker.hasBefore(turnId, path.key)) continue;
      this.tracker.noteBefore(turnId, path.key, path.absolute, await this.capture(path.absolute));
    }
  }

  private async captureAfter(turnId: number, paths: readonly string[]): Promise<void> {
    for (const raw of paths) {
      const path = turnDiffPath(raw, this.workspace.workDir);
      this.tracker.noteAfter(turnId, path.key, path.absolute, await this.capture(path.absolute));
    }
  }

  private async finalize(turnId: number): Promise<void> {
    if (!this.tracker.isTracked(turnId)) return;
    for (const path of this.tracker.trackedPaths(turnId)) {
      this.tracker.noteAfter(turnId, path.key, path.absolute, await this.capture(path.absolute));
    }
    this.tracker.close(turnId);
  }

  private async capture(absolute: string): Promise<TurnDiffCapture> {
    try {
      const stat = await this.fs.stat(absolute);
      if (stat.size > MAX_TRACKED_FILE_BYTES) return { captured: true, oversize: true };
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { captured: true };
      return { captured: false };
    }
    try {
      return { captured: true, content: await this.fs.readText(absolute) };
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { captured: true };
      return { captured: false };
    }
  }

  private enqueue(op: () => Promise<void>): Promise<void> {
    const run = this.queue.then(op);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private enqueueValue<T>(op: () => Promise<T>): Promise<T> {
    const run = this.queue.then(op);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

function writePaths(accesses: ToolAccesses | undefined): readonly string[] {
  if (accesses === undefined) return [];
  const paths: string[] = [];
  for (const access of accesses) {
    if (access.kind !== 'file') continue;
    if (access.operation !== 'write' && access.operation !== 'readwrite') continue;
    paths.push(access.path);
  }
  return paths;
}

function errorCode(error: unknown): unknown {
  return (error as { code?: unknown }).code;
}

registerScopedService(
  LifecycleScope.Agent,
  IAgentTurnDiffService,
  AgentTurnDiffService,
  ScopeActivation.OnScopeCreated,
  'turnDiff',
);