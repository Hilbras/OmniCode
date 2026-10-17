import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ensureHome, HOME_DIRNAME, LEGACY_HOME_DIRNAMES } from '#/cli/home';

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

  function home(): string {
    return join(root, HOME_DIRNAME);
  }

  function writeHomeLayout(dir = home()): void {
    mkdirSync(join(dir, 'sessions'), { recursive: true });
    mkdirSync(join(dir, 'cache', 'rg'), { recursive: true });
    mkdirSync(join(dir, 'logs'), { recursive: true });
    writeFileSync(join(dir, 'config.toml'), 'default_model = "k2"\n');
    writeFileSync(join(dir, 'sessions', 'sess_1.jsonl'), '{}\n');
    writeFileSync(join(dir, 'cache', 'rg', 'rg.bin'), 'binary');
    writeFileSync(join(dir, 'logs', 'cli.log'), 'noise\n');
  }

  it('respects an explicit OMNICODE_HOME and never migrates into it', () => {
    writeHomeLayout();
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

  it('never touches an existing data home', () => {
    writeHomeLayout();
    writeFileSync(join(home(), 'fresh-config.toml'), 'mine = true\n');

    const outcome = ensureHome(env, root);

    expect(outcome.migrated).toBe(false);
    expect(outcome.legacyHome).toBeUndefined();
    expect(existsSync(join(home(), 'fresh-config.toml'))).toBe(true);
    expect(existsSync(join(home(), 'config.toml'))).toBe(true);
    expect(readdirSync(root).filter((entry) => entry.includes('migrating'))).toEqual([]);
  });

  it('treats a stray non-directory at the data home path as an existing home', () => {
    writeFileSync(home(), 'not a directory\n');

    const outcome = ensureHome(env, root);

    expect(outcome.defaultApplied).toBe(true);
    expect(outcome.migrated).toBe(false);
    expect(outcome.migrationError).toBeUndefined();
    expect(outcome.legacyHome).toBeUndefined();
    expect(existsSync(home())).toBe(true);
    expect(readdirSync(root).filter((entry) => entry.includes('migrating'))).toEqual([]);
  });

  it('names no legacy home distinct from the data home itself', () => {
    expect(LEGACY_HOME_DIRNAMES).toEqual([HOME_DIRNAME]);

    const outcome = ensureHome(env, root);

    expect(outcome.migrated).toBe(false);
    expect(outcome.legacyHome).toBeUndefined();
  });
});