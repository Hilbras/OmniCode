import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * Workspace write lock: serializes concurrent writers per canonical workspace
 * root, inside the process and across processes.
 *
 * In-process contention queues on a per-root promise chain, so two tool calls
 * in the same session never interleave their writes. Cross-process contention
 * uses an exclusively-created lock file holding the owner pid and an ownership
 * token; a lock whose owner pid is gone is reclaimed, a live owner is waited
 * for up to `timeoutMs` and then reported with the owner's diagnostics instead
 * of being stolen.
 */

export interface WorkspaceLockOwner {
  readonly pid: number;
  readonly token: string;
  readonly startedAt: number;
}

export class WorkspaceLockTimeoutError extends Error {
  readonly code = 'ELOCKED';

  constructor(
    readonly workspaceRoot: string,
    readonly lockPath: string,
    readonly owner: WorkspaceLockOwner | undefined,
    readonly waitedMs: number,
  ) {
    const holder =
      owner === undefined
        ? 'an unreadable lock file'
        : `pid ${String(owner.pid)} (held since ${new Date(owner.startedAt).toISOString()})`;
    super(`Timed out waiting ${String(waitedMs)}ms for the workspace write lock at ${lockPath}, held by ${holder}.`);
    this.name = 'WorkspaceLockTimeoutError';
  }
}

export interface WorkspaceWriteLockOptions {
  /** Total wait before giving up. Default 10s. */
  readonly timeoutMs?: number;
  /** Retry interval while another owner holds the lock. Default 50ms. */
  readonly pollMs?: number;
  /** Directory holding lock files. Defaults to `<OMNICODE_V_HOME|OMNICODE_HOME|~/.omnicode-v>/locks`. */
  readonly lockDir?: string;
  /** Lock file name override; defaults to a hash of the canonical root. */
  readonly lockFileName?: string;
  /** Injectable liveness probe; defaults to `process.kill(pid, 0)`. */
  readonly pidAlive?: (pid: number) => boolean;
  /** Injectable clock for tests. */
  readonly now?: () => number;
}

export interface WorkspaceWriteLockHandle {
  readonly workspaceRoot: string;
  readonly lockPath: string;
  readonly owner: WorkspaceLockOwner;
  held(): boolean;
  release(): Promise<void>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_MS = 50;

const queues = new Map<string, Promise<unknown>>();

function defaultPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

/** Canonical identity of a workspace root: symlinked roots share one lock. */
export async function canonicalWorkspaceRoot(workspaceRoot: string): Promise<string> {
  const absolute = resolve(workspaceRoot);
  try {
    return await realpath(absolute);
  } catch {
    return absolute;
  }
}

/** Lock files live outside the workspace so a user's repo never gains stray files. */
export function defaultWorkspaceLockDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['OMNICODE_WRITE_LOCK_DIR']?.trim();
  if (configured !== undefined && configured.length > 0) return configured;
  const home = (env['OMNICODE_V_HOME'] ?? env['OMNICODE_HOME'])?.trim();
  return join(home !== undefined && home.length > 0 ? home : join(homedir(), '.omnicode-v'), 'locks');
}

/** Path of the lock guarding `workspaceRoot`; the canonical root is hashed so symlinks collide. */
export function workspaceLockPath(
  workspaceRoot: string,
  options: { readonly lockDir?: string; readonly lockFileName?: string } = {},
): string {
  const dir = options.lockDir ?? defaultWorkspaceLockDir();
  const name =
    options.lockFileName ?? `${createHash('sha256').update(workspaceRoot).digest('hex').slice(0, 32)}.lock`;
  return join(dir, name);
}

async function readOwner(lockPath: string): Promise<WorkspaceLockOwner | undefined> {
  try {
    const parsed = JSON.parse(await readFile(lockPath, 'utf8')) as Partial<WorkspaceLockOwner>;
    if (typeof parsed.pid !== 'number' || !Number.isInteger(parsed.pid)) return undefined;
    return {
      pid: parsed.pid,
      token: typeof parsed.token === 'string' ? parsed.token : '',
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
    };
  } catch {
    return undefined;
  }
}

/** Serialize work per canonical root inside this process. */
async function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const current = previous.then(task, task);
  const guard = current.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, guard);
  try {
    return await current;
  } finally {
    if (queues.get(key) === guard) queues.delete(key);
  }
}

export async function acquireWorkspaceWriteLock(
  workspaceRoot: string,
  options: WorkspaceWriteLockOptions = {},
): Promise<WorkspaceWriteLockHandle> {
  const root = await canonicalWorkspaceRoot(workspaceRoot);
  return serialize(root, () => acquireFileLock(root, options));
}

export async function withWorkspaceWriteLock<T>(
  workspaceRoot: string,
  task: () => Promise<T>,
  options: WorkspaceWriteLockOptions = {},
): Promise<T> {
  const lock = await acquireWorkspaceWriteLock(workspaceRoot, options);
  try {
    return await task();
  } finally {
    await lock.release();
  }
}

async function acquireFileLock(root: string, options: WorkspaceWriteLockOptions): Promise<WorkspaceWriteLockHandle> {
  const lockPath = workspaceLockPath(root, options);
  const now = options.now ?? Date.now;
  const alive = options.pidAlive ?? defaultPidAlive;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });

  const owner: WorkspaceLockOwner = { pid: process.pid, token: `${String(process.pid)}:${randomUUID()}`, startedAt: now() };
  const deadline = now() + timeoutMs;
  let held = false;

  for (;;) {
    if (await tryCreate(lockPath, owner)) {
      held = true;
      break;
    }
    const seen = await readOwner(lockPath);
    if (seen !== undefined && !alive(seen.pid) && (await takeOver(lockPath, owner))) {
      held = true;
      break;
    }
    if (now() >= deadline) {
      throw new WorkspaceLockTimeoutError(root, lockPath, await readOwner(lockPath), timeoutMs);
    }
    await sleep(pollMs + Math.floor(Math.random() * 10));
  }

  return {
    workspaceRoot: root,
    lockPath,
    owner,
    held: () => held,
    release: async () => {
      if (!held) return;
      held = false;
      const current = await readOwner(lockPath);
      if (current?.token === owner.token) await unlink(lockPath).catch(() => undefined);
    },
  };
}

/** Exclusive create: `wx` fails with EEXIST instead of truncating a held lock. */
async function tryCreate(lockPath: string, owner: WorkspaceLockOwner): Promise<boolean> {
  try {
    await writeFile(lockPath, JSON.stringify(owner), { flag: 'wx', mode: 0o600 });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

/**
 * Replace a dead owner's lock with ours by atomic rename, then verify the
 * token landed: two reclaimers can race, and the loser must not believe it
 * holds a lock the winner now owns.
 */
async function takeOver(lockPath: string, owner: WorkspaceLockOwner): Promise<boolean> {
  const bid = `${lockPath}.bid-${String(process.pid)}-${randomUUID()}`;
  try {
    await writeFile(bid, JSON.stringify(owner), { mode: 0o600 });
    await rename(bid, lockPath);
  } catch {
    await unlink(bid).catch(() => undefined);
    return false;
  }
  const current = await readOwner(lockPath);
  return current?.token === owner.token;
}
