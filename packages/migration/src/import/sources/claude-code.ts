import { basename, join, resolve } from 'node:path';

import { readAgentFile } from '../agent-file.js';
import { dedupeByName } from '../dedupe.js';
import {
  isDirectory,
  isFile,
  listDirectory,
  readJsonFile,
  toSourcePath,
} from '../files.js';
import { normalizeSettings } from '../normalize.js';
import { ImportBundleSchema, type ImportBundle, type ImportWarning } from '../schema.js';
import { readSkillDirectories } from '../skill-dir.js';
import type { ImportSourceAdapter } from '../source.js';

function listMarkdownFiles(dir: string): Promise<string[]> {
  return listDirectory(dir).then((entries) =>
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => join(dir, entry.name)),
  );
}

async function detect(root: string): Promise<boolean> {
  return (
    (await isDirectory(join(root, 'agents'))) ||
    (await isDirectory(join(root, 'skills'))) ||
    (await isFile(join(root, 'settings.json'))) ||
    (await isFile(join(root, 'CLAUDE.md')))
  );
}

async function read(root: string): Promise<ImportBundle> {
  const warnings: ImportWarning[] = [];
  const bundleRoot = resolve(root);

  const settingsFile = join(root, 'settings.json');
  const settings: Record<string, string | number | boolean | null> = {};
  let configSourcePath = '.';
  if (await isFile(settingsFile)) {
    configSourcePath = toSourcePath(root, settingsFile);
    const json = await readJsonFile(settingsFile);
    if (!json.ok) {
      warnings.push({ code: json.reason, message: json.message, sourcePath: configSourcePath });
    } else if (typeof json.value === 'object' && json.value !== null && !Array.isArray(json.value)) {
      Object.assign(settings, normalizeSettings(json.value));
    } else {
      warnings.push({
        code: 'invalid-entry',
        message: `${configSourcePath} is not a JSON object`,
        sourcePath: configSourcePath,
      });
    }
  }

  const agents = [];
  const agentsDir = join(root, 'agents');
  for (const filePath of await listMarkdownFiles(agentsDir)) {
    const name = basename(filePath).replace(/\.md$/i, '');
    const agent = await readAgentFile({ root, filePath, fallbackName: name, warnings });
    if (agent !== undefined) agents.push(agent);
  }
  for (const entry of await listDirectory(agentsDir)) {
    if (entry.isFile() && !entry.name.toLowerCase().endsWith('.md')) {
      warnings.push({
        code: 'unrecognized-entry',
        message: `ignored non-markdown agent file ${toSourcePath(root, join(agentsDir, entry.name))}`,
        sourcePath: toSourcePath(root, join(agentsDir, entry.name)),
      });
    }
  }

  const claudeMd = join(root, 'CLAUDE.md');
  if (await isFile(claudeMd)) {
    if (configSourcePath === '.') configSourcePath = toSourcePath(root, claudeMd);
    const agent = await readAgentFile({ root, filePath: claudeMd, fallbackName: 'claude-code', warnings });
    if (agent !== undefined) agents.push(agent);
  }

  const skills = await readSkillDirectories(root, join(root, 'skills'), warnings);

  return ImportBundleSchema.parse({
    source: 'claude-code',
    root: bundleRoot,
    agents: dedupeByName(agents, warnings),
    skills: dedupeByName(skills, warnings),
    config: {
      source: 'claude-code',
      settings,
      sourcePath: configSourcePath,
    },
    warnings,
  });
}

export const claudeCodeSource: ImportSourceAdapter = {
  source: 'claude-code',
  detect,
  read,
};
