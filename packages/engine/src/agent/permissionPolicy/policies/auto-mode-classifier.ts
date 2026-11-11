import type { PermissionPolicy, PermissionPolicyResult } from '#/agent/permissionPolicy/types';
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
import { writeFileAccesses } from './path-utils';
import { actionFingerprint, consumePendingManualRetry, createDenialState, recordAllow, recordBlock, shouldFallback } from '../denialTracking';

const SAFE_AUTO_TOOLS = new Set<string>([
  'Read',
  'Grep',
  'Glob',
  'ReadMediaFile',
  'TaskList',
  'TaskOutput',
  'WaitFor',
  'CronList',
  'WebSearch',
  'FetchURL',
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
  'memory_forget',
  'memory_manage',
  'Arena',
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

const READ_ONLY_BASH_COMMANDS = new Set<string>([
  'ls',
  'cat',
  'grep',
  'find',
  'pwd',
  'which',
  'head',
  'tail',
  'wc',
  'stat',
  'file',
  'du',
  'df',
  'tree',
  'sort',
  'uniq',
  'cut',
  'tr',
  'echo',
  'printf',
  'git',
]);

const LAUNCH_WRAPPERS = new Set<string>(['env', 'command', 'exec', 'nohup', 'builtin', 'nice']);
const PRIVILEGE_WRAPPERS = new Set<string>(['sudo', 'doas']);
const LAUNCH_VALUE_OPTIONS = new Set<string>([
  '-u',
  '--unset',
  '-C',
  '--chdir',
  '-S',
  '--split-string',
  '-a',
  '-n',
  '--adjustment',
]);
const PRIVILEGE_VALUE_OPTIONS = new Set<string>(['-u', '--user', '-g', '--group']);

const READ_ONLY_GIT_SUBCOMMANDS = new Set<string>([
  'status',
  'diff',
  'log',
  'show',
  'rev-parse',
  'ls-files',
  'blame',
  'grep',
  'describe',
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
      if (await this.passesAcceptEditsFastPath(context)) {
        this.denialState = recordAllow(this.denialState, fingerprint);
        finish('approve', 'accept_edits');
        return { kind: 'approve', reason: { auto_mode_classifier: 'accept_edits' } };
      }
    }

    if (toolName === 'Bash' && isReadOnlyBashCommand(context.args, this.bashParser)) {
      this.denialState = recordAllow(this.denialState, fingerprint);
      finish('approve', 'read_only_bash');
      return { kind: 'approve', reason: { auto_mode_classifier: 'read_only_bash' } };
    }

    if (toolName.startsWith('mcp__')) {
      const blockedState = recordBlock(this.denialState, fingerprint);
      const fallback = shouldFallback(blockedState, fingerprint);
      if (fallback.fallback) {
        this.denialState = consumePendingManualRetry(blockedState);
        finish('ask', 'mcp_grant_ambiguity');
        return {
          kind: 'ask',
          reason: { auto_mode_classifier: 'mcp_grant_ambiguity', denial_fallback: fallback.reason },
        };
      }
      this.denialState = blockedState;
      finish('ask', 'mcp_grant_ambiguity');
      return {
        kind: 'ask',
        reason: { auto_mode_classifier: 'mcp_grant_ambiguity' },
        resolveApproval: (response) => {
          if (response.decision === 'approved') this.trustedAnswers.add(fingerprint);
          return undefined;
        },
      };
    }

    const blockedState = recordBlock(this.denialState, fingerprint);
    const fallback = shouldFallback(blockedState, fingerprint);
    if (fallback.fallback) {
      this.denialState = consumePendingManualRetry(blockedState);
      finish('ask', 'classifier_ask');
      return {
        kind: 'ask',
        reason: { auto_mode_classifier: 'ask', denial_fallback: fallback.reason },
      };
    }
    this.denialState = blockedState;
    finish('ask', 'classifier_ask');
    return {
      kind: 'ask',
      reason: { auto_mode_classifier: 'ask' },
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

function bashCommandText(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const command = (args as { readonly command?: unknown }).command;
  return typeof command === 'string' ? command : undefined;
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

function commandName(node: { readonly type: string; readonly children: readonly any[] }): string | undefined {
  const nameIndex = node.children.findIndex((child: any) => child.type === 'command_name');
  const nameNode = nameIndex >= 0 ? node.children[nameIndex] : undefined;
  const nameWord = nameNode?.children.find((child: any) => child.isNamed);
  return nameWord?.text?.replace(/^['"]|['"]$/g, '');
}

function normalizeCommandName(name: string): string {
  return name.split(/[\\/]/).pop()?.toLowerCase() ?? name.toLowerCase();
}

function dropLeadingOptions(args: readonly string[], valueOptions: ReadonlySet<string>): readonly string[] {
  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if (arg === '--') {
      i += 1;
      break;
    }
    if (!arg.startsWith('-')) break;
    if (valueOptions.has(arg) && i + 1 < args.length) {
      i += 2;
      continue;
    }
    const valueOption = [...valueOptions].find((option) => arg.startsWith(`${option}=`));
    if (valueOption) {
      i += 1;
      continue;
    }
    i += 1;
  }
  return args.slice(i);
}

function collectCommandNodes(node: any, out: any[]): void {
  if (node.type === 'command') out.push(node);
  for (const child of node.children ?? []) collectCommandNodes(child, out);
}

function invocationFromCommand(command: any): { name: string; args: string[] } | undefined {
  const nameIndex = command.children.findIndex((child: any) => child.type === 'command_name');
  const rawName = commandName(command);
  if (rawName === undefined || rawName.length === 0) return undefined;

  const args: string[] = [];
  for (const child of command.children.slice(nameIndex + 1)) {
    if (child.type === 'variable_assignment' || child.type === 'file_redirect' || child.type === 'heredoc_redirect') continue;
    const value = typeof child.text === 'string' ? child.text.trim() : '';
    if (value.length > 0) args.push(value);
  }

  let name = normalizeCommandName(rawName);
  let rest = args;
  if (PRIVILEGE_WRAPPERS.has(name)) {
    rest = [...dropLeadingOptions(rest, PRIVILEGE_VALUE_OPTIONS)];
    const inner = rest[0];
    if (inner === undefined) return undefined;
    return { name: normalizeCommandName(inner), args: rest.slice(1) };
  }
  if (name === 'env') {
    let i = 0;
    while (i < rest.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[i]!)) i += 1;
    rest = rest.slice(i);
    if (rest.length === 0) return undefined;
    name = normalizeCommandName(rest[0]!);
    rest = rest.slice(1);
  }
  if (LAUNCH_WRAPPERS.has(name)) {
    if (name === 'command') {
      for (const arg of rest) {
        if (arg === '--') break;
        if (arg === '-') continue;
        if (!arg.startsWith('-')) break;
        if (/[vV]/.test(arg)) return { name: 'command', args: rest };
      }
    }
    rest = [...dropLeadingOptions(rest, LAUNCH_VALUE_OPTIONS)];
    const inner = rest[0];
    if (inner === undefined) return undefined;
    return { name: normalizeCommandName(inner), args: rest.slice(1) };
  }
  return { name, args: rest };
}

function isReadOnlyGitInvocation(args: readonly string[]): boolean {
  const rest = dropLeadingOptions(args, new Set(['-C', '--git-dir', '--work-tree', '-c']));
  let i = 0;
  while (i < rest.length && rest[i]!.startsWith('-')) {
    const arg = rest[i]!;
    if (arg === '--no-pager' || arg === '--no-ext-diff') {
      i += 1;
      continue;
    }
    if ((arg === '-C' || arg === '--git-dir' || arg === '--work-tree' || arg === '-c') && i + 1 < rest.length) {
      i += 2;
      continue;
    }
    i += 1;
  }
  const subcommand = rest[i];
  if (subcommand === undefined) return true;
  if (!READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) return false;
  if (subcommand === 'remote') {
    return rest.slice(i + 1).some((arg) => arg === '-v' || arg === '--verbose');
  }
  if (subcommand === 'stash') {
    return rest[i + 1] === 'list' || rest[i + 1] === 'show';
  }
  return true;
}

function isReadOnlyBashCommand(args: unknown, parser: IBashParserService): boolean {
  const command = bashCommandText(args);
  if (command === undefined) return false;

  const parsed = parser.parse(command, { timeoutMs: 500, maxNodes: 10_000 });
  if (!parsed.ok || parsed.hasError) return false;

  const commands: any[] = [];
  collectCommandNodes(parsed.root, commands);
  if (commands.length === 0) return false;

  let hasRedirect = false;
  const visit = (node: any): void => {
    if (String(node.type).toLowerCase().includes('redirect')) hasRedirect = true;
    for (const child of node.children ?? []) visit(child);
  };
  visit(parsed.root);
  if (hasRedirect) return false;
  return commands.every((commandNode) => {
    const invocation = invocationFromCommand(commandNode);
    if (invocation === undefined) return false;
    if (invocation.name === 'command' && invocation.args.some((arg) => arg === '-v' || arg === '-V' || arg === '--version')) {
      return true;
    }
    if (!READ_ONLY_BASH_COMMANDS.has(invocation.name)) return false;
    if (invocation.name === 'git') return isReadOnlyGitInvocation(invocation.args);
    return true;
  });
}