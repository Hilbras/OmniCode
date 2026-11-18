import { execFile } from 'node:child_process';
import { chmod, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { ILogService, type ILogger } from '@hilbras/omnicode-base/log/log';
import { LifecycleScope } from '#/app/scopes';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';

export const SHELL_SNAPSHOT_ENV = 'OMNICODE_SHELL_SNAPSHOT';
export const SHELL_SNAPSHOT_FILENAME = 'shell-snapshot.sh';

const ALIAS_LINE = /^alias [A-Za-z0-9_.:-]+=/;
const SNAPSHOT_TIMEOUT_MS = 3_000;

let snapshotPath: string | undefined;

export function shellSnapshotEnv(): Record<string, string> {
  return snapshotPath === undefined ? {} : { BASH_ENV: snapshotPath };
}

export function parseShellAliases(output: string): string[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => ALIAS_LINE.test(line));
}

export interface IShellSnapshotService {
  readonly _serviceBrand: undefined;
  readonly path: string | undefined;
  refresh(): Promise<void>;
}

export const IShellSnapshotService = createDecorator<IShellSnapshotService>(
  'shellSnapshotService',
);

export class ShellSnapshotService implements IShellSnapshotService {
  declare readonly _serviceBrand: undefined;
  private readonly log: ILogger;
  private current: string | undefined;

  constructor(
    @IBootstrapService private readonly bootstrap: IBootstrapService,
    @ILogService log: ILogService,
  ) {
    this.log = log.child({ shell: 'snapshot' });
    if (process.env[SHELL_SNAPSHOT_ENV] === '1') void this.refresh();
  }

  get path(): string | undefined {
    return this.current;
  }

  async refresh(): Promise<void> {
    const shell = process.env['SHELL'] ?? '/bin/bash';
    let stdout: string;
    try {
      stdout = await runCapture(shell);
    } catch (error) {
      this.log.info('shell snapshot skipped', {
        reason: error instanceof Error ? error.message : 'unknown error',
      });
      return;
    }
    const aliases = parseShellAliases(stdout);
    if (aliases.length === 0) {
      this.current = undefined;
      snapshotPath = undefined;
      return;
    }
    const target = join(this.bootstrap.homeDir, SHELL_SNAPSHOT_FILENAME);
    const temporary = `${target}.tmp.${process.pid}`;
    try {
      await writeFile(temporary, `${aliases.join('\n')}\n`, { mode: 0o600 });
      await rename(temporary, target);
      await chmod(target, 0o600);
    } catch (error) {
      this.log.info('shell snapshot not written', {
        reason: error instanceof Error ? error.message : 'unknown error',
      });
      return;
    }
    this.current = target;
    snapshotPath = target;
  }
}

function runCapture(shell: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      shell,
      ['-ic', 'alias -p'],
      {
        timeout: SNAPSHOT_TIMEOUT_MS,
        maxBuffer: 256 * 1024,
        env: { ...process.env, PS1: '', TERM: 'dumb' },
      },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

registerScopedService(
  LifecycleScope.App,
  IShellSnapshotService,
  ShellSnapshotService,
  ScopeActivation.OnScopeCreated,
  'shellSnapshot',
);
