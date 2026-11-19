/**
 * `omnicode apply` sub-command.
 *
 * Turns a session's recorded file history into a complete unified diff and
 * pipes it through `git apply` — the Codex `codex apply` property: the
 * changes an agent made in one checkout become an artifact you can move to
 * another (or review with `--stdout`, validate with `--check`, or undo with
 * `--reverse`). CLI glue only: the patch itself is owned by the engine's
 * durable file history and rendered uncapped.
 */

import { spawnSync } from 'node:child_process';

import { createOmnicodeHarness, type FileHistoryPatchResult, type OmnicodeHarness, type SessionSummary } from '@hilbras/omnicode-api';
import type { Command } from 'commander';

import { createCliTelemetryBootstrap } from '#/cli/telemetry';
import { createOmnicodeCodeHostIdentity } from '#/cli/version';
import { resolveCommandPath } from '#/utils/process/resolve-command';

interface WritableLike {
  write(chunk: string): boolean;
}

export interface ApplyDeps {
  readonly listSessions: (workDir: string) => Promise<readonly SessionSummary[]>;
  readonly getFileHistoryPatch: (input: {
    sessionId: string;
    scope?: 'turn' | 'session';
    turnId?: number;
    reverse?: boolean;
  }) => Promise<FileHistoryPatchResult>;
  readonly version: string;
  readonly cwd: () => string;
  readonly stdout: WritableLike;
  readonly stderr: WritableLike;
  readonly exit: (code: number) => never;
  readonly gitApply: (args: { patch: string; check: boolean }) => { ok: boolean; stderr: string };
}

export interface ApplyOptions {
  readonly turn: number | undefined;
  readonly session: boolean;
  readonly reverse: boolean;
  readonly stdout: boolean;
  readonly check: boolean;
}

export async function handleApply(
  deps: ApplyDeps,
  sessionId: string | undefined,
  opts: ApplyOptions,
): Promise<void> {
  const workDir = deps.cwd();
  let resolvedId = sessionId;
  if (resolvedId === undefined) {
    const sessions = await deps.listSessions(workDir);
    const latest = sessions.at(-1);
    if (latest === undefined) {
      deps.stderr.write('No session found for this directory — pass a session id.\n');
      deps.exit(1);
    }
    resolvedId = latest.id;
  }

  let result: FileHistoryPatchResult;
  try {
    result = await deps.getFileHistoryPatch({
      sessionId: resolvedId,
      scope: opts.session ? 'session' : 'turn',
      turnId: opts.turn,
      reverse: opts.reverse,
    });
  } catch (error) {
    deps.stderr.write(`Failed to build the patch: ${error instanceof Error ? error.message : String(error)}\n`);
    deps.exit(1);
  }

  for (const excluded of result.patch.excluded) {
    deps.stderr.write(`Excluded ${excluded.path} (${excluded.reason}) — not part of the patch.\n`);
  }

  if (result.patch.text === '') {
    const scope =
      opts.session
        ? 'the session'
        : `turn ${String(opts.turn ?? result.turnId ?? 'latest')}`;
    deps.stderr.write(`No applicable changes recorded for ${scope}.\n`);
    deps.exit(1);
  }

  if (opts.stdout) {
    deps.stdout.write(result.patch.text);
    return;
  }

  const git = resolveCommandPath('git', workDir);
  if (git === undefined) {
    deps.stderr.write('git is not available on PATH — rerun with --stdout and apply the patch yourself.\n');
    deps.exit(1);
  }

  const applied = deps.gitApply({ patch: result.patch.text, check: opts.check });
  if (!applied.ok) {
    deps.stderr.write(applied.stderr);
    deps.stderr.write('The patch did not apply cleanly — rerun with --stdout to inspect it.\n');
    deps.exit(1);
  }

  if (opts.check) {
    deps.stdout.write('The patch applies cleanly (checked only, nothing was changed).\n');
  } else {
    deps.stdout.write(`Applied ${String(result.patch.files.length)} file(s) from ${String(resolvedId)}.\n`);
  }
}

export function registerApplyCommand(parent: Command, deps?: Partial<ApplyDeps>): void {
  parent
    .command('apply')
    .description('Apply a session\u2019s recorded file changes to this directory with git apply.')
    .option('--turn <n>', 'Apply one recorded turn (defaults to the latest).')
    .option('--session', 'Apply every recorded turn, merged per file.')
    .option('--reverse', 'Apply the reverse patch (undo the changes).')
    .option('--stdout', 'Print the patch instead of applying it.')
    .option('--check', 'Validate that the patch would apply, without changing anything.')
    .argument('[sessionId]', 'Session id. Defaults to the most recent session for this directory.')
    .action(
      async (
        sessionId: string | undefined,
        options: { turn?: string; session?: boolean; reverse?: boolean; stdout?: boolean; check?: boolean },
      ) => {
        const resolved = createDefaultApplyDeps(deps);
        try {
          const turn = options.turn === undefined ? undefined : Number.parseInt(options.turn, 10);
          if (turn !== undefined && Number.isNaN(turn)) {
            resolved.stderr.write('--turn expects a number.\n');
            resolved.exit(1);
          }
          await handleApply(resolved, sessionId, {
            turn,
            session: options.session === true,
            reverse: options.reverse === true,
            stdout: options.stdout === true,
            check: options.check === true,
          });
        } finally {
          await resolved.close();
        }
      },
    );
}

function createDefaultApplyDeps(overrides: Partial<ApplyDeps> = {}): ApplyDeps & {
  readonly close: () => Promise<void>;
} {
  let harness: OmnicodeHarness | undefined;
  const identity = createOmnicodeCodeHostIdentity();
  const cwd = overrides.cwd ?? (() => process.cwd());

  const getHarness = (): OmnicodeHarness => {
    harness ??= createOmnicodeHarness({
      homeDir: createCliTelemetryBootstrap().homeDir,
      identity,
    });
    return harness;
  };

  return {
    listSessions:
      overrides.listSessions ?? ((workDir: string) => getHarness().listSessions({ workDir })),
    getFileHistoryPatch:
      overrides.getFileHistoryPatch ??
      (async (input) => {
        const current = getHarness();
        const session = await current.resumeSession({ id: input.sessionId });
        return session.getFileHistoryPatch({
          scope: input.scope,
          turnId: input.turnId,
          reverse: input.reverse,
        });
      }),
    version: overrides.version ?? identity.version,
    cwd,
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    exit: overrides.exit ?? ((code: number) => process.exit(code)),
    gitApply:
      overrides.gitApply ??
      (({ patch, check }: { patch: string; check: boolean }) => {
        const git = resolveCommandPath('git', cwd());
        if (git === undefined) return { ok: false, stderr: 'git is not available on PATH.\n' };
        const args = check ? ['apply', '--check'] : ['apply'];
        const result = spawnSync(git, args, { input: patch, encoding: 'utf8' });
        return {
          ok: result.status === 0,
          stderr: typeof result.stderr === 'string' ? result.stderr : '',
        };
      }),
    close: async () => {
      await harness?.close();
    },
  };
}
