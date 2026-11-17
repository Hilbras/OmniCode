/**
 * Installing the skills an import bundle carries.
 *
 * The destination is the one the runtime already reads: `userFileSkillSource`
 * discovers `<home>/skills` (and `<home>/.agents/skills`), so a written
 * `<home>/skills/<name>/SKILL.md` is loadable without further registration.
 * Agent definitions have no such directory — the runtime builds agents from
 * profiles and session state — so they are reported, never written somewhere
 * invented.
 */

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, relative as relativePath, sep } from 'node:path';

import type { ImportBundle, ImportedSkill } from '@hilbras/omnicode-migration';

export interface ApplySkillsOptions {
  readonly homeDir: string;
  readonly force: boolean;
}

export interface AppliedSkill {
  readonly name: string;
  readonly files: number;
}

export interface SkippedSkill {
  readonly name: string;
  readonly reason: string;
}

export interface ApplySkillsResult {
  readonly created: readonly AppliedSkill[];
  readonly skipped: readonly SkippedSkill[];
  readonly notes: readonly string[];
}

const SAFE_SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isSafeSkillName(name: string): boolean {
  return SAFE_SKILL_NAME.test(name) && name !== '.' && name !== '..';
}

export function renderSkillFile(skill: ImportedSkill): string {
  const lines = ['---', `name: ${JSON.stringify(skill.name)}`];
  if (skill.description !== undefined) {
    lines.push(`description: ${JSON.stringify(skill.description)}`);
  }
  lines.push('---', '');
  const body = skill.body.replace(/\n+$/, '');
  return `${[...lines, body].join('\n')}\n`;
}

function skillDirectoryPrefix(skill: ImportedSkill): string {
  const suffix = '/SKILL.md';
  return skill.sourcePath.toLowerCase().endsWith(suffix.toLowerCase())
    ? skill.sourcePath.slice(0, -suffix.length)
    : skill.sourcePath;
}

export async function applyImportedSkills(
  bundle: ImportBundle,
  options: ApplySkillsOptions,
): Promise<ApplySkillsResult> {
  const created: AppliedSkill[] = [];
  const skipped: SkippedSkill[] = [];
  const notes: string[] = [];

  for (const skill of bundle.skills) {
    if (!isSafeSkillName(skill.name)) {
      skipped.push({ name: skill.name, reason: 'name is not a plain directory name' });
      continue;
    }
    const targetDir = join(options.homeDir, 'skills', skill.name);
    if (existsSync(targetDir) && !options.force) {
      skipped.push({ name: skill.name, reason: 'already installed (pass --force to replace)' });
      continue;
    }

    await mkdir(targetDir, { recursive: true });
    let written = 0;
    await writeFile(join(targetDir, 'SKILL.md'), renderSkillFile(skill), 'utf8');
    written += 1;

    const prefix = skillDirectoryPrefix(skill);
    for (const file of skill.files ?? []) {
      if (!file.startsWith(`${prefix}/`)) {
        notes.push(`${skill.name}: skipped ${file} (outside the skill directory)`);
        continue;
      }
      const relative = file.slice(prefix.length + 1);
      const destination = join(targetDir, relative);
      const within = relativePath(targetDir, destination);
      if (within.startsWith('..') || within.startsWith(`${sep}..`) || within === '') {
        notes.push(`${skill.name}: skipped ${file} (escapes the skill directory)`);
        continue;
      }
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(join(bundle.root, file), destination);
      written += 1;
    }

    created.push({ name: skill.name, files: written });
  }

  return { created, skipped, notes };
}

export function renderApplyReport(result: ApplySkillsResult, homeDir: string): string {
  const lines: string[] = [];
  if (result.created.length === 0 && result.skipped.length === 0) {
    lines.push('No skills to install.');
  }
  if (result.created.length > 0) {
    lines.push(`Installed ${String(result.created.length)} skill(s) into ${join(homeDir, 'skills')}:`);
    for (const skill of result.created) {
      lines.push(`  + ${skill.name} (${String(skill.files)} file(s))`);
    }
  }
  if (result.skipped.length > 0) {
    lines.push(`Skipped ${String(result.skipped.length)} skill(s):`);
    for (const skill of result.skipped) {
      lines.push(`  - ${skill.name}: ${skill.reason}`);
    }
  }
  for (const note of result.notes) lines.push(`  note: ${note}`);
  return `${lines.join('\n')}\n`;
}

export interface AppliedMcpServers {
  readonly added: readonly string[];
  readonly skipped: readonly { readonly name: string; readonly reason: string }[];
  readonly path: string;
}

export interface McpServerFile {
  readonly [key: string]: unknown;
  mcpServers?: Record<string, unknown>;
}

export function toMcpServerConfig(server: {
  readonly command?: string;
  readonly args?: readonly string[];
  readonly url?: string;
  readonly env?: Readonly<Record<string, string>>;
}): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (server.command !== undefined) config['command'] = server.command;
  if (server.args !== undefined) config['args'] = server.args;
  if (server.url !== undefined) config['url'] = server.url;
  if (server.env !== undefined) config['env'] = server.env;
  return config;
}

export async function applyImportedMcpServers(
  bundle: ImportBundle,
  options: ApplySkillsOptions,
): Promise<AppliedMcpServers> {
  const path = join(options.homeDir, 'mcp.json');
  const added: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const servers = bundle.config.mcpServers ?? {};

  let document: McpServerFile = {};
  if (existsSync(path)) {
    const text = await readFile(path, 'utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`${path} is not valid JSON; refusing to overwrite it`);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${path} is not a JSON object; refusing to overwrite it`);
    }
    document = parsed as McpServerFile;
  }

  const existing = document.mcpServers ?? {};
  const merged: Record<string, unknown> = { ...existing };
  for (const [name, server] of Object.entries(servers)) {
    if (!isSafeSkillName(name)) {
      skipped.push({ name, reason: 'name is not a plain server name' });
      continue;
    }
    if (existing[name] !== undefined && !options.force) {
      skipped.push({ name, reason: 'already configured (pass --force to replace)' });
      continue;
    }
    merged[name] = toMcpServerConfig(server);
    added.push(name);
  }

  if (added.length > 0) {
    await mkdir(options.homeDir, { recursive: true });
    const next = JSON.stringify({ ...document, mcpServers: merged }, null, 2);
    const temporary = `${path}.tmp`;
    await writeFile(temporary, `${next}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, path);
  }

  return { added, skipped, path };
}

export function renderMcpReport(result: AppliedMcpServers): string {
  const lines: string[] = [];
  if (result.added.length > 0) {
    lines.push(`Configured ${String(result.added.length)} MCP server(s) in ${result.path}:`);
    for (const name of result.added) lines.push(`  + ${name}`);
  }
  for (const entry of result.skipped) {
    lines.push(`  - ${entry.name}: ${entry.reason}`);
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}
