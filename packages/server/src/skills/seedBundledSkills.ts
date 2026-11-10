import { promises as fs } from 'node:fs';
import path from 'pathe';

const SKILL_FILE = 'SKILL.md';

export interface SeedBundledSkillsOptions {
  readonly sourceDir: string | undefined;
  readonly userSkillsDir: string;
  readonly log?: (message: string, payload?: Record<string, unknown>) => void;
}

export interface SeedBundledSkillsResult {
  readonly copied: number;
  readonly skipped: number;
}

export async function seedBundledSkills(
  options: SeedBundledSkillsOptions,
): Promise<SeedBundledSkillsResult> {
  const { sourceDir, userSkillsDir, log } = options;
  if (sourceDir === undefined) return { copied: 0, skipped: 0 };
  if (!(await isDirectory(sourceDir))) return { copied: 0, skipped: 0 };
  let copied = 0;
  let skipped = 0;
  for (const entry of await safeReadDir(sourceDir)) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(sourceDir, entry.name);
    const skillFile = path.join(skillDir, SKILL_FILE);
    if (!(await isFile(skillFile))) continue;
    const target = path.join(userSkillsDir, entry.name);
    if (await exists(target)) {
      skipped += 1;
      continue;
    }
    try {
      await fs.cp(skillDir, target, { recursive: true });
      copied += 1;
    } catch (error) {
      log?.('failed to install bundled skill', { name: entry.name, error: String(error) });
      skipped += 1;
    }
  }
  if (copied > 0) log?.('installed bundled skills', { copied, skipped });
  return { copied, skipped };
}

async function safeReadDir(dir: string): Promise<import('node:fs').Dirent[]> {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isFile();
  } catch {
    return false;
  }
}

