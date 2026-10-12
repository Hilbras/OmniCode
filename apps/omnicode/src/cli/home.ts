import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const HOME_DIRNAME = '.omnicode';
export const LEGACY_HOME_DIRNAMES = ['.lacrous-omnicode', '.lacrous-kimi'] as const;
export const MIGRATION_MARKER_FILENAME = 'migrated-from-omnicode.json';

// Regenerable state that is not worth carrying over: the launcher bits, the
// downloaded tool caches, staged updates, and logs. Everything else in the
// legacy home (config, sessions, auth, plugins, history, ...) is user data.
const MIGRATION_SKIPPED_ENTRIES = new Set(['bin', 'cache', 'logs', 'updates']);

export interface HomeOutcome {
  /** The data home the CLI must use from this point on. */
  readonly home: string;
  /** True when the home was resolved from an explicit OMNICODE_HOME. */
  readonly defaultApplied: boolean;
  /** True when a legacy home was copied into the fresh data home. */
  readonly migrated: boolean;
  /** The legacy home a successful migration copied from. */
  readonly legacyHome?: string;
  /** Set when a migration was attempted but failed; the CLI starts fresh. */
  readonly migrationError?: string;
}

/**
 * Point the CLI at its data home. `OMNICODE_HOME` always wins; otherwise the
 * default is `~/.omnicode`, and on the very first run the user data from the
 * newest legacy home (`~/.lacrous-omnicode`, `~/.lacrous-kimi`) is copied in so
 * existing sessions and config follow. Legacy homes are never modified or
 * removed.
 */
export function ensureHome(
  env: NodeJS.ProcessEnv = process.env,
  osHomeDir: string = homedir(),
): HomeOutcome {
  const configured = env['OMNICODE_HOME'];
  if (configured !== undefined && configured !== '') {
    return { home: configured, defaultApplied: false, migrated: false };
  }

  const home = join(osHomeDir, HOME_DIRNAME);
  env['OMNICODE_HOME'] = home;
  if (existsSync(home)) return { home, defaultApplied: true, migrated: false };

  for (const legacy of LEGACY_HOME_DIRNAMES) {
    const legacyHome = join(osHomeDir, legacy);
    const migration = migrateLegacyHome(legacyHome, home);
    if (migration.migrated || migration.error !== undefined) {
      return {
        home,
        defaultApplied: true,
        migrated: migration.migrated,
        legacyHome,
        migrationError: migration.error,
      };
    }
  }
  return { home, defaultApplied: true, migrated: false };
}

function migrateLegacyHome(legacyHome: string, home: string): { migrated: boolean; error?: string } {
  if (!existsSync(legacyHome)) return { migrated: false };

  const staging = join(dirname(home), `.${HOME_DIRNAME.slice(1)}.migrating-${process.pid}`);
  try {
    mkdirSync(dirname(home), { recursive: true });
    mkdirSync(staging);
    for (const entry of readdirSync(legacyHome)) {
      if (MIGRATION_SKIPPED_ENTRIES.has(entry)) continue;
      cpSync(join(legacyHome, entry), join(staging, entry), { recursive: true });
    }
    writeFileSync(
      join(staging, MIGRATION_MARKER_FILENAME),
      `${JSON.stringify({ from: legacyHome, migratedAt: new Date().toISOString() }, null, 2)}\n`,
    );
    renameSync(staging, home);
    return { migrated: true };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    return {
      migrated: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}