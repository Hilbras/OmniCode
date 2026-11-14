import { randomUUID } from 'node:crypto';

import { isAbsolute } from 'pathe';

import { isPlainRecord } from '@hilbras/omnicode-base/utils/canonical-args';
import { Error2 } from '@hilbras/omnicode-base/errors/errors';
import { Disposable, toDisposable, type IDisposable } from '@hilbras/omnicode-base/di/lifecycle';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import {
  IAgentToolExecutorService,
  type ToolCallGuard,
} from '#/agent/toolExecutor/toolExecutor';
import type { BeforeExecuteDecision, BeforeToolExecuteEvent } from '#/agent/toolExecutor/toolHooks';
import type { ExecutableToolResult } from '#/tool/toolContract';
import type { PromptOrigin } from '#/agent/contextMemory/types';
import { IEventBus } from '#/app/event/eventBus';
import { ITelemetryService } from '#/app/telemetry/telemetry';
import { IAgentLoopService } from '#/agent/loop/loop';
import { TurnEnded } from '#/agent/loop/turnOps';
import { TurnStarted } from '#/agent/loop/turnEvents';
import { IHostFileSystem } from '#/os/interface/hostFileSystem';
import { ISessionWorkspaceContext } from '#/session/workspaceContext/workspaceContext';

import { SpeculationErrors } from './errors';
import {
  SPECULATION_FOLLOWUP_ORIGIN_NAME,
  IAgentSpeculationService,
} from './speculation';
import type {
  BeginSpeculationInput,
  LaunchSpeculationFollowUpInput,
  SpeculationAcceptResult,
  SpeculationBranchInfo,
} from './speculation';
import {
  applyOverlay,
  SpeculationOverlay,
  SpeculationOverlayFullError,
  type OverlayWriteTarget,
} from './speculationOverlay';
import {
  classifySpeculationTool,
  speculationRefusalMessage,
} from './speculationRisk';

const MAX_OVERLAY_CONTENT_CHARS = 1_000_000;

interface SpeculationBranch {
  readonly id: string;
  readonly origin: string;
  readonly overlay: SpeculationOverlay;
  readonly boundary: IDisposable;
  state: 'live' | 'settled';
  turnId?: number;
}

export class AgentSpeculationService extends Disposable implements IAgentSpeculationService {
  declare readonly _serviceBrand: undefined;

  private branch: SpeculationBranch | undefined;

  constructor(
    @IAgentToolExecutorService private readonly toolExecutor: IAgentToolExecutorService,
    @IAgentLoopService private readonly loop: IAgentLoopService,
    @IEventBus private readonly eventBus: IEventBus,
    @IHostFileSystem private readonly fs: IHostFileSystem,
    @ISessionWorkspaceContext private readonly workspace: ISessionWorkspaceContext,
    @IAgentScopeContext private readonly agentCtx: IAgentScopeContext,
    @ITelemetryService private readonly telemetry: ITelemetryService,
  ) {
    super();
    this._register(
      this.eventBus.subscribe(TurnStarted, (event) => {
        if (event.agentId !== this.agentCtx.agentId) return;
        const branch = this.branch;
        if (branch === undefined || branch.state !== 'live' || branch.turnId !== undefined) return;
        branch.turnId = event.turnId;
      }),
    );
    this._register(
      this.eventBus.subscribe(TurnEnded, (event) => {
        if (event.agentId !== this.agentCtx.agentId) return;
        const branch = this.branch;
        if (branch === undefined || branch.state !== 'live') return;
        if (branch.turnId !== event.turnId) return;
        this.settle();
      }),
    );
  }

  begin(input: BeginSpeculationInput): SpeculationBranchInfo {
    return branchInfo(this.beginBranch(input.origin));
  }

  launchFollowUp(input: LaunchSpeculationFollowUpInput): SpeculationBranchInfo {
    const snapshot = this.loop.snapshot();
    if (snapshot.state !== 'idle' || snapshot.hasPendingRequests) {
      throw new Error2(
        SpeculationErrors.codes.SPECULATION_LOOP_BUSY,
        'The agent is busy; a speculative follow-up needs an idle loop.',
      );
    }
    const prompt = input.prompt.trim();
    if (prompt.length === 0) {
      throw new Error2(
        SpeculationErrors.codes.SPECULATION_LOOP_BUSY,
        'The speculative follow-up prompt cannot be empty.',
      );
    }
    const branch = this.beginBranch('follow-up');
    try {
      const origin: PromptOrigin = {
        kind: 'system_trigger',
        name: SPECULATION_FOLLOWUP_ORIGIN_NAME,
      };
      this.loop.submit({
        message: {
          role: 'user',
          content: [{ type: 'text', text: prompt }],
        },
        meta: { origin },
      });
    } catch (error) {
      this.branch = undefined;
      branch.boundary.dispose();
      throw error;
    }
    return branchInfo(branch);
  }

  async accept(): Promise<SpeculationAcceptResult> {
    const branch = this.requireBranch();
    this.settle();
    const result = await applyOverlay(branch.overlay, this.writeTarget());
    if (result.failed === undefined) {
      branch.overlay.clear();
      this.branch = undefined;
    }
    this.telemetry.track2('speculation_branch', {
      outcome: result.failed === undefined ? 'accepted' : 'apply_failed',
      applied: result.applied.length,
    });
    return result;
  }

  discard(): void {
    const branch = this.requireBranch();
    this.settle();
    branch.overlay.clear();
    this.branch = undefined;
    this.telemetry.track2('speculation_branch', { outcome: 'discarded' });
  }

  status(): SpeculationBranchInfo | undefined {
    return this.branch === undefined ? undefined : branchInfo(this.branch);
  }

  private beginBranch(origin: string): SpeculationBranch {
    if (this.branch !== undefined) {
      throw new Error2(
        SpeculationErrors.codes.SPECULATION_BRANCH_ACTIVE,
        'A speculative branch is already active; accept or discard it first.',
      );
    }
    const branch: SpeculationBranch = {
      id: randomUUID(),
      origin,
      overlay: new SpeculationOverlay(),
      boundary: this.armBoundary(),
      state: 'live',
      turnId: this.loop.snapshot().activeTurnId,
    };
    this.branch = branch;
    this.telemetry.track2('speculation_branch', { outcome: 'started', origin });
    return branch;
  }

  private requireBranch(): SpeculationBranch {
    if (this.branch === undefined) {
      throw new Error2(
        SpeculationErrors.codes.SPECULATION_NO_BRANCH,
        'No speculative branch is active.',
      );
    }
    return this.branch;
  }

  private armBoundary(): IDisposable {
    const guard = this.toolExecutor.addToolCallGuard(speculationGuard(() => this.branch));
    // The redirect listener must register AFTER the permission gate's listener.
    // Before-execute listeners and their waitUntil decisions run in
    // registration order; the gate registers at scope creation and this
    // listener at begin(), so a denied approval always resolves before the
    // redirect decision and can never reach the overlay. The ordering is
    // pinned by the approval-ordering tests in speculationService.test.ts.
    const listener = this.toolExecutor.onBeforeExecuteTool((event) => {
      this.redirectOverlayableWrite(event);
    });
    return toDisposable(() => {
      listener.dispose();
      guard.dispose();
    });
  }

  private settle(): void {
    const branch = this.branch;
    if (branch === undefined) return;
    branch.state = 'settled';
    branch.boundary.dispose();
  }

  private redirectOverlayableWrite(event: BeforeToolExecuteEvent): void {
    const branch = this.branch;
    if (branch === undefined || branch.state !== 'live') return;
    const verdict = classifySpeculationTool(event.toolCall.name);
    if (verdict.verdict !== 'overlay') return;
    event.waitUntil(async () => recordOverlayWrite(branch.overlay, event));
  }

  private writeTarget(): OverlayWriteTarget {
    return {
      writeFile: async (path, content) => {
        const allowed = this.assertWritable(path);
        await this.fs.writeText(allowed, content);
      },
    };
  }

  private assertWritable(path: string): string {
    const absolute = isAbsolute(path) ? path : this.workspace.resolve(path);
    return this.workspace.assertAllowed(absolute, 'write');
  }
}

function branchInfo(branch: SpeculationBranch): SpeculationBranchInfo {
  return {
    id: branch.id,
    origin: branch.origin,
    turnId: branch.turnId,
    pendingPaths: branch.overlay.pendingPaths(),
    state: branch.state,
  };
}

function speculationGuard(currentBranch: () => SpeculationBranch | undefined): ToolCallGuard {
  return ({ name }) => {
    const branch = currentBranch();
    if (branch === undefined || branch.state !== 'live') return undefined;
    const verdict = classifySpeculationTool(name);
    if (verdict.verdict !== 'refused') return undefined;
    return speculationRefusalMessage(name, verdict.reason);
  };
}

/**
 * Records a whole-file write into the branch overlay instead of executing the
 * tool, and answers the call with a truthful synthetic result. Runs as a
 * `waitUntil` decision so the permission chain resolves first: a denied
 * approval never reaches the overlay, and an approved write is recorded
 * instead of executed — never both.
 */
async function recordOverlayWrite(
  overlay: SpeculationOverlay,
  event: BeforeToolExecuteEvent,
): Promise<BeforeExecuteDecision> {
  const args = event.args;
  if (!isPlainRecord(args)) {
    return { veto: overlayRefusal('Speculative overlay refused the write: malformed tool arguments.') };
  }
  const path = overlayWritePath(event, args);
  if (path === undefined) {
    return {
      veto: overlayRefusal('Speculative overlay refused the write: the tool exposed no write path.'),
    };
  }
  if (args['mode'] === 'append') {
    return {
      veto: overlayRefusal(
        'Speculative overlay refused the write: append writes are not overlayable. Use an overwrite Write instead.',
      ),
    };
  }
  const content = args['content'];
  if (typeof content !== 'string') {
    return {
      veto: overlayRefusal('Speculative overlay refused the write: the tool arguments carry no content.'),
    };
  }
  if (content.length > MAX_OVERLAY_CONTENT_CHARS) {
    return {
      veto: overlayRefusal(
        `Speculative overlay refused the write: content exceeds ${String(MAX_OVERLAY_CONTENT_CHARS)} characters.`,
      ),
    };
  }
  try {
    overlay.write(path, content);
  } catch (error) {
    const message =
      error instanceof SpeculationOverlayFullError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return { veto: overlayRefusal(`Speculative overlay refused the write: ${message}`) };
  }
  return {
    veto: {
      output: `Recorded in the speculative branch overlay: ${path} (${String(content.length)} chars). Not written to disk; the branch must be accepted to apply it or discarded to drop it.`,
    },
  };
}

function overlayRefusal(output: string): ExecutableToolResult {
  return { output, isError: true };
}

function overlayWritePath(
  event: BeforeToolExecuteEvent,
  args: Readonly<Record<string, unknown>>,
): string | undefined {
  const accesses = event.execution.accesses ?? [];
  for (const access of accesses) {
    if (access.kind === 'file' && (access.operation === 'write' || access.operation === 'readwrite')) {
      return access.path;
    }
  }
  const raw = args['path'];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : undefined;
}

registerScopedService(
  LifecycleScope.Agent,
  IAgentSpeculationService,
  AgentSpeculationService,
  ScopeActivation.OnScopeCreated,
  'speculation',
);
