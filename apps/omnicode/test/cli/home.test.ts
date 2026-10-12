import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureHome } from '#/cli/home';

describe('ensureHome', () => {
  let root: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'omnicode-home-'));
    env = {};
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function legacyHome(): string {
    return join(root, '.lacrous-omnicode');
  }

  function home(): string {
    return join(root, '.omnicode');
  }

  function writeLegacyLayout(dir = legacyHome()): void {
    mkdirSync(join(dir, 'sessions'), { recursive: true });
    mkdirSync(join(dir, 'cache', 'rg'), { recursive: true });
    mkdirSync(join(dir, 'logs'), { recursive: true });
    writeFileSync(join(dir, 'config.toml'), 'default_model = "k2"\n');
    writeFileSync(join(dir, 'sessions', 'sess_1.jsonl'), '{}\n');
    writeFileSync(join(dir, 'cache', 'rg', 'rg.bin'), 'binary');
    writeFileSync(join(dir, 'logs', 'cli.log'), 'noise\n');
  }

  it('respects an explicit OMNICODE_HOME and never migrates into it', () => {
    writeLegacyLayout();
    env['OMNICODE_HOME'] = join(root, 'custom-home');

    const outcome = ensureHome(env, root);

    expect(outcome).toEqual({
      home: join(root, 'custom-home'),
      defaultApplied: false,
      migrated: false,
    });
    expect(existsSync(join(root, 'custom-home'))).toBe(false);
  });

  it('defaults the data home and records it in the environment', () => {
    const outcome = ensureHome(env, root);

    expect(outcome).toEqual({
      home: home(),
      defaultApplied: true,
      migrated: false,
    });
    expect(env['OMNICODE_HOME']).toBe(home());
  });

  it('copies user data from the legacy home, skipping regenerable state', () => {
    writeLegacyLayout();

    const outcome = ensureHome(env, root);

    expect(outcome.migrated).toBe(true);
    expect(outcome.legacyHome).toBe(legacyHome());
    expect(existsSync(join(home(), 'config.toml'))).toBe(true);
    expect(existsSync(join(home(), 'sessions', 'sess_1.jsonl'))).toBe(true);
    expect(existsSync(join(home(), 'migrated-from-omnicode.json'))).toBe(true);
    expect(existsSync(join(home(), 'cache'))).toBe(false);
    expect(existsSync(join(home(), 'logs'))).toBe(false);
    expect(existsSync(join(legacyHome(), 'config.toml'))).toBe(true);
    expect(existsSync(join(legacyHome(), 'cache', 'rg', 'rg.bin'))).toBe(true);
    expect(readdirSync(root).filter((entry) => entry.includes('migrating'))).toEqual([]);
  });

  it('falls back to older legacy homes when the newest is absent', () => {
    writeLegacyLayout(join(root, '.lacrous-kimi'));

    const outcome = ensureHome(env, root);

    expect(outcome.migrated).toBe(true);
    expect(outcome.legacyHome).toBe(join(root, '.lacrous-kimi'));
    expect(existsSync(join(home(), 'config.toml'))).toBe(true);
  });

  it('never touches an existing data home', () => {
    writeLegacyLayout();
    mkdirSync(home(), { recursive: true });
    writeFileSync(join(home(), 'fresh-config.toml'), 'mine = true\n');

    const outcome = ensureHome(env, root);

    expect(outcome.migrated).toBe(false);
    expect(existsSync(join(home(), 'fresh-config.toml'))).toBe(true);
    expect(existsSync(join(home(), 'config.toml'))).toBe(false);
  });

  it('reports a migration failure instead of throwing, leaving nothing behind', () => {
    writeFileSync(legacyHome(), 'not a directory\n');

    const outcome = ensureHome(env, root);

    expect(outcome.defaultApplied).toBe(true);
    expect(outcome.migrated).toBe(false);
    expect(outcome.migrationError).toBeDefined();
    expect(outcome.legacyHome).toBe(legacyHome());
    expect(existsSync(home())).toBe(false);
    expect(readdirSync(root).filter((entry) => entry.includes('migrating'))).toEqual([]);
  });
});