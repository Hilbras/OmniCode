import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { seedBundledSkills } from '../src/skills/seedBundledSkills';

const cleanup: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  cleanup.push(dir);
  return dir;
}

async function writeSkill(root: string, name: string, body: string): Promise<void> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} skill\n---\n\n${body}\n`,
    'utf8',
  );
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('seedBundledSkills', () => {
  it('installs missing bundled skills into the user directory', async () => {
    const source = await tempDir('skills-src-');
    const user = await tempDir('skills-user-');
    await writeSkill(source, 'alpha', 'alpha body');
    await writeSkill(source, 'beta', 'beta body');
    await mkdir(join(source, 'not-a-skill'), { recursive: true });

    const result = await seedBundledSkills({ sourceDir: source, userSkillsDir: user });

    expect(result).toEqual({ copied: 2, skipped: 0 });
    expect(await readFile(join(user, 'alpha', 'SKILL.md'), 'utf8')).toContain('alpha body');
    expect(await readFile(join(user, 'beta', 'SKILL.md'), 'utf8')).toContain('beta body');
  });

  it('keeps user edits and never overwrites an existing skill', async () => {
    const source = await tempDir('skills-src-');
    const user = await tempDir('skills-user-');
    await writeSkill(source, 'alpha', 'bundled version');
    await writeSkill(user, 'alpha', 'user edited version');

    const result = await seedBundledSkills({ sourceDir: source, userSkillsDir: user });

    expect(result).toEqual({ copied: 0, skipped: 1 });
    expect(await readFile(join(user, 'alpha', 'SKILL.md'), 'utf8')).toContain('user edited version');
  });

  it('copies nested files such as scripts and references', async () => {
    const source = await tempDir('skills-src-');
    const user = await tempDir('skills-user-');
    await writeSkill(source, 'alpha', 'see scripts/run.sh');
    await mkdir(join(source, 'alpha', 'scripts'), { recursive: true });
    await writeFile(join(source, 'alpha', 'scripts', 'run.sh'), '#!/bin/sh\necho hi\n', 'utf8');

    await seedBundledSkills({ sourceDir: source, userSkillsDir: user });

    expect(await readFile(join(user, 'alpha', 'scripts', 'run.sh'), 'utf8')).toContain('echo hi');
  });

  it('is a no-op without a source directory', async () => {
    const user = await tempDir('skills-user-');
    const result = await seedBundledSkills({ sourceDir: undefined, userSkillsDir: user });
    expect(result).toEqual({ copied: 0, skipped: 0 });
  });
});
