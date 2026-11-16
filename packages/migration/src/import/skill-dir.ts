import { join, relative, sep } from 'node:path';

import { isFile, listDirectory, readTextFile } from './files.js';
import { parseFrontmatter, readAttribute } from './frontmatter.js';
import type { ImportedSkill, ImportWarning } from './schema.js';

function toSourcePath(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join('/');
}

async function collectSkillFiles(
  root: string,
  skillDir: string,
  warnings: ImportWarning[],
): Promise<string[]> {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await listDirectory(dir)) {
      const fullPath = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        warnings.push({
          code: 'unrecognized-entry',
          message: `skipped symbolic link ${toSourcePath(root, fullPath)}`,
          sourcePath: toSourcePath(root, fullPath),
        });
        continue;
      }
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile() || fullPath === join(skillDir, 'SKILL.md')) continue;
      files.push(toSourcePath(root, fullPath));
    }
  };
  await walk(skillDir);
  return files.sort();
}

export async function readSkillDirectories(
  root: string,
  skillsDir: string,
  warnings: ImportWarning[],
): Promise<ImportedSkill[]> {
  const skills: ImportedSkill[] = [];

  for (const entry of await listDirectory(skillsDir)) {
    if (entry.isSymbolicLink()) continue;
    const skillDir = join(skillsDir, entry.name);
    if (!entry.isDirectory()) {
      warnings.push({
        code: 'unrecognized-entry',
        message: `ignored non-directory skills entry ${toSourcePath(root, skillDir)}`,
        sourcePath: toSourcePath(root, skillDir),
      });
      continue;
    }

    const skillFile = join(skillDir, 'SKILL.md');
    if (!(await isFile(skillFile))) {
      warnings.push({
        code: 'unrecognized-entry',
        message: `skills directory without SKILL.md: ${toSourcePath(root, skillDir)}`,
        sourcePath: toSourcePath(root, skillDir),
      });
      continue;
    }

    let text: string;
    try {
      text = await readTextFile(skillFile);
    } catch {
      warnings.push({
        code: 'unreadable-file',
        message: `could not read ${toSourcePath(root, skillFile)}`,
        sourcePath: toSourcePath(root, skillFile),
      });
      continue;
    }

    const parsed = parseFrontmatter(text);
    if (!parsed.ok) {
      warnings.push({
        code: 'malformed-frontmatter',
        message: `${toSourcePath(root, skillFile)}: ${parsed.reason}`,
        sourcePath: toSourcePath(root, skillFile),
      });
      continue;
    }

    const name = readAttribute(parsed.attributes, 'name') ?? entry.name;
    if (name.trim() === '') {
      warnings.push({
        code: 'missing-name',
        message: `skill has no usable name: ${toSourcePath(root, skillFile)}`,
        sourcePath: toSourcePath(root, skillFile),
      });
      continue;
    }

    const skill: ImportedSkill = {
      name,
      body: parsed.body,
      sourcePath: toSourcePath(root, skillFile),
    };
    const description = readAttribute(parsed.attributes, 'description');
    if (description !== undefined) skill.description = description;
    const files = await collectSkillFiles(root, skillDir, warnings);
    if (files.length > 0) skill.files = files;

    skills.push(skill);
  }

  return skills;
}
