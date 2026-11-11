import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';

import { HostFileSystem } from '@hilbras/omnicode-engine/os/backends/node-local/hostFsService';
import type { ExecutableToolResult, ToolExecution } from '@hilbras/omnicode-engine/tool/toolContract';

import {
  extractWorktreeBranch,
  isPathInsideRepository,
  parseWorktreePorcelain,
  validateBranchName,
  validateRefName,
} from '#/git-worktree/git-worktree';
import {
  GitWorktreeCreateTool,
  GitWorktreeListTool,
  GitWorktreeRemoveTool,
} from '#/git-worktree/gitWorktreeTools';
import {
  createFakeProcessService,
  makeTestRuntime,
  type FakeGitCall,
  type FakeGitResponse,
} from '../helpers/testRuntime';

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-worktree-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function executable(execution: ToolExecution): Extract<ToolExecution, { execute: unknown }> {
  if (!('execute' in execution)) throw new Error('expected an executable tool result');
  return execution;
}

function output(result: ExecutableToolResult): string {
  return typeof result.output === 'string' ? result.output : JSON.stringify(result.output);
}

function gitHandler(repo: string, list: string, status = ''): (call: FakeGitCall) => FakeGitResponse {
  return (call) => {
    if (call.args[0] === 'rev-parse') return { stdout: `${repo}\n` };
    if (call.args[0] === 'worktree' && call.args[1] === 'list') return { stdout: list };
    if (call.args[0] === 'status') return { stdout: status };
    return { stdout: '' };
  };
}

describe('git worktree helpers', () => {
  it('parses porcelain worktree output', () => {
    const entries = parseWorktreePorcelain(
      [
        'worktree /repo',
        'HEAD 1111',
        'branch refs/heads/main',
        '',
        'worktree /repo/wt',
        'HEAD 2222',
        'branch refs/heads/feature/x',
        '',
        'worktree /repo/bare',
        'bare',
        '',
      ].join('\n'),
    );
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ path: '/repo', branch: 'refs/heads/main', bare: false });
    expect(extractWorktreeBranch(entries[1]!)).toBe('feature/x');
    expect(entries[2]?.bare).toBe(true);
  });

  it('validates branch and ref names', () => {
    expect(validateBranchName('feature/worktree-tools')).toBeUndefined();
    expect(validateBranchName('-danger')).toContain('must not start');
    expect(validateBranchName('bad..name')).toContain('invalid sequence');
    expect(validateBranchName('bad name')).toContain('character');
    expect(validateRefName('HEAD~1')).toContain('character');
    expect(validateRefName('main')).toBeUndefined();
  });

  it('checks that a path is strictly inside the repository', () => {
    expect(isPathInsideRepository('/repo/wt', '/repo', 'posix')).toBe(true);
    expect(isPathInsideRepository('/repo', '/repo', 'posix')).toBe(false);
    expect(isPathInsideRepository('/repo-two/wt', '/repo', 'posix')).toBe(false);
    expect(isPathInsideRepository('/repo/wt', '/repo', 'win32')).toBe(true);
  });
});

describe('git worktree tools', () => {
  it('lists worktrees with argument-array git invocation', async () => {
    const repo = await tempDir();
    const calls: FakeGitCall[] = [];
    const process = createFakeProcessService(
      gitHandler(repo, `worktree ${repo}\nHEAD 1111\nbranch refs/heads/main\n\n`),
      calls,
    );
    const tr = makeTestRuntime({ workDir: repo, process });
    const tool = new GitWorktreeListTool(tr.runtimeService, tr.sessionCtx);
    const result = await executable(tool.resolveExecution({})).execute(tr.context);
    expect(output(result)).toContain('"worktrees"');
    expect(calls.every((call) => call.command === 'git')).toBe(true);
    expect(calls.some((call) => call.args.join(' ').includes('--porcelain'))).toBe(true);
  });

  it('creates a worktree only inside the repository without force', async () => {
    const repo = await tempDir();
    const calls: FakeGitCall[] = [];
    const process = createFakeProcessService(gitHandler(repo, ''), calls);
    const tr = makeTestRuntime({ fs: new HostFileSystem(), workDir: repo, process });
    const tool = new GitWorktreeCreateTool(tr.runtimeService, tr.sessionCtx, tr.workspaceCtx);
    const result = await executable(
      tool.resolveExecution({ branch: 'feature/x', path: 'wt', base: 'main' }),
    ).execute(tr.context);
    expect(result.isError).toBeFalsy();
    expect(output(result)).toContain('Created worktree');
    const add = calls.find((call) => call.args[1] === 'add');
    expect(add?.args).toEqual(['worktree', 'add', '-b', 'feature/x', join(repo, 'wt'), 'main']);
    expect(add?.args).not.toContain('--force');
  });

  it('rejects invalid branches, missing repository, and paths outside it', async () => {
    const repo = await tempDir();
    const tr = makeTestRuntime({
      fs: new HostFileSystem(),
      workDir: repo,
      process: createFakeProcessService(gitHandler(repo, '')),
    });
    const tool = new GitWorktreeCreateTool(tr.runtimeService, tr.sessionCtx, tr.workspaceCtx);
    const badBranch = await executable(
      tool.resolveExecution({ branch: '-bad', path: 'wt' }),
    ).execute(tr.context);
    expect(badBranch.isError).toBe(true);
    const outside = await executable(
      tool.resolveExecution({ branch: 'feature/x', path: '/tmp/outside-repo-wt' }),
    ).execute(tr.context);
    expect(outside.isError).toBe(true);
    expect(output(outside)).toContain('inside repository');
    const noRepo = makeTestRuntime({
      fs: new HostFileSystem(),
      workDir: repo,
      process: createFakeProcessService(() => ({ stderr: 'not a git repository', exitCode: 128 })),
    });
    const noRepoTool = new GitWorktreeCreateTool(
      noRepo.runtimeService,
      noRepo.sessionCtx,
      noRepo.workspaceCtx,
    );
    const noRepoResult = await executable(
      noRepoTool.resolveExecution({ branch: 'feature/x', path: 'wt' }),
    ).execute(noRepo.context);
    expect(noRepoResult.isError).toBe(true);
  });

  it('refuses to remove dirty worktrees and never forces removal', async () => {
    const repo = await tempDir();
    const target = join(repo, 'wt');
    const list = `worktree ${repo}\nHEAD 1111\nbranch refs/heads/main\n\nworktree ${target}\nHEAD 2222\nbranch refs/heads/feature/x\n\n`;
    const calls: FakeGitCall[] = [];
    const dirty = createFakeProcessService(gitHandler(repo, list, ' M file.txt\n'), calls);
    const tr = makeTestRuntime({ workDir: repo, process: dirty });
    const tool = new GitWorktreeRemoveTool(tr.runtimeService, tr.sessionCtx, tr.workspaceCtx);
    const dirtyResult = await executable(
      tool.resolveExecution({ path: target }),
    ).execute(tr.context);
    expect(dirtyResult.isError).toBe(true);
    expect(output(dirtyResult)).toContain('dirty');
    expect(calls.some((call) => call.args[0] === 'worktree' && call.args[1] === 'remove')).toBe(false);

    const cleanCalls: FakeGitCall[] = [];
    const clean = createFakeProcessService(gitHandler(repo, list), cleanCalls);
    const cleanRuntime = makeTestRuntime({ workDir: repo, process: clean });
    const cleanTool = new GitWorktreeRemoveTool(
      cleanRuntime.runtimeService,
      cleanRuntime.sessionCtx,
      cleanRuntime.workspaceCtx,
    );
    const cleanResult = await executable(
      cleanTool.resolveExecution({ path: target }),
    ).execute(cleanRuntime.context);
    expect(cleanResult.isError).toBeFalsy();
    const remove = cleanCalls.find((call) => call.args[0] === 'worktree' && call.args[1] === 'remove');
    expect(remove?.args).toEqual(['worktree', 'remove', target]);
    expect(remove?.args).not.toContain('--force');
  });

  it('refuses to remove the main or an unregistered worktree', async () => {
    const repo = await tempDir();
    const list = `worktree ${repo}\nHEAD 1111\nbranch refs/heads/main\n\n`;
    const tr = makeTestRuntime({
      workDir: repo,
      process: createFakeProcessService(gitHandler(repo, list)),
    });
    const tool = new GitWorktreeRemoveTool(tr.runtimeService, tr.sessionCtx, tr.workspaceCtx);
    const main = await executable(tool.resolveExecution({ path: repo })).execute(tr.context);
    expect(output(main)).toContain('main worktree');
    const unregistered = await executable(
      tool.resolveExecution({ path: join(repo, 'nope') }),
    ).execute(tr.context);
    expect(output(unregistered)).toContain('Not a registered worktree');
  });
});
