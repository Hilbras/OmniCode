import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { qwenSource } from '../../../src/import/sources/qwen.js';

const fixture = fileURLToPath(new URL('../fixtures/qwen/', import.meta.url));

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'migration-qwen-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('qwen adapter', () => {
  it('detects the documented layout', async () => {
    await expect(qwenSource.detect(fixture)).resolves.toBe(true);
    await expect(qwenSource.detect(await makeTempDir())).resolves.toBe(false);
  });

  it('reads settings, QWEN.md, commands and skills', async () => {
    const bundle = await qwenSource.read(fixture);

    expect(bundle.source).toBe('qwen');
    expect(bundle.root).toBe(resolve(fixture));
    expect(bundle.agents.map((agent) => agent.name)).toEqual(['qwen']);
    expect(bundle.skills.map((skill) => skill.name)).toEqual(['legacy', 'review', 'tdd']);
    expect(bundle.skills[0]).toMatchObject({
      name: 'legacy',
      description: 'Legacy markdown command',
      body: 'Run the legacy workflow.\n',
      sourcePath: 'commands/legacy.md',
    });
    expect(bundle.skills[1]).toMatchObject({
      name: 'review',
      description: 'Review code',
      body: 'Review the diff and list real defects.',
      sourcePath: 'commands/review.toml',
    });

    expect(bundle.config.sourcePath).toBe('settings.json');
    expect(bundle.config.settings).toEqual({
      model: 'qwen3-coder-plus',
      theme: 'dark',
    });
    expect(bundle.config.mcpServers).toEqual({
      local: { command: 'node', args: ['server.js'], sourcePath: 'settings.json' },
    });
  });

  it('turns malformed settings and commands into warnings instead of throwing', async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, 'commands'), { recursive: true });
    await writeFile(join(dir, 'settings.json'), '{ nope');
    await writeFile(join(dir, 'commands', 'broken.toml'), 'prompt = [\n');
    await writeFile(join(dir, 'QWEN.md'), 'Instructions.\n');

    const bundle = await qwenSource.read(dir);

    expect(bundle.config.settings).toEqual({});
    expect(bundle.agents.map((agent) => agent.name)).toEqual(['qwen']);
    expect(bundle.skills).toEqual([]);
    expect(bundle.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'malformed-json', sourcePath: 'settings.json' }),
        expect.objectContaining({ code: 'malformed-toml', sourcePath: 'commands/broken.toml' }),
      ]),
    );
  });
});
