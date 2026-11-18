import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { installBundledSkills } from '../../src/main';

const SKILLS_DIR = join(import.meta.dirname, '..', '..', 'skills');

describe('bundled product skills', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('ships at least 48 skills, each with a SKILL.md', () => {
    const directories = readdirSync(SKILLS_DIR, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    );
    expect(directories.length).toBeGreaterThanOrEqual(48);
    for (const entry of directories) {
      expect(existsSync(join(SKILLS_DIR, entry.name, 'SKILL.md'))).toBe(true);
    }
  });

  it('points OMNICODE_BUNDLED_SKILLS_DIR at the directory when unset', () => {
    vi.stubEnv('OMNICODE_BUNDLED_SKILLS_DIR', '');
    const moduleUrl = new URL('../../src/main.ts', import.meta.url).href;
    expect(installBundledSkills(moduleUrl)).toBe(SKILLS_DIR);
    expect(process.env['OMNICODE_BUNDLED_SKILLS_DIR']).toBe(SKILLS_DIR);
  });

  it('leaves an explicit directory alone', () => {
    vi.stubEnv('OMNICODE_BUNDLED_SKILLS_DIR', '/custom/skills');
    expect(installBundledSkills()).toBe('/custom/skills');
  });
});
