import { isAbsolute, normalize } from 'pathe';

import type { IHostFileSystem } from '@hilbras/omnicode-engine/os/interface/hostFileSystem';
import type { IHostProcess, IHostProcessService } from '@hilbras/omnicode-engine/os/interface/hostProcess';
import { prepareChildSandboxSpawn } from '@hilbras/omnicode-engine/os/sandbox/childSandbox';
import { IAgentRuntimeService, inspectAgentRuntime } from '@hilbras/omnicode-engine/agent/runtimeBinding/agentRuntime';
import { RuntimeWorkspaceView } from '@hilbras/omnicode-engine/runtime/runtimeWorkspaceView';
import { ISessionContext } from '@hilbras/omnicode-engine/session/sessionContext/sessionContext';
import { ISessionSkillCatalog } from '@hilbras/omnicode-engine/features/skill/session/skillCatalog';
import { ISessionWorkspaceContext } from '@hilbras/omnicode-engine/session/workspaceContext/workspaceContext';
import { ToolAccesses, type ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';
import { registerAgentToolService } from '@hilbras/omnicode-engine/agent/toolRegistry/toolContribution';
import { toInputJsonSchema } from '@hilbras/omnicode-engine/tool/input-schema';
import {
  resolvePathAccessPath,
  type PathClass,
  type WorkspaceConfig,
} from '@hilbras/omnicode-engine/tool/path-access';

import {
  GIT_WORKTREE_MAX_OUTPUT_CHARS,
  GIT_WORKTREE_TIMEOUT_MS,
  IGitWorktreeCreateTool,
  IGitWorktreeListTool,
  IGitWorktreeRemoveTool,
  WorktreeCreateInputSchema,
  WorktreeListInputSchema,
  WorktreeRemoveInputSchema,
  isPathInsideRepository,
  parseWorktreePorcelain,
  validateBranchName,
  validateRefName,
  type WorktreeCreateInput,
  type WorktreeEntry,
  type WorktreeListInput,
  type WorktreeRemoveInput,
} from './git-worktree';

interface GitRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly truncated: boolean;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  /** Why the git child ran without OS sandboxing although sandboxing is configured. */
  readonly sandboxNote?: string;
}

async function runGit(
  processes: IHostProcessService,
  cwd: string,
  args: readonly string[],
  signal: AbortSignal,
  sandbox?: { readonly workspace: string },
): Promise<GitRunResult> {
  if (signal.aborted) {
    return { stdout: '', stderr: '', exitCode: -1, truncated: false, timedOut: false, aborted: true };
  }
  const argv = ['git', ...args];
  let spawnCommand = 'git';
  let spawnArgs: readonly string[] = args;
  let sandboxNote: string | undefined;
  if (sandbox !== undefined) {
    const prepared = await prepareChildSandboxSpawn({
      argv,
      cwd,
      workspace: sandbox.workspace,
    });
    if (prepared.kind === 'denied') {
      return {
        stdout: '',
        stderr: prepared.message,
        exitCode: -1,
        truncated: false,
        timedOut: false,
        aborted: signal.aborted,
      };
    }
    if (prepared.kind === 'sandbox') {
      spawnCommand = prepared.command;
      spawnArgs = prepared.args;
    } else {
      sandboxNote = prepared.reason;
    }
  }
  let process: IHostProcess;
  try {
    process = await processes.spawn(spawnCommand, spawnArgs, {
      cwd,
      env: {
        GIT_TERMINAL_PROMPT: '0',
        GIT_OPTIONAL_LOCKS: '0',
        LC_ALL: 'C',
        NO_COLOR: '1',
      },
    });
  } catch (error) {
    return {
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      exitCode: -1,
      truncated: false,
      timedOut: false,
      aborted: signal.aborted,
      sandboxNote,
    };
  }
  let stdout = '';
  let stderr = '';
  let truncated = false;
  const append = (current: string, chunk: string): string => {
    const remaining = GIT_WORKTREE_MAX_OUTPUT_CHARS - current.length;
    if (remaining <= 0) {
      truncated = true;
      return current;
    }
    if (chunk.length > remaining) truncated = true;
    return current + chunk.slice(0, remaining);
  };
  process.stdout.on('data', (chunk: Buffer) => {
    stdout = append(stdout, chunk.toString('utf8'));
  });
  process.stderr.on('data', (chunk: Buffer) => {
    stderr = append(stderr, chunk.toString('utf8'));
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void process.kill('SIGTERM');
  }, GIT_WORKTREE_TIMEOUT_MS);
  const onAbort = () => {
    void process.kill('SIGTERM');
  };
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    process.stdin.end();
  } catch {
  }
  try {
    const exitCode = await process.wait();
    return { stdout, stderr, exitCode, truncated, timedOut, aborted: signal.aborted, sandboxNote };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
    try {
      await process.dispose();
    } catch {
    }
  }
}

function gitFailure(result: GitRunResult, fallback: string): string {
  if (result.aborted) return 'git command aborted.';
  if (result.timedOut) return `git command timed out after ${String(GIT_WORKTREE_TIMEOUT_MS)}ms.`;
  const detail = result.stderr.trim() || result.stdout.trim() || fallback;
  return detail.slice(0, 4_000);
}

async function repositoryRoot(
  process: IHostProcessService,
  cwd: string,
  signal: AbortSignal,
  sandbox?: { readonly workspace: string },
): Promise<{ root: string } | { error: string }> {
  const result = await runGit(process, cwd, ['rev-parse', '--show-toplevel'], signal, sandbox);
  if (result.exitCode !== 0) {
    return { error: gitFailure(result, 'Not inside a git repository.') };
  }
  const root = normalize(result.stdout.trim());
  return isAbsolute(root) ? { root } : { error: 'git returned a non-absolute repository root.' };
}

function workspace(view: RuntimeWorkspaceView): WorkspaceConfig {
  return { workspaceDir: view.workDir, additionalDirs: view.additionalDirs };
}

function toolRuntime(runtime: IAgentRuntimeService) {
  const inspected = inspectAgentRuntime(runtime);
  return {
    inspected,
    env: { _serviceBrand: undefined, ...inspected.environment, ready: Promise.resolve() },
  } as const;
}

function sandboxWorkspace(
  workspaceCtx: ISessionWorkspaceContext | undefined,
): { readonly workspace: string } | undefined {
  return workspaceCtx === undefined ? undefined : { workspace: workspaceCtx.workDir };
}

function withSandboxNote(output: string, note: string | undefined): string {
  return note === undefined ? output : `${output}\n[sandbox] ${note}`;
}

export class GitWorktreeListTool implements IGitWorktreeListTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'WorktreeList' as const;
  readonly description =
    'List git worktrees for the current repository using argument-array git invocation. No shell is used.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(WorktreeListInputSchema);

  constructor(
    @IAgentRuntimeService private readonly runtime: IAgentRuntimeService,
    @ISessionContext private readonly ctx: ISessionContext,
    @ISessionWorkspaceContext private readonly workspaceCtx?: ISessionWorkspaceContext,
  ) {}

  resolveExecution(_args: WorktreeListInput): ToolExecution {
    return {
      accesses: ToolAccesses.readTree(this.ctx.cwd),
      description: 'Listing git worktrees',
      display: { kind: 'generic', summary: 'List git worktrees' },
      approvalRule: this.name,
      execute: async ({ signal }) => {
        const lease = this.runtime.acquire(['process']);
        try {
          const processes = lease.runtime.process;
          if (processes === undefined) return { isError: true, output: 'Process runtime is unavailable.' };
          return await this.execution(processes, signal);
        } finally {
          lease.dispose();
        }
      },
    };
  }

  private async execution(
    processes: IHostProcessService,
    signal: AbortSignal,
  ): Promise<{ output: string; isError?: boolean }> {
    const sandbox = sandboxWorkspace(this.workspaceCtx);
    const repo = await repositoryRoot(processes, this.ctx.cwd, signal, sandbox);
    if ('error' in repo) return { isError: true, output: repo.error };
    const result = await runGit(processes, repo.root, ['worktree', 'list', '--porcelain'], signal, sandbox);
    if (result.exitCode !== 0) return { isError: true, output: gitFailure(result, 'git worktree list failed.') };
    const entries = parseWorktreePorcelain(result.stdout);
    return {
      output: withSandboxNote(
        JSON.stringify({ repository: repo.root, worktrees: entries }, null, 2),
        result.sandboxNote,
      ),
    };
  }
}

export class GitWorktreeCreateTool implements IGitWorktreeCreateTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'WorktreeCreate' as const;
  readonly description =
    'Create a git worktree at a path inside the current repository. Requires branch and path; never uses --force.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(WorktreeCreateInputSchema);

  constructor(
    @IAgentRuntimeService private readonly runtime: IAgentRuntimeService,
    @ISessionContext private readonly ctx: ISessionContext,
    @ISessionWorkspaceContext private readonly workspaceCtx: ISessionWorkspaceContext,
    @ISessionSkillCatalog private readonly skillCatalog?: ISessionSkillCatalog,
  ) {}

  resolveExecution(args: WorktreeCreateInput): ToolExecution {
    return {
      accesses: ToolAccesses.all(),
      description: `Creating worktree ${args.path}`,
      display: { kind: 'generic', summary: `Create worktree ${args.branch} at ${args.path}` },
      approvalRule: this.name,
      matchesRule: (ruleArgs) => ruleArgs === `${args.branch}\u0000${args.path}`,
      execute: async ({ signal }) => {
        const lease = this.runtime.acquire(['fs', 'process']);
        try {
          const fs = lease.runtime.fs;
          const processes = lease.runtime.process;
          if (fs === undefined || processes === undefined) {
            return { isError: true, output: 'Filesystem and process runtimes are required.' };
          }
          return await this.execution(fs, processes, args, signal);
        } finally {
          lease.dispose();
        }
      },
    };
  }

  private async execution(
    fs: IHostFileSystem,
    processes: IHostProcessService,
    args: WorktreeCreateInput,
    signal: AbortSignal,
  ): Promise<{ output: string; isError?: boolean }> {
    if (typeof args.branch !== 'string' || typeof args.path !== 'string') {
      return { isError: true, output: 'WorktreeCreate requires branch and path.' };
    }
    const branchError = validateBranchName(args.branch);
    if (branchError !== undefined) return { isError: true, output: branchError };
    if (args.base !== undefined) {
      const baseError = validateRefName(args.base);
      if (baseError !== undefined) return { isError: true, output: baseError };
    }
    const { inspected, env } = toolRuntime(this.runtime);
    const view = new RuntimeWorkspaceView(inspected, {
      workDir: this.workspaceCtx.workDir,
      additionalDirs: [
        ...this.workspaceCtx.additionalDirs,
        ...(this.skillCatalog?.catalog.getSkillRoots() ?? []),
      ],
    });
    let target: string;
    try {
      target = normalize(
        resolvePathAccessPath(args.path, { env, workspace: workspace(view), operation: 'write' }),
      );
    } catch (error) {
      return { isError: true, output: error instanceof Error ? error.message : String(error) };
    }
    const repo = await repositoryRoot(processes, this.ctx.cwd, signal, sandboxWorkspace(this.workspaceCtx));
    if ('error' in repo) return { isError: true, output: repo.error };
    if (!isPathInsideRepository(target, repo.root, env.pathClass)) {
      return {
        isError: true,
        output: `Worktree path must be inside repository ${repo.root}: ${target}`,
      };
    }
    try {
      await fs.stat(target);
      return { isError: true, output: `Worktree path already exists: ${target}` };
    } catch (error) {
      if (!isNotFound(error)) {
        return { isError: true, output: error instanceof Error ? error.message : String(error) };
      }
    }
    const gitArgs = ['worktree', 'add', '-b', args.branch, target];
    if (args.base !== undefined) gitArgs.push(args.base);
    const result = await runGit(processes, repo.root, gitArgs, signal, sandboxWorkspace(this.workspaceCtx));
    if (result.exitCode !== 0) return { isError: true, output: gitFailure(result, 'git worktree add failed.') };
    return {
      output: withSandboxNote(
        `Created worktree ${target} on branch ${args.branch}.\n${result.stdout.trim()}`.trim(),
        result.sandboxNote,
      ),
    };
  }
}

export class GitWorktreeRemoveTool implements IGitWorktreeRemoveTool {
  declare readonly _serviceBrand: undefined;
  readonly name = 'WorktreeRemove' as const;
  readonly description =
    'Remove a registered git worktree. Refuses dirty worktrees and never uses --force.';
  readonly parameters: Record<string, unknown> = toInputJsonSchema(WorktreeRemoveInputSchema);

  constructor(
    @IAgentRuntimeService private readonly runtime: IAgentRuntimeService,
    @ISessionContext private readonly ctx: ISessionContext,
    @ISessionWorkspaceContext private readonly workspaceCtx: ISessionWorkspaceContext,
    @ISessionSkillCatalog private readonly skillCatalog?: ISessionSkillCatalog,
  ) {}

  resolveExecution(args: WorktreeRemoveInput): ToolExecution {
    return {
      accesses: ToolAccesses.all(),
      description: `Removing worktree ${args.path}`,
      display: { kind: 'generic', summary: `Remove worktree ${args.path}` },
      approvalRule: this.name,
      matchesRule: (ruleArgs) => ruleArgs === args.path,
      execute: async ({ signal }) => {
        const lease = this.runtime.acquire(['process']);
        try {
          const processes = lease.runtime.process;
          if (processes === undefined) return { isError: true, output: 'Process runtime is unavailable.' };
          return await this.execution(processes, args, signal);
        } finally {
          lease.dispose();
        }
      },
    };
  }

  private async execution(
    processes: IHostProcessService,
    args: WorktreeRemoveInput,
    signal: AbortSignal,
  ): Promise<{ output: string; isError?: boolean }> {
    if (typeof args.path !== 'string') {
      return { isError: true, output: 'WorktreeRemove requires path.' };
    }
    const { inspected, env } = toolRuntime(this.runtime);
    const view = new RuntimeWorkspaceView(inspected, {
      workDir: this.workspaceCtx.workDir,
      additionalDirs: [
        ...this.workspaceCtx.additionalDirs,
        ...(this.skillCatalog?.catalog.getSkillRoots() ?? []),
      ],
    });
    let target: string;
    try {
      target = normalize(
        resolvePathAccessPath(args.path, { env, workspace: workspace(view), operation: 'write' }),
      );
    } catch (error) {
      return { isError: true, output: error instanceof Error ? error.message : String(error) };
    }
    const sandbox = sandboxWorkspace(this.workspaceCtx);
    const repo = await repositoryRoot(processes, this.ctx.cwd, signal, sandbox);
    if ('error' in repo) return { isError: true, output: repo.error };
    const list = await runGit(processes, repo.root, ['worktree', 'list', '--porcelain'], signal, sandbox);
    if (list.exitCode !== 0) return { isError: true, output: gitFailure(list, 'git worktree list failed.') };
    const entries = parseWorktreePorcelain(list.stdout);
    if (entries.length > 0 && samePath(entries[0]!.path, target, env.pathClass)) {
      return { isError: true, output: 'Refusing to remove the main worktree.' };
    }
    const entry = entries.find((candidate) => samePath(candidate.path, target, env.pathClass));
    if (entry === undefined) {
      return { isError: true, output: `Not a registered worktree: ${target}` };
    }
    const status = await runGit(processes, entry.path, ['status', '--porcelain', '--untracked-files=normal'], signal, sandbox);
    if (status.exitCode !== 0) {
      return { isError: true, output: gitFailure(status, 'Could not check worktree status.') };
    }
    if (status.stdout.trim().length > 0) {
      return {
        isError: true,
        output: `Refusing to remove dirty worktree ${entry.path}. Commit or clean changes first.`,
      };
    }
    const result = await runGit(processes, repo.root, ['worktree', 'remove', entry.path], signal, sandbox);
    if (result.exitCode !== 0) return { isError: true, output: gitFailure(result, 'git worktree remove failed.') };
    return {
      output: withSandboxNote(`Removed worktree ${entry.path}.`.trim(), result.sandboxNote),
    };
  }
}

function samePath(left: string, right: string, pathClass: PathClass): boolean {
  const a = normalize(left);
  const b = normalize(right);
  return pathClass === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'ENOENT' || code === 'os.fs.not_found';
}

registerAgentToolService(IGitWorktreeListTool, GitWorktreeListTool, {
  name: 'WorktreeList',
  domain: 'git',
  requiredRuntimeCapabilities: ['process'],
});
registerAgentToolService(IGitWorktreeCreateTool, GitWorktreeCreateTool, {
  name: 'WorktreeCreate',
  domain: 'git',
  requiredRuntimeCapabilities: ['fs', 'process'],
});
registerAgentToolService(IGitWorktreeRemoveTool, GitWorktreeRemoveTool, {
  name: 'WorktreeRemove',
  domain: 'git',
  requiredRuntimeCapabilities: ['process'],
});
