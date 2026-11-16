import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { claudeCodeSource } from '../../../src/import/sources/claude-code.js';

const fixture = fileURLToPath(new URL('../fixtures/claude-code/', import.meta.url));

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'migration-claude-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('claude-code adapter', () => {
  it('detects the documented layout', async () => {
    await expect(claudeCodeSource.detect(fixture)).resolves.toBe(true);
    await expect(claudeCodeSource.detect(await makeTempDir())).resolves.toBe(false);
  });

  it('reads agents, skills, settings and CLAUDE.md', async () => {
    const bundle = await claudeCodeSource.read(fixture);

    expect(bundle.source).toBe('claude-code');
    expect(bundle.root).toBe(resolve(fixture));
    expect(bundle.agents.map((agent) => agent.name)).toEqual(['reviewer', 'claude-code']);
    expect(bundle.agents[0]).toMatchObject({
      name: 'reviewer',
      description: 'Reviews changes',
      tools: ['Read', 'Grep'],
      model: 'claude-opus-4-1',
      instructions: 'Review the diff carefully.',
      sourcePath: 'agents/reviewer.md',
    });
    expect(bundle.agents[1]?.instructions).toContain('Use TypeScript');

    expect(bundle.skills).toHaveLength(1);
    expect(bundle.skills[0]).toMatchObject({
      name: 'pdf',
      description: 'Work with PDFs',
      sourcePath: 'skills/pdf/SKILL.md',
      files: ['skills/pdf/references/notes.md'],
    });

    expect(bundle.config.source).toBe('claude-code');
    expect(bundle.config.sourcePath).toBe('settings.json');
    expect(bundle.config.settings).toEqual({
      'env.FOO': 'bar',
      model: 'claude-sonnet-4-5',
      'permissions.allow': '["Read"]',
    });
  });

  it('turns malformed agent frontmatter into a warning', async () => {
    const bundle = await claudeCodeSource.read(fixture);

    expect(bundle.warnings).toContainEqual(
      expect.objectContaining({
        code: 'malformed-frontmatter',
        sourcePath: 'agents/broken.md',
      }),
    );
  });

  it('turns malformed settings JSON into a warning instead of throwing', async () => {
    const dir = await makeTempDir();
    await mkdir(join(dir, 'agents'), { recursive: true });
    await writeFile(join(dir, 'settings.json'), '{ not json');
    await writeFile(join(dir, 'CLAUDE.md'), 'Instructions.\n');

    const bundle = await claudeCodeSource.read(dir);

    expect(bundle.config.settings).toEqual({});
    expect(bundle.warnings).toContainEqual(
      expect.objectContaining({ code: 'malformed-json', sourcePath: 'settings.json' }),
    );
    expect(bundle.agents.map((agent) => agent.name)).toEqual(['claude-code']);
  });
});
