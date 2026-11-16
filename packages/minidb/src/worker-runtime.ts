import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const TEXT_BUILD_WORKER_PROTOCOL_VERSION = 1;

const TRANSFORM_TYPES_FLAG = '--experimental-transform-types';
const EXPERIMENTAL_WARNING_FLAG = '--disable-warning=ExperimentalWarning';

export type TextBuildWorkerRuntimeEntry =
  | { readonly kind: 'packaged'; readonly path: string }
  | { readonly kind: 'source'; readonly url: URL };

export type TextBuildWorkerRuntimeState =
  | { readonly configured: false }
  | { readonly configured: true; readonly entry: TextBuildWorkerRuntimeEntry };

let configuredEntry: TextBuildWorkerRuntimeEntry | null = null;

function assertRegularFile(filePath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    throw new TypeError(
      `MiniDb text-build worker entry is not readable: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (!stat.isFile()) {
    throw new TypeError('MiniDb text-build worker entry must be a regular file');
  }
}

/** Configure the packaged worker entry once during process startup. */
export function configureTextBuildWorkerRuntime(entry: string | URL): TextBuildWorkerRuntimeState {
  let next: TextBuildWorkerRuntimeEntry;
  if (typeof entry === 'string') {
    if (!path.isAbsolute(entry)) {
      throw new TypeError('MiniDb packaged text-build worker entry must be an absolute path');
    }
    assertRegularFile(entry);
    next = { kind: 'packaged', path: entry };
  } else {
    if (entry.protocol !== 'file:' || !entry.pathname.endsWith('.ts')) {
      throw new TypeError('MiniDb source text-build worker entry must be a file: URL to a .ts file');
    }
    assertRegularFile(fileURLToPath(entry));
    next = { kind: 'source', url: entry };
  }

  if (configuredEntry !== null) {
    const current = configuredEntry.kind === 'packaged' ? configuredEntry.path : configuredEntry.url.href;
    const requested = next.kind === 'packaged' ? next.path : next.url.href;
    if (current !== requested) {
      throw new Error('MiniDb text-build worker runtime is already configured');
    }
    return { configured: true, entry: configuredEntry };
  }

  configuredEntry = next;
  return { configured: true, entry: configuredEntry };
}

/** Reset process-wide configuration. Intended for tests and controlled hosts. */
export function resetTextBuildWorkerRuntime(): void {
  configuredEntry = null;
}

export function getTextBuildWorkerRuntimeState(): TextBuildWorkerRuntimeState {
  return configuredEntry === null
    ? { configured: false }
    : { configured: true, entry: configuredEntry };
}

let transformTypesFlagUsable: boolean | undefined;

function supportsTransformTypesFlag(): boolean {
  transformTypesFlagUsable ??= (() => {
    try {
      const probe = spawnSync(process.execPath, [TRANSFORM_TYPES_FLAG, '-e', ''], {
        encoding: 'utf8',
      });
      return probe.status === 0;
    } catch {
      return false;
    }
  })();
  return transformTypesFlagUsable;
}

function tsxLoaderSpecifier(): string {
  return fileURLToPath(new URL('../../../node_modules/tsx/dist/loader.mjs', import.meta.url));
}

/**
 * `execArgv` that lets a worker thread run this repository's TypeScript worker
 * sources. The sources use non-erasable syntax, so plain strip-only mode fails;
 * Node 22–25 needs `--experimental-transform-types`, while Node ≥26 removed the
 * flag (passing it to `Worker` is a hard error) and no longer maps `.js`
 * specifiers onto `.ts`, so the repository's `tsx` loader takes over both jobs.
 */
export function tsWorkerExecArgv(): readonly string[] {
  return supportsTransformTypesFlag()
    ? [TRANSFORM_TYPES_FLAG, EXPERIMENTAL_WARNING_FLAG]
    : ['--import', tsxLoaderSpecifier(), EXPERIMENTAL_WARNING_FLAG];
}
