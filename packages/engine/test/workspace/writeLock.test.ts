import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';

import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  acquireWorkspaceWriteLock,
  canonicalWorkspaceRoot,
  defaultWorkspaceLockDir,
  withWorkspaceWriteLock,
  workspaceLockPath,
  WorkspaceLockTimeoutError,
} from '#/workspace/writeLock';

const tempDirs: string[] = [];

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-write-lock-'));
  tempDirs.push(dir);
  return dir;
}

beforeEach(async () => {
  const lockDir = await mkdtemp(join(tmpdir(), 'omnicode-write-lock-dir-'));
  tempDirs.push(lockDir);
  process.env['OMNICODE_WRITE_LOCK_DIR'] = lockDir;
});

afterEach(async () => {
  delete process.env['OMNICODE_WRITE_LOCK_DIR'];
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Run two writers concurrently and report whether their critical sections overlapped. */
async function overlaps(firstRoot: string, secondRoot: string): Promise<boolean> {
  let active = 0;
  let overlapped = false;
  const writer = (root: string) =>
    withWorkspaceWriteLock(root, async () => {
      active += 1;
      if (active > 1) overlapped = true;
      await new Promise((done) => setTimeout(done, 40));
      active -= 1;
    });
  await Promise.all([writer(firstRoot), writer(secondRoot)]);
  return overlapped;
}

describe('workspace write lock', () => {
  it('creates the lock file with the owner and removes it on release', async () => {
    const root = await makeWorkspace();
    const lockPath = workspaceLockPath(await canonicalWorkspaceRoot(root));
    const lock = await acquireWorkspaceWriteLock(root);
    expect(lock.held()).toBe(true);
    const owner = JSON.parse(await readFile(lockPath, 'utf8')) as { readonly pid: number; readonly token: string };
    expect(owner.pid).toBe(process.pid);
    expect(owner.token).toBe(lock.owner.token);

    await lock.release();
    expect(lock.held()).toBe(false);
    await expect(readFile(lockPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('serializes concurrent writers on the same canonical root', async () => {
    const root = await makeWorkspace();
    expect(await overlaps(root, root)).toBe(false);
  });

  it('serializes writers that reach the same root through a symlink', async () => {
    const root = await makeWorkspace();
    const linked = `${root}-link`;
    tempDirs.push(linked);
    await symlink(root, linked);
    expect(await overlaps(root, linked)).toBe(false);
  });

  it('reports the live owner instead of stealing the lock', async () => {
    const root = await makeWorkspace();
    const canonical = await canonicalWorkspaceRoot(root);
    const lockPath = workspaceLockPath(canonical);
    await writeFile(
      lockPath,
      JSON.stringify({ pid: process.pid, token: 'other:owner', startedAt: 1234 }),
      { mode: 0o600 },
    );

    await expect(acquireWorkspaceWriteLock(root, { timeoutMs: 120, pollMs: 10 })).rejects.toThrow(
      WorkspaceLockTimeoutError,
    );
    await expect(acquireWorkspaceWriteLock(root, { timeoutMs: 120, pollMs: 10 })).rejects.toThrow(
      /held by pid \d+/,
    );
    const stillThere = JSON.parse(await readFile(lockPath, 'utf8')) as { readonly token: string };
    expect(stillThere.token).toBe('other:owner');
    await rm(lockPath, { force: true });
  });

  it('reclaims a lock whose owner pid is gone', async () => {
    const root = await makeWorkspace();
    const canonical = await canonicalWorkspaceRoot(root);
    const lockPath = workspaceLockPath(canonical);
    await writeFile(lockPath, JSON.stringify({ pid: 999_999, token: 'dead:owner', startedAt: 1 }), { mode: 0o600 });

    const lock = await acquireWorkspaceWriteLock(root, { pidAlive: () => false, timeoutMs: 500, pollMs: 10 });
    expect(lock.held()).toBe(true);
    const owner = JSON.parse(await readFile(lockPath, 'utf8')) as { readonly token: string };
    expect(owner.token).toBe(lock.owner.token);
    await lock.release();
  });

  it('releases the lock when the guarded task throws', async () => {
    const root = await makeWorkspace();
    const lockPath = workspaceLockPath(await canonicalWorkspaceRoot(root));
    await expect(
      withWorkspaceWriteLock(root, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(readFile(lockPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    const reacquired = await acquireWorkspaceWriteLock(root, { timeoutMs: 200 });
    expect(reacquired.held()).toBe(true);
    await reacquired.release();
  });
});

describe('default workspace lock directory', () => {
  it('resolves the product home, honors OMNICODE_HOME first, accepts the pre-rename var, and keeps the explicit override', () => {
    expect(defaultWorkspaceLockDir({})).toBe(join(homedir(), '.omnicode', 'locks'));
    expect(defaultWorkspaceLockDir({ OMNICODE_HOME: '/legacy-home' })).toBe(
      join('/legacy-home', 'locks'),
    );
    expect(
      defaultWorkspaceLockDir({ OMNICODE_HOME: '/v-home', OMNICODE_V_HOME: '/legacy-home' }),
    ).toBe(join('/v-home', 'locks'));
    expect(defaultWorkspaceLockDir({ OMNICODE_V_HOME: '/older-home' })).toBe(
      join('/older-home', 'locks'),
    );
    expect(defaultWorkspaceLockDir({ OMNICODE_WRITE_LOCK_DIR: '/explicit-locks' })).toBe(
      '/explicit-locks',
    );
  });
});
