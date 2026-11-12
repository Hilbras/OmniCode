import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import type { ShellPathBridge } from '@hilbras/omnicode-base/execEnv/shellPathBridge';
import {
  DEFAULT_WORKSPACE_ACCESS_POLICY,
  PathSecurityError,
  extendWorkspaceWithSkillRoots,
  isSensitiveFile,
  resolvePathAccess,
  resolvePathAccessPath,
} from '#/tool/path-access';

const symlinkTestDirs: string[] = [];

async function symlinkTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-path-symlink-'));
  symlinkTestDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(symlinkTestDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const POSIX_ENV = {
  pathClass: 'posix' as const,
  homeDir: '/home/test',
  osKind: 'Linux',
  shellName: 'bash' as const,
  shellPath: '/bin/bash',
};

describe('isSensitiveFile', () => {
  it('flags base .env files in any directory', () => {
    for (const path of ['.env', '/app/.env', 'project/.env']) {
      expect(isSensitiveFile(path), path).toBe(true);
    }
  });

  it('flags .env.<environment> variants', () => {
    for (const path of ['.env.local', '.env.production', '/app/.env.staging']) {
      expect(isSensitiveFile(path), path).toBe(true);
    }
  });

  it('flags cloud credential file locations', () => {
    for (const path of [
      '/home/user/.aws/credentials',
      '/home/user/.gcp/credentials',
      '.aws/credentials',
      '.gcp/credentials',
      'credentials',
    ]) {
      expect(isSensitiveFile(path), path).toBe(true);
    }
  });

  it('flags package, cloud, kube, docker, gh, and netrc credentials', () => {
    for (const path of [
      '.npmrc',
      '.pypirc',
      '.netrc',
      '.git-credentials',
      'kubeconfig',
      '.kube/config',
      '.docker/config.json',
      '.config/gcloud/application_default_credentials.json',
      '.azure/accessTokens.json',
      '.azure/msal_token_cache.json',
      '.config/gh/hosts.yml',
      '.ssh/config',
      'service-account.json',
    ]) {
      expect(isSensitiveFile(path), path).toBe(true);
    }
  });

  it('matches sensitive patterns case-insensitively on posix paths', () => {
    for (const path of [
      '.ENV',
      '/app/.Env.Local',
      '/home/user/.AWS/Credentials',
      '/home/user/.GCP/CREDENTIALS',
      '/home/user/.ssh/ID_RSA',
      '/home/user/.ssh/ID_ED25519.OLD',
    ]) {
      expect(isSensitiveFile(path), path).toBe(true);
    }
  });

  it('does not flag normal source / config files or env exemplars', () => {
    for (const path of [
      'app.py',
      'config.yml',
      'README.md',
      'package.json',
      'server.key.example',
      'id_rsa.pub',
      'credentials.json',
      '.envrc',
      'environment.py',
      '.env_example',
      '.env.example',
      '.ENV.EXAMPLE',
      '.env.sample',
      '.ENV.SAMPLE',
      '.env.template',
      '.ENV.TEMPLATE',
      '/app/.env.example',
      '/app/.ENV.EXAMPLE',
    ]) {
      expect(isSensitiveFile(path), path).toBe(false);
    }
  });
});

describe('extendWorkspaceWithSkillRoots', () => {
  const workspace = { workspaceDir: '/repo', additionalDirs: ['/extra'] };

  it('returns the workspace unchanged when there are no skill roots', () => {
    expect(extendWorkspaceWithSkillRoots(workspace, [])).toBe(workspace);
  });

  it('appends roots outside the workspace and existing additional dirs', () => {
    expect(extendWorkspaceWithSkillRoots(workspace, ['/home/user/.omnicode/skills'])).toEqual({
      workspaceDir: '/repo',
      additionalDirs: ['/extra', '/home/user/.omnicode/skills'],
    });
  });

  it('skips roots already inside the workspace dir or an additional dir', () => {
    expect(
      extendWorkspaceWithSkillRoots(workspace, ['/repo/.agents/skills', '/extra/skills']),
    ).toBe(workspace);
  });

  it('dedupes roots that repeat or nest inside a just-added root', () => {
    expect(
      extendWorkspaceWithSkillRoots(workspace, ['/skills', '/skills', '/skills/sub']),
    ).toEqual({ workspaceDir: '/repo', additionalDirs: ['/extra', '/skills'] });
  });

  it('compares case-insensitively on win32 path class', () => {
    expect(
      extendWorkspaceWithSkillRoots(
        { workspaceDir: 'C:/repo', additionalDirs: [] },
        ['c:/Repo/skills'],
        'win32',
      ).additionalDirs,
    ).toEqual([]);
  });
});

describe('resolvePathAccess shell path bridge', () => {
  const WIN_ENV = {
    pathClass: 'win32' as const,
    homeDir: 'C:\\Users\\test',
    osKind: 'Windows',
    shellName: 'bash' as const,
    shellPath: 'C:\\omnicode-test-nonexistent\\Git\\bin\\bash.exe',
  };

  it('routes win32 file-tool paths through the shell path bridge', () => {
    const result = resolvePathAccessPath('/c/workspace/file.txt', {
      env: WIN_ENV,
      workspace: { workspaceDir: 'C:\\workspace', additionalDirs: [] },
      operation: 'read',
    });
    expect(result).toBe('C:/workspace/file.txt');
  });

  it('passes root-relative POSIX paths through when cygpath is unavailable', () => {
    const result = resolvePathAccessPath('/tmp/scratch.txt', {
      env: WIN_ENV,
      workspace: { workspaceDir: 'C:\\workspace', additionalDirs: [] },
      operation: 'read',
    });
    expect(result).toBe('/tmp/scratch.txt');
  });

  it('normalizes through an explicitly injected shell path bridge', () => {
    const bridge: ShellPathBridge = {
      toShellPath: (p) => p,
      fromShellPath: (p) => (p.startsWith('/tmp/') ? `C:/Temp/${p.slice('/tmp/'.length)}` : p),
    };
    const result = resolvePathAccess(
      '/tmp/notes.txt',
      'C:\\workspace',
      { workspaceDir: 'C:\\workspace', additionalDirs: [] },
      {
        operation: 'read',
        pathClass: 'win32',
        policy: DEFAULT_WORKSPACE_ACCESS_POLICY,
        shellPathBridge: bridge,
      },
    );
    expect(result).toEqual({ path: 'C:/Temp/notes.txt', outsideWorkspace: true });
  });

describe.skipIf(process.platform === 'win32')('symlink-safe path guards', () => {
  it('rejects a workspace symlink that points outside the workspace', async () => {
    const workspace = await symlinkTempDir();
    const outside = await symlinkTempDir();
    const target = join(outside, 'secret.txt');
    await writeFile(target, 'secret', 'utf8');
    const link = join(workspace, 'notes.txt');
    await symlink(target, link);

    expect(() =>
      resolvePathAccessPath(link, {
        env: POSIX_ENV,
        workspace: { workspaceDir: workspace, additionalDirs: [] },
        operation: 'write',
      }),
    ).toThrow(expect.objectContaining({ code: 'PATH_OUTSIDE_WORKSPACE' }));
  });

  it('rejects a symlink to a sensitive file even inside the workspace', async () => {
    const workspace = await symlinkTempDir();
    const target = join(workspace, '.npmrc');
    await writeFile(target, 'token=secret', 'utf8');
    const link = join(workspace, 'notes.txt');
    await symlink(target, link);

    expect(() =>
      resolvePathAccessPath(link, {
        env: POSIX_ENV,
        workspace: { workspaceDir: workspace, additionalDirs: [] },
        operation: 'read',
      }),
    ).toThrow(expect.objectContaining({ code: 'PATH_SENSITIVE' }));
  });

  it('rejects a nonexistent child under a symlinked outside directory', async () => {
    const workspace = await symlinkTempDir();
    const outside = await symlinkTempDir();
    const linkDir = join(workspace, 'linked');
    await symlink(outside, linkDir);

    expect(() =>
      resolvePathAccessPath(join(linkDir, 'new.txt'), {
        env: POSIX_ENV,
        workspace: { workspaceDir: workspace, additionalDirs: [] },
        operation: 'write',
      }),
    ).toThrow(expect.objectContaining({ code: 'PATH_OUTSIDE_WORKSPACE' }));
  });

  it('returns the physical path for a symlink that remains inside the workspace', async () => {
    const workspace = await symlinkTempDir();
    const target = join(workspace, 'real.txt');
    await writeFile(target, 'ok', 'utf8');
    const link = join(workspace, 'alias.txt');
    await symlink(target, link);

    const result = resolvePathAccessPath(link, {
      env: POSIX_ENV,
      workspace: { workspaceDir: workspace, additionalDirs: [] },
      operation: 'read',
    });
    expect(result).toBe(target);
  });

  it('supports an intentionally symlinked workspace root', async () => {
    const realWorkspace = await symlinkTempDir();
    const parent = await symlinkTempDir();
    const linkedWorkspace = join(parent, 'workspace');
    await symlink(realWorkspace, linkedWorkspace);
    const file = join(realWorkspace, 'file.txt');
    await writeFile(file, 'ok', 'utf8');

    const result = resolvePathAccessPath(join(linkedWorkspace, 'file.txt'), {
      env: POSIX_ENV,
      workspace: { workspaceDir: linkedWorkspace, additionalDirs: [] },
      operation: 'read',
    });
    expect(result).toBe(file);
  });
});
});
