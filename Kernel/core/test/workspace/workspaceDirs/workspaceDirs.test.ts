import { mkdtempSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DisposableStore } from '#/_base/di/lifecycle';
import { createServices } from '#/_base/di/test';
import { Emitter } from '#/_base/event';
import { ILogService } from '#/_base/log/log';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IProjectLocalConfigService } from '#/app/projectLocalConfig/projectLocalConfig';
import { HostFileSystem } from '#/os/backends/node-local/hostFsService';
import { IHostFileSystem } from '#/os/interface/hostFileSystem';
import { FileProjectLocalConfigService } from '#/persistence/backends/node-fs/projectLocalConfigService';
import { IWorkspaceContext } from '#/workspace/workspaceContext/workspaceContext';
import { IWorkspaceDirs } from '#/workspace/workspaceDirs/workspaceDirs';
import { WorkspaceDirsService } from '#/workspace/workspaceDirs/workspaceDirsService';
import {
  IWorkspaceTrust,
  type WorkspaceTrustChange,
} from '#/workspace/workspaceTrust/workspaceTrust';
import type { WatchChange } from '#human/utils/watch';

import { stubLog } from '../../_base/log/stubs';
import { stubBootstrap } from '../../app/bootstrap/stubs';
import { registerStateServices } from '../../state/stubs';

const watchFires = new Map<string, Emitter<WatchChange>>();

vi.mock('#human/utils/watch', () => {
  const watch = (path: string) => {
    let emitter = watchFires.get(path);
    if (emitter === undefined) {
      emitter = new Emitter<WatchChange>();
      watchFires.set(path, emitter);
    }
    return { ready: Promise.resolve(), onDidChange: emitter.event, dispose: () => {} };
  };
  return {
    watch,
    watchCandidates: (root: string) => watch(root),
  };
});

describe('WorkspaceDirsService', () => {
  let cwd: string;
  let homeDir: string;
  let outside: string;
  let other: string;
  let disposables: DisposableStore;
  let trusted: boolean;
  let trustFlips: Emitter<WorkspaceTrustChange>;
  let warnings: string[];

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'omnicode-workspace-dirs-cwd-'));
    homeDir = mkdtempSync(join(tmpdir(), 'omnicode-workspace-dirs-home-'));
    outside = mkdtempSync(join(tmpdir(), 'omnicode-workspace-dirs-outside-'));
    other = mkdtempSync(join(tmpdir(), 'omnicode-workspace-dirs-other-'));
    disposables = new DisposableStore();
    watchFires.clear();
    trusted = false;
    trustFlips = disposables.add(new Emitter<WorkspaceTrustChange>());
    warnings = [];
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    disposables.dispose();
    await Promise.all(
      [cwd, homeDir, outside, other].map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  function createService(): IWorkspaceDirs {
    const log = stubLog();
    const capturing: ILogService = {
      ...log,
      warn: (message: string) => {
        warnings.push(message);
      },
    };
    const ix = createServices(disposables, {
      strict: true,
      additionalServices: (reg) => {
        registerStateServices(reg);
        reg.defineInstance(IBootstrapService, stubBootstrap(homeDir));
        reg.defineInstance(ILogService, capturing);
        reg.defineInstance(IHostFileSystem, new HostFileSystem());
        reg.definePartialInstance(IWorkspaceContext, { cwd });
        reg.definePartialInstance(IWorkspaceTrust, {
          ready: Promise.resolve(),
          isTrusted: () => trusted,
          onDidChange: trustFlips.event,
        });
        reg.define(IProjectLocalConfigService, FileProjectLocalConfigService);
        reg.define(IWorkspaceDirs, WorkspaceDirsService);
      },
    });
    return ix.get(IWorkspaceDirs);
  }

  async function writeProjectDirs(dirs: readonly string[]): Promise<string> {
    const dir = join(cwd, '.omnicode');
    await mkdir(dir, { recursive: true });
    const file = join(dir, 'local.toml');
    await writeFile(file, `[workspace]\nadditional_dir = [${dirs.map(quote).join(', ')}]\n`, 'utf8');
    return file;
  }

  it('activates a declared directory once the workspace is trusted', async () => {
    await writeProjectDirs([outside]);
    trusted = true;

    const service = createService();
    await service.ready;

    expect(service.additionalDirs).toEqual([outside]);
  });

  it('ignores a declared directory while the workspace is untrusted, and reports it', async () => {
    const configPath = await writeProjectDirs([outside]);

    const service = createService();
    await service.ready;

    expect(service.additionalDirs).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(configPath);
    expect(warnings[0]).toContain('not trusted');
  });

  it('activates the declared directories when the workspace becomes trusted', async () => {
    await writeProjectDirs([outside, other]);

    const service = createService();
    await service.ready;
    expect(service.additionalDirs).toEqual([]);

    trusted = true;
    trustFlips.fire({ trusted: true });

    await vi.waitFor(() => {
      expect(service.additionalDirs).toEqual([outside, other]);
    });
  });

  it('drops the declared directories again when trust is withdrawn', async () => {
    await writeProjectDirs([outside]);
    trusted = true;

    const service = createService();
    await service.ready;
    expect(service.additionalDirs).toEqual([outside]);

    trusted = false;
    trustFlips.fire({ trusted: false });

    await vi.waitFor(() => {
      expect(service.additionalDirs).toEqual([]);
    });
  });

  it('keeps an explicitly added directory for the session but not the untrusted file entries', async () => {
    const configPath = await writeProjectDirs([outside]);

    const service = createService();
    await service.ready;

    const result = await service.addDir({ path: other, persist: true });

    expect(result.persisted).toBe(true);
    expect(result.additionalDirs).toEqual([other]);
    expect(service.additionalDirs).toEqual([other]);
    expect(warnings.at(-1)).toContain(configPath);
  });

  it('applies the remembered directory from the file once trust is granted', async () => {
    await writeProjectDirs([other]);

    const service = createService();
    await service.ready;
    expect(service.additionalDirs).toEqual([]);

    trusted = true;
    trustFlips.fire({ trusted: true });

    await vi.waitFor(() => {
      expect(service.additionalDirs).toEqual([other]);
    });
  });
});

function quote(value: string): string {
  return JSON.stringify(value);
}
