import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { MemoryErrors } from '#/contracts/errors';
import { MiniDbMemoryStore } from '#/storage/miniDbMemoryStore';

import { captureInput, Clock, evidenceFor, REPO_A, RecordingLogger } from './helpers';
import { MemoryService } from '#/service/memoryService';

const HOLDER = join(import.meta.dirname, 'fixtures', 'hold-store.mts');
const TSX = join(import.meta.dirname, '..', '..', '..', 'node_modules', '.bin', 'tsx');

const dirs: string[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) {
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  }
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-memory-proc-'));
  dirs.push(dir);
  return dir;
}

interface Holder {
  readonly readOnly: boolean;
  readonly child: ChildProcess;
}

async function startHolder(dir: string): Promise<Holder> {
  const child = spawn(TSX, [HOLDER, dir], { stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const stderr: string[] = [];
  child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk.toString()));

  return new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(() => {
      reject(new Error(`lock holder never became ready: ${buffer}${stderr.join('')}`));
    }, 30_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      const parsed = JSON.parse(buffer.slice(0, newline)) as { ready: boolean; readOnly: boolean };
      if (!parsed.ready) return;
      clearTimeout(timer);
      resolve({ readOnly: parsed.readOnly, child });
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`lock holder exited early with ${code}: ${stderr.join('')}`));
    });
  });
}

describe('a second operating-system process', () => {
  it('cannot take the write lock, and says so instead of corrupting anything', async () => {
    const dir = await tempDir();
    const holder = await startHolder(dir);
    expect(holder.readOnly).toBe(false);

    const contender = await MiniDbMemoryStore.open({ dir });
    try {
      expect(contender.readOnly).toBe(true);
      expect(await contender.get('m:held-by-child')).toEqual({
        id: 'held-by-child',
        content: 'written by the child process',
      });
      await expect(
        contender.commit([{ op: 'set', key: 'm:from-parent', value: { id: 'from-parent' } }]),
      ).rejects.toMatchObject({ code: MemoryErrors.codes.STORAGE_WRITE_FAILED });
      expect(await contender.get('m:from-parent')).toBeUndefined();
    } finally {
      await contender.close();
    }
  }, 60_000);

  it('keeps the parent service usable for reads while another process owns writes', async () => {
    const dir = await tempDir();
    await startHolder(dir);

    const contender = await MiniDbMemoryStore.open({ dir });
    const service = new MemoryService({
      store: contender,
      log: new RecordingLogger(),
      now: new Clock(1_700_000_000_000).now,
    });
    try {
      const stored = await service.capture(
        captureInput('this repository bundles the cli with tsup', {
          scope: { tier: 'repository', projectId: REPO_A },
          evidence: evidenceFor('package.json'),
        }),
      );
      expect(stored.status).toBe('failed');
      expect(stored.id).toBeUndefined();

      const diagnostics = await service.diagnostics();
      expect(diagnostics.readOnly).toBe(true);
      expect(diagnostics.counts.distilled).toBe(0);
    } finally {
      await contender.close();
    }
  }, 60_000);

  it('takes the lock once the other process exits', async () => {
    const dir = await tempDir();
    const holder = await startHolder(dir);
    holder.child.kill('SIGTERM');
    await new Promise((resolve) => holder.child.once('exit', resolve));

    const successor = await MiniDbMemoryStore.open({ dir });
    try {
      expect(successor.readOnly).toBe(false);
      await successor.commit([{ op: 'set', key: 'm:after', value: { id: 'after', content: 'after release' } }]);
      expect(await successor.get('m:held-by-child')).toEqual({
        id: 'held-by-child',
        content: 'written by the child process',
      });
      expect(await successor.get('m:after')).toEqual({ id: 'after', content: 'after release' });
    } finally {
      await successor.close();
    }
  }, 60_000);
});