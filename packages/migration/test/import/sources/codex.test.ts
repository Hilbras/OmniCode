import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { codexSource } from '../../../src/import/sources/codex.js';

const fixture = fileURLToPath(new URL('../fixtures/codex/', import.meta.url));

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'migration-codex-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('codex adapter', () => {
  it('detects the documented layout', async () => {
    await expect(codexSource.detect(fixture)).resolves.toBe(true);
    await expect(codexSource.detect(await makeTempDir())).resolves.toBe(false);
  });

  it('reads config.toml, AGENTS.md, prompts and skills', async () => {
    const bundle = await codexSource.read(fixture);

    expect(bundle.source).toBe('codex');
    expect(bundle.root).toBe(resolve(fixture));
    expect(bundle.agents.map((agent) => agent.name)).toEqual(['codex', 'refactor']);
    expect(bundle.agents[1]).toMatchObject({
      name: 'refactor',
      description: 'Refactor a module without changing behavior',
      instructions: 'Refactor {{file}} and run the tests.',
      sourcePath: 'prompts/refactor.md',
    });
    expect(bundle.skills.map((skill) => skill.name)).toEqual(['explain']);

    expect(bundle.config.sourcePath).toBe('config.toml');
    expect(bundle.config.settings).toEqual({
      approval_policy: 'on-request',
      model: 'gpt-5-codex',
      sandbox_mode: 'workspace-write',
    });
    expect(bundle.config.mcpServers).toEqual({
      docs: {
        command: 'npx',
        args: ['-y', 'docs-server'],
        env: { DOCS: '1' },
        sourcePath: 'config.toml',
      },
      remote: { url: 'https://mcp.example.com', sourcePath: 'config.toml' },
    });
  });

  it('turns malformed TOML into a warning instead of throwing', async () => {
    const dir = await makeTempDir();
    await writeFile(join(dir, 'config.toml'), 'model = [\n');
    await writeFile(join(dir, 'AGENTS.md'), 'Follow the rules.\n');

    const bundle = await codexSource.read(dir);

    expect(bundle.config.settings).toEqual({});
    expect(bundle.warnings).toContainEqual(
      expect.objectContaining({ code: 'malformed-toml', sourcePath: 'config.toml' }),
    );
    expect(bundle.agents.map((agent) => agent.name)).toEqual(['codex']);
  });
});
