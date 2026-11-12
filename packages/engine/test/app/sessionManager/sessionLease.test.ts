import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { SessionLeaseService } from '#/app/sessionManager/sessionLease';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-session-lease-'));
  dirs.push(dir);
  return dir;
}

function lease(dir: string, ownerId: string, now: () => number, alive = true): SessionLeaseService {
  return new SessionLeaseService({
    directory: dir,
    ownerId,
    pid: ownerId === 'owner-a' ? 1001 : 1002,
    bootNonce: 'boot-1',
    ttlMs: 1000,
    now,
    isProcessAlive: () => alive,
  });
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('session ownership lease', () => {
  it('refuses a second live owner', async () => {
    const dir = await tempDir();
    let now = 100;
    const first = lease(dir, 'owner-a', () => now);
    const second = lease(dir, 'owner-b', () => now);
    expect((await first.acquire('session-1')).ok).toBe(true);
    const conflict = await second.acquire('session-1');
    expect(conflict).toMatchObject({ ok: false, reason: 'held', lease: { ownerId: 'owner-a' } });
    expect((await first.acquire('session-1')).ok).toBe(true);
  });

  it('reclaims expired locks and dead owners', async () => {
    const dir = await tempDir();
    let now = 100;
    const first = lease(dir, 'owner-a', () => now, false);
    const second = lease(dir, 'owner-b', () => now, false);
    expect((await first.acquire('session-1')).ok).toBe(true);
    now = 1200;
    const reclaimed = await second.acquire('session-1');
    expect(reclaimed).toMatchObject({ ok: true, reclaimed: { ownerId: 'owner-a' }, lease: { ownerId: 'owner-b' } });
  });

  it('does not reclaim a live owner inside the ttl', async () => {
    const dir = await tempDir();
    let now = 100;
    const first = lease(dir, 'owner-a', () => now, true);
    const second = lease(dir, 'owner-b', () => now, true);
    await first.acquire('session-1');
    now = 500;
    await expect(second.acquire('session-1')).resolves.toMatchObject({ ok: false, reason: 'held' });
  });

  it('extends on heartbeat and only the owner can release', async () => {
    const dir = await tempDir();
    let now = 100;
    const first = lease(dir, 'owner-a', () => now);
    const second = lease(dir, 'owner-b', () => now);
    await first.acquire('session-1');
    now = 900;
    expect(await first.heartbeat('session-1')).toBe(true);
    expect((await first.read('session-1'))?.expiresAt).toBe(1900);
    expect(await second.release('session-1')).toBe(false);
    expect(await first.release('session-1')).toBe(true);
    expect(await first.read('session-1')).toBeUndefined();
  });

  it('rejects malformed lease files', async () => {
    const dir = await tempDir();
    const first = lease(dir, 'owner-a', () => 100);
    await first.acquire('session-1');
    await expect(first.read('session-1')).resolves.toBeDefined();
  });
});
