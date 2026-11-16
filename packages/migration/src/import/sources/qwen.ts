import { basename, join, resolve } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { readAgentFile } from '../agent-file.js';
import { dedupeByName } from '../dedupe.js';
import {
  isDirectory,
  isFile,
  listDirectory,
  readJsonFile,
  readTextFile,
  toSourcePath,
} from '../files.js';
import { parseFrontmatter, readAttribute } from '../frontmatter.js';
import { normalizeMcpServers, normalizeSettings } from '../normalize.js';
import {
  ImportBundleSchema,
  type ImportBundle,
  type ImportedMcpServer,
  type ImportedSettings,
  type ImportedSkill,
  type ImportWarning,
} from '../schema.js';
import { readSkillDirectories } from '../skill-dir.js';
import type { ImportSourceAdapter } from '../source.js';

async function detect(root: string): Promise<boolean> {
  return (
    (await isFile(join(root, 'settings.json'))) ||
    (await isFile(join(root, 'QWEN.md'))) ||
    (await isDirectory(join(root, 'commands'))) ||
    (await isDirectory(join(root, 'skills')))
  );
}

interface QwenConfig {
  readonly settings: ImportedSettings;
  readonly mcpServers: Record<string, ImportedMcpServer> | undefined;
}

async function readConfig(root: string, warnings: ImportWarning[]): Promise<QwenConfig> {
  const settingsFile = join(root, 'settings.json');
  if (!(await isFile(settingsFile))) return { settings: {}, mcpServers: undefined };

  const sourcePath = toSourcePath(root, settingsFile);
  const json = await readJsonFile(settingsFile);
  if (!json.ok) {
    warnings.push({ code: json.reason, message: json.message, sourcePath });
    return { settings: {}, mcpServers: undefined };
  }
  if (typeof json.value !== 'object' || json.value === null || Array.isArray(json.value)) {
    warnings.push({ code: 'invalid-entry', message: `${sourcePath} is not a JSON object`, sourcePath });
    return { settings: {}, mcpServers: undefined };
  }

  const table = json.value as Record<string, unknown>;
  const normalized = normalizeMcpServers(table['mcpServers'] ?? table['mcp_servers'], sourcePath);
  for (const name of normalized.skipped) {
    warnings.push({
      code: 'invalid-entry',
      message: `ignored malformed MCP server ${name} in ${sourcePath}`,
      sourcePath,
    });
  }

  return {
    settings: normalizeSettings(table),
    mcpServers: Object.keys(normalized.servers).length > 0 ? normalized.servers : undefined,
  };
}

async function readTomlCommand(
  root: string,
  filePath: string,
  warnings: ImportWarning[],
): Promise<ImportedSkill | undefined> {
  const sourcePath = toSourcePath(root, filePath);
  let parsed: unknown;
  try {
    parsed = parseToml(await readTextFile(filePath));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warnings.push({ code: 'malformed-toml', message: `${sourcePath}: ${detail}`, sourcePath });
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    warnings.push({ code: 'invalid-entry', message: `${sourcePath} is not a TOML table`, sourcePath });
    return undefined;
  }

  const table = parsed as Record<string, unknown>;
  const prompt = table['prompt'];
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    warnings.push({
      code: 'invalid-entry',
      message: `${sourcePath} has no prompt`,
      sourcePath,
    });
    return undefined;
  }

  const rawName = typeof table['name'] === 'string' ? table['name'] : basename(filePath).replace(/\.toml$/i, '');
  if (rawName.trim() === '') {
    warnings.push({ code: 'missing-name', message: `command has no usable name: ${sourcePath}`, sourcePath });
    return undefined;
  }

  const skill: ImportedSkill = { name: rawName, body: prompt, sourcePath };
  const description = table['description'];
  if (typeof description === 'string' && description !== '') skill.description = description;
  return skill;
}

async function readMarkdownCommand(
  root: string,
  filePath: string,
  warnings: ImportWarning[],
): Promise<ImportedSkill | undefined> {
  const sourcePath = toSourcePath(root, filePath);
  let text: string;
  try {
    text = await readTextFile(filePath);
  } catch {
    warnings.push({ code: 'unreadable-file', message: `could not read ${sourcePath}`, sourcePath });
    return undefined;
  }

  const parsed = parseFrontmatter(text);
  if (!parsed.ok) {
    warnings.push({
      code: 'malformed-frontmatter',
      message: `${sourcePath}: ${parsed.reason}`,
      sourcePath,
    });
    return undefined;
  }

  const name = readAttribute(parsed.attributes, 'name') ?? basename(filePath).replace(/\.md$/i, '');
  if (name.trim() === '') {
    warnings.push({ code: 'missing-name', message: `command has no usable name: ${sourcePath}`, sourcePath });
    return undefined;
  }

  const skill: ImportedSkill = { name, body: parsed.body, sourcePath };
  const description = readAttribute(parsed.attributes, 'description');
  if (description !== undefined) skill.description = description;
  return skill;
}

async function readCommands(root: string, warnings: ImportWarning[]): Promise<ImportedSkill[]> {
  const skills: ImportedSkill[] = [];
  const commandsDir = join(root, 'commands');
  for (const entry of await listDirectory(commandsDir)) {
    if (!entry.isFile()) {
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        warnings.push({
          code: 'unrecognized-entry',
          message: `ignored non-file command ${toSourcePath(root, join(commandsDir, entry.name))}`,
          sourcePath: toSourcePath(root, join(commandsDir, entry.name)),
        });
      }
      continue;
    }

    const filePath = join(commandsDir, entry.name);
    const lower = entry.name.toLowerCase();
    let skill: ImportedSkill | undefined;
    if (lower.endsWith('.toml')) {
      skill = await readTomlCommand(root, filePath, warnings);
    } else if (lower.endsWith('.md')) {
      skill = await readMarkdownCommand(root, filePath, warnings);
    } else {
      warnings.push({
        code: 'unrecognized-entry',
        message: `ignored unsupported command file ${toSourcePath(root, filePath)}`,
        sourcePath: toSourcePath(root, filePath),
      });
    }
    if (skill !== undefined) skills.push(skill);
  }
  return skills;
}

async function read(root: string): Promise<ImportBundle> {
  const warnings: ImportWarning[] = [];
  const bundleRoot = resolve(root);

  const settingsFile = join(root, 'settings.json');
  const config = await readConfig(root, warnings);

  let configSourcePath = (await isFile(settingsFile)) ? toSourcePath(root, settingsFile) : '.';
  const qwenMd = join(root, 'QWEN.md');
  const agents = [];
  if (await isFile(qwenMd)) {
    if (configSourcePath === '.') configSourcePath = toSourcePath(root, qwenMd);
    const agent = await readAgentFile({ root, filePath: qwenMd, fallbackName: 'qwen', warnings });
    if (agent !== undefined) agents.push(agent);
  }

  const skills = [
    ...(await readCommands(root, warnings)),
    ...(await readSkillDirectories(root, join(root, 'skills'), warnings)),
  ];

  const bundle: ImportBundle = {
    source: 'qwen',
    root: bundleRoot,
    agents: dedupeByName(agents, warnings),
    skills: dedupeByName(skills, warnings),
    config: {
      source: 'qwen',
      settings: config.settings,
      sourcePath: configSourcePath,
      mcpServers: config.mcpServers,
    },
    warnings,
  };

  return ImportBundleSchema.parse(bundle);
}

export const qwenSource: ImportSourceAdapter = {
  source: 'qwen',
  detect,
  read,
};
