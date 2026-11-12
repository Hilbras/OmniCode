import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveMcpCommand } from '#/mcpCore/command-policy';

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omnicode-mcp-command-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('MCP command policy', () => {
  it('resolves a trusted PATH executable to an absolute path', async () => {
    const resolved = await resolveMcpCommand('node', {
      cwd: process.cwd(),
      env: { PATH: process.env['PATH'] },
      workspaceRoot: '/tmp/not-the-workspace',
    });
    expect(resolved.startsWith('/')).toBe(true);
  });

  it('rejects PATH entries inside the workspace', async () => {
    const workspace = await tempDir();
    const bin = join(workspace, 'bin');
    await mkdir(bin);
    const tool = join(bin, 'workspace-tool');
    await writeFile(tool, '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(tool, 0o755);

    await expect(
      resolveMcpCommand('workspace-tool', {
        cwd: workspace,
        env: { PATH: bin },
        workspaceRoot: workspace,
      }),
    ).rejects.toThrow('trusted PATH');
  });

  it('rejects a workspace-relative command unless explicitly allowed', async () => {
    const workspace = await tempDir();
    const bin = join(workspace, 'bin');
    await mkdir(bin);
    const tool = join(bin, 'workspace-tool');
    await writeFile(tool, '#!/bin/sh\nexit 0\n', 'utf8');
    await chmod(tool, 0o755);

    await expect(
      resolveMcpCommand('./bin/workspace-tool', {
        cwd: workspace,
        env: {},
        workspaceRoot: workspace,
      }),
    ).rejects.toThrow('inside the workspace');

    await expect(
      resolveMcpCommand('./bin/workspace-tool', {
        cwd: workspace,
        env: {},
        workspaceRoot: workspace,
        allowWorkspaceCommand: true,
      }),
    ).resolves.toBe(tool);
  });

  it('rejects empty commands', async () => {
    await expect(resolveMcpCommand('   ', { cwd: process.cwd(), env: {} })).rejects.toThrow('non-empty');
  });
});
