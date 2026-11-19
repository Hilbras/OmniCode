import { describe, expect, it, vi } from 'vitest';

import type { FileHistoryPatchResult } from '@hilbras/omnicode-api';

import { handleApply, type ApplyDeps } from '#/cli/sub/apply';

function patchResult(overrides: Partial<FileHistoryPatchResult['patch']> = {}): FileHistoryPatchResult {
  return {
    scope: 'turn',
    turnId: 1,
    patch: {
      text: 'diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,1 +1,1 @@\n-old\n+new\n',
      files: [{ path: 'a.txt', status: 'modified', before: 'old\n', after: 'new\n' }],
      excluded: [],
      ...overrides,
    },
  };
}

function makeDeps(overrides: Partial<ApplyDeps> = {}): {
  readonly deps: ApplyDeps;
  readonly stdout: string[];
  readonly stderr: string[];
  readonly exit: (code: number) => never;
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const deps: ApplyDeps = {
    listSessions: async () => [{ id: 'session_1' }] as never,
    getFileHistoryPatch: async () => patchResult(),
    version: 'test',
    cwd: () => '/ws',
    stdout: { write: (chunk: string) => { stdout.push(chunk); return true; } },
    stderr: { write: (chunk: string) => { stderr.push(chunk); return true; } },
    exit: ((code: number) => {
      throw new ExitError(code);
    }) as never,
    gitApply: () => ({ ok: true, stderr: '' }),
    ...overrides,
  };
  return { deps, stdout, stderr, exit: deps.exit };
}

class ExitError extends Error {
  constructor(readonly code: number) {
    super(`exit ${String(code)}`);
  }
}

async function run(deps: ApplyDeps, sessionId: string | undefined, opts: object): Promise<{ error?: ExitError }> {
  try {
    await handleApply(deps, sessionId, opts as never);
    return {};
  } catch (error) {
    return { error: error instanceof ExitError ? error : undefined };
  }
}

describe('omnicode apply', () => {
  it('applies the latest session patch through git apply', async () => {
    const gitApply = vi.fn(() => ({ ok: true, stderr: '' }));
    const { deps, stdout } = makeDeps({ gitApply });

    const outcome = await run(deps, 'session_9', {
      turn: undefined, session: false, reverse: false, stdout: false, check: false,
    });

    expect(outcome.error).toBeUndefined();
    expect(gitApply).toHaveBeenCalledWith({ patch: expect.stringContaining('diff --git'), check: false });
    expect(stdout.join('')).toContain('Applied 1 file(s) from session_9');
  });

  it('defaults to the most recent session for the directory', async () => {
    const getFileHistoryPatch = vi.fn(async () => patchResult());
    const listSessions = vi.fn(async () => [{ id: 'session_first' }, { id: 'session_latest' }] as never);
    const { deps, stdout } = makeDeps({ getFileHistoryPatch, listSessions });

    await run(deps, undefined, {
      turn: undefined, session: false, reverse: false, stdout: false, check: false,
    });

    expect(listSessions).toHaveBeenCalledWith('/ws');
    expect(getFileHistoryPatch).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session_latest', scope: 'turn' }),
    );
    expect(stdout.join('')).toContain('session_latest');
  });

  it('exits 1 when no session exists', async () => {
    const { deps } = makeDeps({ listSessions: async () => [] as never });
    const outcome = await run(deps, undefined, {
      turn: undefined, session: false, reverse: false, stdout: false, check: false,
    });
    expect(outcome.error?.code).toBe(1);
  });

  it('passes the scope, turn, and reverse options through', async () => {
    const getFileHistoryPatch = vi.fn(async () => patchResult());
    const { deps } = makeDeps({ getFileHistoryPatch });

    await run(deps, 'session_1', { turn: 3, session: false, reverse: true, stdout: false, check: false });
    expect(getFileHistoryPatch).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session_1', scope: 'turn', turnId: 3, reverse: true }),
    );

    await run(deps, 'session_1', { turn: undefined, session: true, reverse: false, stdout: false, check: false });
    expect(getFileHistoryPatch).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session_1', scope: 'session', turnId: undefined, reverse: false }),
    );
  });

  it('prints the patch with --stdout and does not call git', async () => {
    const gitApply = vi.fn(() => ({ ok: true, stderr: '' }));
    const { deps, stdout } = makeDeps({ gitApply });

    await run(deps, 'session_1', { turn: undefined, session: false, reverse: false, stdout: true, check: false });

    expect(gitApply).not.toHaveBeenCalled();
    expect(stdout.join('')).toContain('diff --git a/a.txt');
  });

  it('validates without applying with --check', async () => {
    const gitApply = vi.fn(() => ({ ok: true, stderr: '' }));
    const { deps, stdout } = makeDeps({ gitApply });

    await run(deps, 'session_1', { turn: undefined, session: false, reverse: false, stdout: false, check: true });

    expect(gitApply).toHaveBeenCalledWith({ patch: expect.any(String), check: true });
    expect(stdout.join('')).toContain('checked only');
  });

  it('exits 1 and reports when git apply rejects the patch', async () => {
    const { deps, stderr } = makeDeps({
      gitApply: () => ({ ok: false, stderr: 'error: patch failed\n' }),
    });

    const outcome = await run(deps, 'session_1', {
      turn: undefined, session: false, reverse: false, stdout: false, check: false,
    });

    expect(outcome.error?.code).toBe(1);
    expect(stderr.join('')).toContain('patch failed');
    expect(stderr.join('')).toContain('--stdout');
  });

  it('warns about excluded files and still applies the rest', async () => {
    const { deps, stderr } = makeDeps({
      getFileHistoryPatch: async () =>
        patchResult({
          excluded: [{ path: 'logo.png', reason: 'binary' }],
        }),
    });

    await run(deps, 'session_1', { turn: undefined, session: false, reverse: false, stdout: false, check: false });

    expect(stderr.join('')).toContain('Excluded logo.png (binary)');
  });

  it('exits 1 when the recorded history has no applicable changes', async () => {
    const { deps } = makeDeps({
      getFileHistoryPatch: async () =>
        ({ scope: 'turn', turnId: 7, patch: { text: '', files: [], excluded: [] } }) as never,
    });

    const outcome = await run(deps, 'session_1', {
      turn: 7, session: false, reverse: false, stdout: false, check: false,
    });

    expect(outcome.error?.code).toBe(1);
  });

  it('reports a patch build failure without a stack trace', async () => {
    const { deps, stderr } = makeDeps({
      getFileHistoryPatch: async () => {
        throw new Error('turn 9 has no recorded file history');
      },
    });

    const outcome = await run(deps, 'session_1', {
      turn: 9, session: false, reverse: false, stdout: false, check: false,
    });

    expect(outcome.error?.code).toBe(1);
    expect(stderr.join('')).toContain('turn 9 has no recorded file history');
  });
});
