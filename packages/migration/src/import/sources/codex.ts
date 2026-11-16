import { basename, join, resolve } from 'node:path';

import { parse as parseToml } from 'smol-toml';

import { readAgentFile } from '../agent-file.js';
import { dedupeByName } from '../dedupe.js';
import {
  isDirectory,
  isFile,
  listDirectory,
  readTextFile,
  toSourcePath,
} from '../files.js';
import { normalizeMcpServers, normalizeSettings } from '../normalize.js';
import {
  ImportBundleSchema,
  type ImportBundle,
  type ImportedAgent,
  type ImportedMcpServer,
  type ImportWarning,
  type ImportedSettings,
} from '../schema.js';
import { readSkillDirectories } from '../skill-dir.js';
import type { ImportSourceAdapter } from '../source.js';

interface CodexConfig {
  readonly settings: ImportedSettings;
  readonly mcpServers: Record<string, ImportedMcpServer> | undefined;
}

async function detect(root: string): Promise<boolean> {
  return (
    (await isFile(join(root, 'config.toml'))) ||
    (await isFile(join(root, 'AGENTS.md'))) ||
    (await isDirectory(join(root, 'prompts'))) ||
    (await isDirectory(join(root, 'skills')))
  );
}

async function readConfig(root: string, warnings: ImportWarning[]): Promise<CodexConfig> {
  const configFile = join(root, 'config.toml');
  if (!(await isFile(configFile))) return { settings: {}, mcpServers: undefined };

  const sourcePath = toSourcePath(root, configFile);
  let parsed: unknown;
  try {
    parsed = parseToml(await readTextFile(configFile));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    warnings.push({
      code: 'malformed-toml',
      message: `${sourcePath}: ${detail}`,
      sourcePath,
    });
    return { settings: {}, mcpServers: undefined };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    warnings.push({ code: 'invalid-entry', message: `${sourcePath} is not a TOML table`, sourcePath });
    return { settings: {}, mcpServers: undefined };
  }

  const table = parsed as Record<string, unknown>;
  const normalized = normalizeMcpServers(table['mcp_servers'] ?? table['mcpServers'], sourcePath);
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

async function readPrompts(root: string, warnings: ImportWarning[]): Promise<ImportedAgent[]> {
  const agents: ImportedAgent[] = [];
  const promptsDir = join(root, 'prompts');
  for (const entry of await listDirectory(promptsDir)) {
    if (!entry.isDirectory() && !entry.isFile()) continue;
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) {
      warnings.push({
        code: 'unrecognized-entry',
        message: `ignored non-markdown prompt ${toSourcePath(root, join(promptsDir, entry.name))}`,
        sourcePath: toSourcePath(root, join(promptsDir, entry.name)),
      });
      continue;
    }
    const filePath = join(promptsDir, entry.name);
    const agent = await readAgentFile({
      root,
      filePath,
      fallbackName: basename(entry.name).replace(/\.md$/i, ''),
      warnings,
    });
    if (agent !== undefined) agents.push(agent);
  }
  return agents;
}

async function read(root: string): Promise<ImportBundle> {
  const warnings: ImportWarning[] = [];
  const bundleRoot = resolve(root);

  const configFile = join(root, 'config.toml');
  const config = await readConfig(root, warnings);

  const agents: ImportedAgent[] = [];
  let configSourcePath = (await isFile(configFile)) ? toSourcePath(root, configFile) : '.';

  const agentsMd = join(root, 'AGENTS.md');
  if (await isFile(agentsMd)) {
    if (configSourcePath === '.') configSourcePath = toSourcePath(root, agentsMd);
    const agent = await readAgentFile({ root, filePath: agentsMd, fallbackName: 'codex', warnings });
    if (agent !== undefined) agents.push(agent);
  }
  agents.push(...(await readPrompts(root, warnings)));

  const skills = await readSkillDirectories(root, join(root, 'skills'), warnings);

  const bundle: ImportBundle = {
    source: 'codex',
    root: bundleRoot,
    agents: dedupeByName(agents, warnings),
    skills: dedupeByName(skills, warnings),
    config: {
      source: 'codex',
      settings: config.settings,
      sourcePath: configSourcePath,
      mcpServers: config.mcpServers,
    },
    warnings,
  };

  return ImportBundleSchema.parse(bundle);
}

export const codexSource: ImportSourceAdapter = {
  source: 'codex',
  detect,
  read,
};
