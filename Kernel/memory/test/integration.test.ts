import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import '@hilbras/omnicode-core/features/featureAssemblyService';
import '@hilbras/omnicode-core/app/feature/featureManagerService';
import { createServices } from '@hilbras/omnicode-core/_base/di/testInstantiationService';
import { createScopedTestHost } from '@hilbras/omnicode-core/_base/di/test';
import { DisposableStore } from '@hilbras/omnicode-core/_base/di/lifecycle';
import { getFeatureRecipes } from '@hilbras/omnicode-core/features/featureRegistry';
import { getContributedFlags } from '@hilbras/omnicode-core/app/flag/flagRegistry';
import { getConfigSectionContributions } from '@hilbras/omnicode-core/app/config/configSectionContributions';
import { IBootstrapService } from '@hilbras/omnicode-core/app/bootstrap/bootstrap';
import { IConfigService } from '@hilbras/omnicode-core/app/config/config';
import { IFlagService } from '@hilbras/omnicode-core/app/flag/flag';
import { ILogService } from '@hilbras/omnicode-core/_base/log/log';
import { ISessionContext } from '@hilbras/omnicode-core/session/sessionContext/sessionContext';
import { IHostFileSystem } from '@hilbras/omnicode-core/os/interface/hostFileSystem';

import { IMemoryService } from '#/contracts/memoryContract';
import { MEMORY_FLAG_ENV, MEMORY_FLAG_ID } from '#/feature/flag';
import { MemoryFeature } from '#/feature/memoryFeature';
import { AppMemoryService } from '#/service/appMemoryService';

import { RecordingLogger } from './helpers';

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
});

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('condition was not met before the timeout');
}

async function tempHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-memory-home-'));
  dirs.push(dir);
  return dir;
}

function appStubs(homeDir: string, log: RecordingLogger, enabled = false) {
  return [
    [IBootstrapService, { homeDir, cwd: homeDir, getEnv: (name: string) => process.env[name] } as never],
    [IConfigService, { get: () => undefined, getAll: () => ({}) } as never],
    [
      IFlagService,
      {
        enabled: () => enabled,
        snapshot: () => ({}),
        explain: () => undefined,
        explainAll: () => ({}),
        enabledIds: () => [],
        exposedIds: () => [],
        setConfigOverrides: () => undefined,
        registry: undefined,
      } as never,
    ],
    [ILogService, log as never],
    [
      IHostFileSystem,
      {
        stat: async () => ({ isFile: false, isDirectory: true, size: 0 }),
        lstat: async () => ({ isFile: false, isDirectory: true, size: 0 }),
        readText: async () => {
          throw new Error('no such file');
        },
        readdir: async () => [],
        mkdir: async () => undefined,
        remove: async () => undefined,
        realpath: async (path: string) => path,
      } as never,
    ],
  ] as const;
}

describe('feature activation', () => {
  it('registers the memory feature at import time', () => {
    const recipes = getFeatureRecipes();
    expect(recipes.some((recipe) => recipe === MemoryFeature)).toBe(true);
  });

  it('registers the experimental flag with the documented env name', () => {
    const flag = getContributedFlags().find((definition) => definition.id === MEMORY_FLAG_ID);
    expect(flag?.env).toBe(MEMORY_FLAG_ENV);
    expect(flag?.default).toBe(true);
    expect(flag?.surface).toBe('both');
  });

  it('registers the memory config section', () => {
    expect(getConfigSectionContributions().some((section) => section.domain === 'memory')).toBe(true);
  });


});

describe('service wiring', () => {
  it('resolves a disabled service that stores nothing and searches nothing', async () => {
    const homeDir = await tempHome();
    const log = new RecordingLogger();
    const host = createScopedTestHost(appStubs(homeDir, log));

    const memory = host.app.accessor.get(IMemoryService);
    expect(memory.enabled).toBe(false);
    expect(memory.injectCanonical).toBe(false);
    expect((await memory.search({ query: 'anything' })).status).toBe('unavailable');
    expect((await memory.capture({
      content: 'should not be stored',
      tier: 'distilled',
      category: 'fact',
      sourceType: 'repository_file',
      origin: 'application',
      scope: { tier: 'global' },
    })).status).toBe('rejected');
    expect(log.entriesAt('info')).toHaveLength(0);
    host.dispose();
  });

  it('captures and retrieves through the real store when the flag is on', async () => {
    const homeDir = await tempHome();
    const log = new RecordingLogger();
    const host = createScopedTestHost(appStubs(homeDir, log, true));
    try {
      const memory = host.app.accessor.get(IMemoryService);
      expect(memory.enabled).toBe(true);

      const stored = await memory.capture({
        content: 'this repository builds the cli with tsup',
        tier: 'distilled',
        category: 'fact',
        sourceType: 'repository_file',
        origin: 'application',
        scope: { tier: 'repository', workspaceId: 'workspace-1', projectId: 'project-1' },
        evidence: [
          {
            kind: 'file',
            ref: 'package.json',
            state: 'present',
            fingerprint: 'sha-package',
            observedAt: 1,
          },
        ],
      });
      expect(stored.status).toBe('stored');
      expect(stored.record?.trust).toBe('verified');

      const found = await memory.search({ query: 'build the cli tsup', projectId: 'project-1' });
      expect(found.status).toBe('complete');
      expect(found.memories.map((memory_) => memory_.record.id)).toEqual([stored.id]);

      const diagnostics = await memory.diagnostics();
      expect(diagnostics.status).toBe('ok');
      expect(diagnostics.counts.distilled).toBe(1);
      expect(diagnostics.storeDir).toContain(homeDir);
    } finally {
      host.dispose();
    }
  });

  it('drains queued work on its own through the composed service', async () => {
    const homeDir = await tempHome();
    const log = new RecordingLogger();
    const host = createScopedTestHost(appStubs(homeDir, log, true));
    try {
      const memory = host.app.accessor.get(IMemoryService);
      const queued = await memory.capture({
        content: 'the ingestion pipeline batches writes every 500ms',
        tier: 'distilled',
        category: 'fact',
        sourceType: 'repository_file',
        origin: 'application',
        scope: { tier: 'repository', workspaceId: 'workspace-1', projectId: 'project-1' },
        evidence: [
          { kind: 'file', ref: 'docs/ingest.md', state: 'present', fingerprint: 'sha-ingest', observedAt: 1 },
        ],
        review: 'queued',
      });
      expect(queued.status).toBe('queued');

      const scheduler = (memory as { scheduler?: { whenIdle(): Promise<void> } }).scheduler;
      expect(scheduler).toBeDefined();
      await waitUntil(() => memory.pendingReviews(Date.now(), 5).then((jobs) => jobs.length === 0));

      const found = await memory.search({ query: 'ingestion batching writes', projectId: 'project-1' });
      expect(found.status).toBe('complete');
      expect(found.memories.map((entry) => entry.record.content)).toEqual([
        'the ingestion pipeline batches writes every 500ms',
      ]);
    } finally {
      host.dispose();
    }
  }, 15_000);

  it('exposes the session identity an agent needs to scope memory', async () => {
    const homeDir = await tempHome();
    const log = new RecordingLogger();
    const disposables = new DisposableStore();
    const ix = createServices(disposables, {
      strict: false,
      additionalServices: (reg) => {
        reg.defineInstance(IBootstrapService, {
          homeDir,
          cwd: homeDir,
          getEnv: () => undefined,
        } as never);
        reg.defineInstance(IConfigService, { get: () => undefined, getAll: () => ({}) } as never);
        reg.defineInstance(IFlagService, { enabled: () => false } as never);
        reg.defineInstance(ILogService, log as never);
        reg.definePartialInstance(ISessionContext, {
          sessionId: 'session-integration',
          workspaceId: 'workspace-integration',
          cwd: homeDir,
        });
      },
    });

    const session = ix.get(ISessionContext);
    expect(session.sessionId).toBe('session-integration');
    disposables.dispose();
  });
});