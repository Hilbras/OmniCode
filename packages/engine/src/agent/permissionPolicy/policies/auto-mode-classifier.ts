import type { PermissionPolicy, PermissionPolicyResult } from '#/agent/permissionPolicy/types';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { IAgentPermissionModeService } from '#/agent/permissionMode/permissionMode';
import type { ResolvedToolExecutionHookContext } from '#/agent/toolExecutor/toolHooks';
import { ISessionWorkspaceContext } from '#/session/workspaceContext/workspaceContext';
import type { ISessionWorkspaceContext as WorkspaceContext } from '#/session/workspaceContext/workspaceContext';
import { IAgentRuntimeService } from '#/agent/runtimeBinding/agentRuntime';
import { IBashParserService } from '#/app/bashParser/bashParser';
import { IConfigService } from '#/app/config/config';
import { IGitService } from '#/app/git/git';
import { ITelemetryService } from '#/app/telemetry/telemetry';
import { isWithinWorkspace } from '#/tool/path-access';
import { isReadOnlyShellCall } from '#/tool/read-only-shell';
import { writeFileAccesses } from './path-utils';
import { actionFingerprint, consumePendingManualRetry, createDenialState, recordAllow, recordBlock, recordFallbackApprove, shouldFallback } from '../denialTracking';
import { readAutoModeContext, type AutoModeContext } from '../autoModeContext';

const SAFE_AUTO_TOOLS = new Set<string>([
  'Read',
  'Grep',
  'Glob',
  'ReadMediaFile',
  'TaskList',
  'TaskOutput',
  'WaitFor',
  'CronList',
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'CreateGoal',
  'GetGoal',
  'SetGoalBudget',
  'UpdateGoal',
  'Skill',
  'memory_search',
  'memory_save',
  'Lsp',
  'WorktreeList',
  'TaskBoardCreate',
  'TaskBoardUpdate',
  'TaskBoardList',
  'Team',
  'TeamCreate',
  'TeamJoin',
  'TeamLeave',
  'TeamList',
  'ArtifactRecord',
  'SourceRecord',
]);

export class AutoModeClassifierPermissionPolicyService implements PermissionPolicy {
  readonly name = 'auto-mode-classifier';

  private denialState = createDenialState();
  private readonly trustedAnswers = new Set<string>();

  constructor(
    @IAgentPermissionModeService private readonly modeService: IAgentPermissionModeService,
    @ISessionWorkspaceContext private readonly workspace: WorkspaceContext,
    @IAgentRuntimeService private readonly runtime: IAgentRuntimeService,
    @IBashParserService private readonly bashParser: IBashParserService,
    @IConfigService private readonly config: IConfigService,
    @ITelemetryService private readonly telemetry: ITelemetryService,
    @IGitService _git: IGitService,
    @IAgentContextMemoryService private readonly contextMemory: IAgentContextMemoryService,
  ) {
    void _git;
    this.modeService.onDidChangeMode(() => {
      this.denialState = createDenialState();
    });
  }

  async evaluate(context: ResolvedToolExecutionHookContext): Promise<PermissionPolicyResult | undefined> {
    if (this.modeService.mode !== 'auto') return undefined;

    const toolName = context.toolCall.name;
    const fingerprint = actionFingerprint(toolName, context.args);
    const autoContext = readAutoModeContext(this.contextMemory);

    const finish = (decision: 'approve' | 'deny' | 'ask', category: string): void => {
      this.telemetry.track2('permission_policy_decision', {
        turn_id: context.turnId,
        tool_call_id: context.toolCall.id,
        policy_name: this.name,
        tool_name: toolName,
        permission_mode: 'auto',
        decision,
        category,
      });
    };

    if (SAFE_AUTO_TOOLS.has(toolName)) {
      this.denialState = recordAllow(this.denialState, fingerprint);
      finish('approve', 'safe_tool');
      return { kind: 'approve', reason: { auto_mode_classifier: 'safe_tool' } };
    }

    if (this.trustedAnswers.has(fingerprint)) {
      this.denialState = recordAllow(this.denialState, fingerprint);
      finish('approve', 'trusted_user_answer');
      return { kind: 'approve', reason: { auto_mode_classifier: 'trusted_user_answer' } };
    }

    if (toolName === 'Edit' || toolName === 'Write') {
      if (!autoContext.editIntent) {
        return this.askForContext(toolName, fingerprint, autoContext, finish);
      }
      if (await this.passesAcceptEditsFastPath(context)) {
        this.denialState = recordAllow(this.denialState, fingerprint);
        finish('approve', 'accept_edits');
        return { kind: 'approve', reason: { auto_mode_classifier: 'accept_edits' } };
      }
    }

    if (toolName === 'Bash' && isReadOnlyShellCall({ name: toolName, args: context.args }, this.bashParser)) {
      this.denialState = recordAllow(this.denialState, fingerprint);
      finish('approve', 'read_only_bash');
      return { kind: 'approve', reason: { auto_mode_classifier: 'read_only_bash' } };
    }

    if (toolName.startsWith('mcp__')) {
      return this.askAfterBlock({
        fingerprint,
        category: 'mcp_grant_ambiguity',
        telemetryCategory: 'mcp_grant_ambiguity',
        finish,
      });
    }

    return this.askAfterBlock({
      fingerprint,
      category: 'ask',
      telemetryCategory: 'classifier_ask',
      finish,
    });
  }

  /**
   * The one denial-retry code path: every unclassified tool call counts as a
   * block, and once the block thresholds are reached the call is downgraded to
   * a manual confirmation (`denial_fallback`) instead of being silently refused.
   *
   * Both branches resolve the same way — the user's approval is remembered for
   * the session, and a fallback approval additionally clears the consecutive
   * counters through `recordFallbackApprove`, so one manually confirmed action
   * does not pin the classifier into permanent fallback.
   */
  private askAfterBlock(input: {
    readonly fingerprint: string;
    /** Value used as the `auto_mode_classifier` reason on the ask. */
    readonly category: string;
    /** Value reported to telemetry, which distinguishes the MCP ambiguity case. */
    readonly telemetryCategory: string;
    readonly finish: (decision: 'approve' | 'deny' | 'ask', category: string) => void;
  }): PermissionPolicyResult {
    const { fingerprint, category, telemetryCategory, finish } = input;
    const blockedState = recordBlock(this.denialState, fingerprint);
    const fallback = shouldFallback(blockedState, fingerprint);
    if (fallback.fallback) {
      this.denialState = consumePendingManualRetry(blockedState);
      finish('ask', telemetryCategory);
      return {
        kind: 'ask',
        reason: { auto_mode_classifier: category, denial_fallback: fallback.reason },
        resolveApproval: (response) => {
          if (response.decision !== 'approved') return undefined;
          this.denialState = recordFallbackApprove(this.denialState);
          this.trustedAnswers.add(fingerprint);
          return undefined;
        },
      };
    }
    this.denialState = blockedState;
    finish('ask', telemetryCategory);
    return {
      kind: 'ask',
      reason: { auto_mode_classifier: category },
      resolveApproval: (response) => {
        if (response.decision === 'approved') this.trustedAnswers.add(fingerprint);
        return undefined;
      },
    };
  }

  private askForContext(
    toolName: string,
    fingerprint: string,
    autoContext: AutoModeContext,
    finish: (decision: 'approve' | 'deny' | 'ask', category: string) => void,
  ): PermissionPolicyResult {
    this.denialState = recordBlock(this.denialState, fingerprint);
    finish('ask', 'context_missing_edit_intent');
    return {
      kind: 'ask',
      reason: {
        auto_mode_classifier: 'context_missing_edit_intent',
        user_message: autoContext.hasUserMessage,
        recent_tools: autoContext.recentToolNames.join(','),
        tool: toolName,
      },
      resolveApproval: (response) => {
        if (response.decision === 'approved') this.trustedAnswers.add(fingerprint);
        return undefined;
      },
    };
  }

  private async passesAcceptEditsFastPath(context: ResolvedToolExecutionHookContext): Promise<boolean> {
    const lease = this.runtime.acquire();
    const pathClass = lease.runtime.environment.pathClass;
    lease.dispose();

    const accesses = writeFileAccesses(context);
    if (accesses.length === 0) return false;

    const workspaceConfig = {
      workspaceDir: this.workspace.workDir,
      additionalDirs: this.workspace.additionalDirs,
    };
    if (this.workspace.workDir.length === 0) return false;

    if (!accesses.every((access) => isWithinWorkspace(access.path, workspaceConfig, pathClass))) {
      return false;
    }
    return !accesses.some((access) => isProtectedAutoModeWritePath(access.path));
  }
}

function isProtectedAutoModeWritePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  return (
    /(^|\/)\.git(\/|$)/.test(normalized) ||
    /(^|\/)package\.json$/.test(normalized) ||
    /(^|\/)\.github\/workflows\//.test(normalized) ||
    /(^|\/)\.omnicode(\/|$)/.test(normalized) ||
    /(^|\/)agents?\.md$/.test(normalized) ||
    /(^|\/)\.mcp\.json$/.test(normalized) ||
    /(^|\/)\.env(\.|$)/.test(normalized)
  );
}
