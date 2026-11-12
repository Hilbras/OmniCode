import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface SessionLeaseRecord {
  readonly sessionId: string;
  readonly ownerId: string;
  readonly pid: number;
  readonly bootNonce: string;
  readonly acquiredAt: number;
  readonly heartbeatAt: number;
  readonly expiresAt: number;
}

export type SessionLeaseAcquireResult =
  | { readonly ok: true; readonly lease: SessionLeaseRecord; readonly reclaimed?: SessionLeaseRecord }
  | { readonly ok: false; readonly reason: 'held'; readonly lease: SessionLeaseRecord };

export interface SessionLeaseOptions {
  readonly directory: string;
  readonly ttlMs?: number;
  readonly ownerId?: string;
  readonly pid?: number;
  readonly bootNonce?: string;
  readonly now?: () => number;
  readonly isProcessAlive?: (pid: number) => boolean;
}

export class SessionLeaseService {
  private readonly directory: string;
  private readonly ttlMs: number;
  private readonly ownerId: string;
  private readonly pid: number;
  private readonly bootNonce: string;
  private readonly now: () => number;
  private readonly isProcessAlive: (pid: number) => boolean;

  constructor(options: SessionLeaseOptions) {
    this.directory = options.directory;
    this.ttlMs = Math.max(options.ttlMs ?? 60_000, 1);
    this.ownerId = options.ownerId ?? `${process.pid}:${randomUUID()}`;
    this.pid = options.pid ?? process.pid;
    this.bootNonce = options.bootNonce ?? randomUUID();
    this.now = options.now ?? (() => Date.now());
    this.isProcessAlive = options.isProcessAlive ?? defaultProcessAlive;
  }

  async acquire(sessionId: string): Promise<SessionLeaseAcquireResult> {
    await mkdir(this.directory, { recursive: true });
    const path = this.pathFor(sessionId);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const now = this.now();
      const lease: SessionLeaseRecord = {
        sessionId,
        ownerId: this.ownerId,
        pid: this.pid,
        bootNonce: this.bootNonce,
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt: now + this.ttlMs,
      };
      try {
        const handle = await open(path, 'wx', 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(lease, null, 2)}\n`, 'utf8');
        } finally {
          await handle.close();
        }
        return { ok: true, lease };
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
      }
      const existing = await this.read(sessionId);
      if (existing === undefined) continue;
      if (existing.ownerId === this.ownerId) return { ok: true, lease: existing };
      if (!this.isStale(existing)) return { ok: false, reason: 'held', lease: existing };
      await unlink(path).catch(() => undefined);
      const reclaimed = existing;
      const next = await this.acquireOnce(sessionId);
      return next.ok ? { ...next, reclaimed } : next;
    }
    const existing = await this.read(sessionId);
    if (existing !== undefined) return { ok: false, reason: 'held', lease: existing };
    throw new Error(`session lease acquisition raced for ${sessionId}`);
  }

  async heartbeat(sessionId: string): Promise<boolean> {
    const lease = await this.read(sessionId);
    if (lease === undefined || lease.ownerId !== this.ownerId) return false;
    const now = this.now();
    const next: SessionLeaseRecord = {
      ...lease,
      heartbeatAt: now,
      expiresAt: now + this.ttlMs,
    };
    await atomicWrite(this.pathFor(sessionId), next);
    return true;
  }

  async release(sessionId: string): Promise<boolean> {
    const lease = await this.read(sessionId);
    if (lease === undefined) return false;
    if (lease.ownerId !== this.ownerId) return false;
    await unlink(this.pathFor(sessionId)).catch(() => undefined);
    return true;
  }

  async read(sessionId: string): Promise<SessionLeaseRecord | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.pathFor(sessionId), 'utf8')) as unknown;
      return isLease(parsed) ? parsed : undefined;
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
  }

  private async acquireOnce(sessionId: string): Promise<SessionLeaseAcquireResult> {
    try {
      const now = this.now();
      const lease: SessionLeaseRecord = {
        sessionId,
        ownerId: this.ownerId,
        pid: this.pid,
        bootNonce: this.bootNonce,
        acquiredAt: now,
        heartbeatAt: now,
        expiresAt: now + this.ttlMs,
      };
      const handle = await open(this.pathFor(sessionId), 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(lease, null, 2)}\n`, 'utf8');
      } finally {
        await handle.close();
      }
      return { ok: true, lease };
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const lease = await this.read(sessionId);
      if (lease === undefined) throw error;
      return { ok: false, reason: 'held', lease };
    }
  }

  private isStale(lease: SessionLeaseRecord): boolean {
    if (lease.expiresAt <= this.now()) return true;
    if (lease.bootNonce !== this.bootNonce) return !this.isProcessAlive(lease.pid);
    return !this.isProcessAlive(lease.pid);
  }

  private pathFor(sessionId: string): string {
    return join(this.directory, `${encodeURIComponent(sessionId)}.lease.json`);
  }
}

function isLease(value: unknown): value is SessionLeaseRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['sessionId'] === 'string' &&
    typeof record['ownerId'] === 'string' &&
    typeof record['pid'] === 'number' &&
    typeof record['bootNonce'] === 'string' &&
    typeof record['acquiredAt'] === 'number' &&
    typeof record['heartbeatAt'] === 'number' &&
    typeof record['expiresAt'] === 'number'
  );
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'EEXIST';
}

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}

function defaultProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'EPERM';
  }
}
