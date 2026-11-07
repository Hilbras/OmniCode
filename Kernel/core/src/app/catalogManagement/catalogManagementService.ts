import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import { dump as dumpYaml, load as loadYaml } from 'js-yaml';
import path from 'pathe';

import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { ILogService } from '@hilbras/omnicode-base/log/log';
import { CoreErrors } from '@hilbras/omnicode-base/errors/codes';
import { Error2 } from '@hilbras/omnicode-base/errors/errors';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { IConfigService, ConfigTarget } from '#/app/config/config';
import { IMcpManagementService } from '#/app/mcpManagement/mcpManagement';
import { LifecycleScope } from '#/app/scopes';
import { SkillErrors } from '#/features/skill/catalog/errors';
import {
  DISABLED_SKILLS_SECTION,
  EXTRA_SKILL_DIRS_SECTION,
  MERGE_ALL_AVAILABLE_SKILLS_SECTION,
  type DisabledSkillsConfig,
  type ExtraSkillDirsConfig,
  type MergeAllAvailableSkillsConfig,
} from '#/features/skill/catalog/configSection';
import { parseSkillText } from '#/features/skill/catalog/parser';
import {
  configuredRoots,
  projectSkillRootCandidates,
  projectRoots,
  userRoots,
} from '#/features/skill/catalog/skillRoots';
import type { SkillDefinition, SkillRoot } from '#/features/skill/catalog/types';
import type { McpServerConfig } from '#/mcpCore/config-schema';
import { IHostFileSystem, type HostDirEntry } from '#/os/interface/hostFileSystem';
import { HostFsError, OsFsErrors } from '#/os/interface/hostFsErrors';
import {
  EXTRA_AGENT_DIRS_SECTION,
  type ExtraAgentDirsConfig,
} from '#/workspace/workspaceAgentProfileLoader/configSection';
import { parseAgentFileText } from '#/workspace/workspaceAgentProfileLoader/internal/agentFile';
import { discoverAgentFiles } from '#/workspace/workspaceAgentProfileLoader/internal/agentFileDiscovery';
import {
  configuredAgentRoots,
  projectAgentRoots,
  userAgentRoots,
} from '#/workspace/workspaceAgentProfileLoader/internal/agentRoots';
import type {
  AgentFileDefinition,
  AgentFileRoot,
} from '#/workspace/workspaceAgentProfileLoader/internal/types';

import {
  ICatalogManagementService,
  type CatalogCreateInput,
  type CatalogImportSummary,
  type CatalogQuery,
  type CatalogZipExport,
  type McpServersExport,
} from './catalogManagement';
import { type ArchiveFile, readArchiveEntries, readArchiveText, writeArchive } from './catalogArchive';

const NAME_PATTERN = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const SKILLS_DIR = 'skills';
const AGENTS_DIR = 'agents';
const SOURCE_PRIORITY: Record<string, number> = {
  builtin: 0,
  plugin: 1,
  explicit: 2,
  extra: 3,
  user: 4,
  project: 5,
};

interface PlannedWrite {
  readonly target: string;
  readonly data: Buffer;
}

export class CatalogManagementService implements ICatalogManagementService {
  declare readonly _serviceBrand: undefined;

  constructor(
    @IBootstrapService private readonly bootstrap: IBootstrapService,
    @IHostFileSystem private readonly fs: IHostFileSystem,
    @IConfigService private readonly config: IConfigService,
    @IMcpManagementService private readonly mcp: IMcpManagementService,
    @ILogService private readonly log: ILogService,
  ) {}

  async listSkills(query: CatalogQuery = {}): Promise<readonly SkillDefinition[]> {
    await this.config.ready;
    const roots = await this.skillRoots(query.cwd);
    const byName = new Map<string, SkillDefinition>();
    const warn = (message: string): void => this.log.warn(message);
    for (const root of orderSkillRoots(roots)) {
      const result = await discoverFileSkills(this.fs, [root], warn);
      for (const skill of result) {
        const key = skill.name.toLowerCase();
        if (!byName.has(key)) byName.set(key, skill);
      }
    }
    return [...byName.values()].toSorted((a, b) => a.name.localeCompare(b.name));
  }

  async disabledSkills(): Promise<readonly string[]> {
    await this.config.ready;
    return this.config.get<DisabledSkillsConfig>(DISABLED_SKILLS_SECTION) ?? [];
  }

  async setSkillDisabled(name: string, disabled: boolean): Promise<readonly string[]> {
    const normalized = validateName(name, 'skill');
    const skills = await this.listSkills();
    if (!skills.some((skill) => skill.name.toLowerCase() === normalized)) {
      throw new Error2(SkillErrors.codes.SKILL_NOT_FOUND, `Skill "${name}" was not found`);
    }
    const next = new Set((await this.disabledSkills()).map((entry) => entry.toLowerCase()));
    if (disabled) next.add(normalized);
    else next.delete(normalized);
    const list = [...next].toSorted();
    await this.config.replace(DISABLED_SKILLS_SECTION, list, ConfigTarget.User);
    return list;
  }

  async listAgentProfiles(query: CatalogQuery = {}): Promise<readonly AgentFileDefinition[]> {
    await this.config.ready;
    const roots = await this.agentRoots(query.cwd);
    const byName = new Map<string, AgentFileDefinition>();
    for (const root of orderAgentRoots(roots)) {
      const result = await discoverAgentFiles(this.fs, [root], (message) => this.log.warn(message));
      for (const agent of result.agents) {
        if (!byName.has(agent.name)) byName.set(agent.name, agent);
      }
    }
    return [...byName.values()].toSorted((a, b) => a.name.localeCompare(b.name));
  }

  async createSkill(input: CatalogCreateInput): Promise<SkillDefinition> {
    const name = validateName(input.name, 'skill');
    const text = composeMarkdown(input.content, {
      name,
      description: requireDescription(input.description),
    });
    const dir = this.userSkillsDir();
    const target = path.join(dir, name, 'SKILL.md');
    await this.assertNameFree(name, dir);
    const skill = parseSkillText({ skillMdPath: target, skillDirName: name, source: 'user', text });
    await this.commit([{ target, data: Buffer.from(text, 'utf8') }]);
    return skill;
  }

  async createAgentProfile(input: CatalogCreateInput): Promise<AgentFileDefinition> {
    const name = validateName(input.name, 'agent');
    const text = composeMarkdown(input.content, {
      name,
      description: requireDescription(input.description),
      whenToUse: input.whenToUse,
    });
    const dir = this.userAgentsDir();
    const target = path.join(dir, `${name}.md`);
    await this.assertNameFree(name, dir);
    const agent = parseAgentFileText({ path: target, source: 'user', text });
    await this.commit([{ target, data: Buffer.from(text, 'utf8') }]);
    return agent;
  }

  async importSkills(archive: Buffer): Promise<CatalogImportSummary> {
    const entries = await readArchiveEntries(archive);
    const existing = existingNames(await this.listSkills());
    const groups = groupSkillArchives(entries);
    const writes: PlannedWrite[] = [];
    const imported: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const group of groups) {
      const lower = group.name.toLowerCase();
      if (existing.has(lower) || imported.includes(group.name)) {
        skipped.push(group.name);
        continue;
      }
      try {
        if (!NAME_PATTERN.test(group.name)) throw invalid(`Invalid skill name "${group.name}"`);
        const bundle = group.bundleFiles.length > 0;
        const markdownPath = bundle ? `${group.prefix}/SKILL.md` : group.prefix;
        const markdown = readArchiveText(entries, markdownPath);
        if (markdown === undefined) throw invalid(`Skill "${group.name}" has no SKILL.md`);
        const targetMd = bundle
          ? path.join(this.userSkillsDir(), group.name, 'SKILL.md')
          : path.join(this.userSkillsDir(), `${group.name}.md`);
        const parsed = parseSkillText({
          skillMdPath: targetMd,
          skillDirName: group.name,
          source: 'user',
          text: markdown,
        });
        if (parsed.name.toLowerCase() !== lower) {
          throw invalid(
            `Skill "${group.name}" declares a different name "${parsed.name}" in its frontmatter`,
          );
        }
        for (const file of group.bundleFiles) {
          const relative = file.path.slice(group.prefix.length + 1);
          writes.push({ target: path.join(this.userSkillsDir(), group.name, relative), data: file.data });
        }
        imported.push(group.name);
      } catch (error) {
        errors.push(describeImportError(group.name, error));
      }
    }

    await this.commit(writes);
    return { imported, skipped, errors };
  }

  async importAgentProfiles(archive: Buffer): Promise<CatalogImportSummary> {
    const entries = await readArchiveEntries(archive);
    const existing = existingNames(await this.listAgentProfiles());
    const writes: PlannedWrite[] = [];
    const imported: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const file of entries) {
      if (!file.path.toLowerCase().endsWith('.md')) continue;
      const name = path.basename(file.path, '.md');
      if (existing.has(name) || imported.includes(name)) {
        skipped.push(name);
        continue;
      }
      try {
        if (!NAME_PATTERN.test(name)) throw invalid(`Invalid agent name "${name}"`);
        const target = path.join(this.userAgentsDir(), `${name}.md`);
        const parsed = parseAgentFileText({
          path: target,
          source: 'user',
          text: file.data.toString('utf8'),
        });
        if (parsed.name !== name) {
          throw invalid(`Agent "${name}" declares a different name "${parsed.name}" in its frontmatter`);
        }
        writes.push({ target, data: file.data });
        imported.push(name);
      } catch (error) {
        errors.push(describeImportError(name, error));
      }
    }

    await this.commit(writes);
    return { imported, skipped, errors };
  }

  async exportSkills(): Promise<CatalogZipExport> {
    const skills = await this.listSkills();
    const files: ArchiveFile[] = [];
    for (const skill of [...skills].toSorted((a, b) => a.name.localeCompare(b.name))) {
      const skillDir = await this.skillBundleDir(skill);
      if (skillDir !== undefined) {
        let collected;
        try {
          collected = await collectFiles(this.fs, skillDir);
        } catch (error) {
          this.log.warn(`Skipping unreadable skill bundle ${skillDir}: ${errorMessage(error)}`);
          continue;
        }
        files.push(
          ...collected.map((file) => ({
            path: `${SKILLS_DIR}/${skill.name}/${file.relative}`,
            data: file.data,
          })),
        );
      } else {
        files.push({
          path: `${SKILLS_DIR}/${skill.name}.md`,
          data: Buffer.from(await this.fs.readText(skill.path), 'utf8'),
        });
      }
    }
    return { fileName: `omnicode-skills-${timestamp()}.zip`, bytes: await writeArchive(files) };
  }

  async exportAgentProfiles(): Promise<CatalogZipExport> {
    const agents = await this.listAgentProfiles();
    const files: ArchiveFile[] = [];
    for (const agent of agents) {
      if (agent.source !== 'user') continue;
      files.push({
        path: `${AGENTS_DIR}/${agent.name}.md`,
        data: Buffer.from(await this.fs.readText(agent.path), 'utf8'),
      });
    }
    return { fileName: `omnicode-agents-${timestamp()}.zip`, bytes: await writeArchive(files) };
  }

  async exportMcpServers(query: CatalogQuery = {}): Promise<McpServersExport> {
    const servers = await this.mcp.listServers({ cwd: query.cwd });
    const mcpServers: Record<string, Record<string, unknown>> = {};
    for (const server of servers) {
      mcpServers[server.name] = redactMcpConfig(server.config as McpServerConfig);
    }
    return { mcpServers };
  }

  private userSkillsDir(): string {
    return path.join(this.bootstrap.homeDir, SKILLS_DIR);
  }

  private userAgentsDir(): string {
    return path.join(this.bootstrap.homeDir, AGENTS_DIR);
  }

  private async skillRoots(cwd: string | undefined): Promise<readonly SkillRoot[]> {
    const extra = this.config.get<ExtraSkillDirsConfig>(EXTRA_SKILL_DIRS_SECTION) ?? [];
    const mergeAllAvailableSkills =
      this.config.get<MergeAllAvailableSkillsConfig>(MERGE_ALL_AVAILABLE_SKILLS_SECTION) ?? true;
    const options = { mergeAllAvailableSkills };
    const roots: SkillRoot[] = [
      ...(await userRoots(this.bootstrap.homeDir, this.bootstrap.osHomeDir, options)),
    ];
    if (cwd !== undefined) roots.push(...(await projectRoots(cwd, options)));
    if (extra.length > 0) {
      roots.push(
        ...(await configuredRoots(extra, cwd ?? this.bootstrap.homeDir, this.bootstrap.osHomeDir, 'extra')),
      );
    }
    return roots;
  }

  private async agentRoots(cwd: string | undefined): Promise<readonly AgentFileRoot[]> {
    const extra = this.config.get<ExtraAgentDirsConfig>(EXTRA_AGENT_DIRS_SECTION) ?? [];
    const warn = (message: string): void => this.log.warn(message);
    const roots: AgentFileRoot[] = [
      ...(await userAgentRoots(this.fs, this.bootstrap.homeDir, this.bootstrap.osHomeDir, warn)),
    ];
    if (cwd !== undefined) roots.push(...(await projectAgentRoots(this.fs, cwd, warn)));
    if (extra.length > 0) {
      roots.push(
        ...(await configuredAgentRoots(
          this.fs,
          extra,
          cwd ?? this.bootstrap.homeDir,
          this.bootstrap.osHomeDir,
          'extra',
          warn,
        )),
      );
    }
    return roots;
  }

  private async skillBundleDir(skill: SkillDefinition): Promise<string | undefined> {
    if (path.basename(skill.path) !== 'SKILL.md') return undefined;
    try {
      const [skillDir, userSkills, project] = await Promise.all([
        this.fs.realpath(skill.dir),
        this.fs.realpath(this.userSkillsDir()).catch(() => this.userSkillsDir()),
        projectSkillRootCandidates(this.bootstrap.cwd),
      ]);
      if (skillDir.startsWith(`${userSkills}/`)) return skillDir;
      const candidates = [
        ...project.candidates,
        path.join(project.projectRoot, '.agents/skills'),
      ];
      if (candidates.some((candidate) => skillDir.startsWith(`${candidate}/`))) return skillDir;
      return undefined;
    } catch {
      return undefined;
    }
  }

  private async assertNameFree(name: string, dir: string): Promise<void> {
    if (await pathExists(this.fs, path.join(dir, name)) || await pathExists(this.fs, path.join(dir, `${name}.md`))) {
      throw conflict(`"${name}" already exists`);
    }
  }

  private async commit(writes: readonly PlannedWrite[]): Promise<void> {
    if (writes.length === 0) return;
    for (const write of writes) {
      if (await pathExists(this.fs, write.target)) {
        throw conflict(`"${write.target}" already exists`);
      }
    }
    const activated: string[] = [];
    try {
      for (const write of writes) {
        const parent = path.dirname(write.target);
        await this.fs.mkdir(parent, { recursive: true });
        const temp = path.join(parent, `.omnicode-import-${randomUUID()}`);
        await this.fs.writeBytes(temp, write.data);
        const bytes = await this.fs.readBytes(temp);
        await this.fs.writeBytes(write.target, bytes);
        await this.fs.remove(temp);
        activated.push(write.target);
      }
    } catch (error) {
      for (const target of activated) {
        await this.fs.remove(target).catch(() => undefined);
      }
      throw error;
    }
  }
}

function composeMarkdown(content: string, fields: Record<string, string | undefined>): string {
  const trimmed = content.trim();
  if (trimmed === '') throw invalid('Content must not be empty');
  const values = Object.fromEntries(
    Object.entries(fields).filter(([, value]) => typeof value === 'string' && value.trim() !== ''),
  );
  const frontmatter = dumpYaml(values).trimEnd();
  if (!trimmed.startsWith('---')) return `---\n${frontmatter}\n---\n\n${trimmed}\n`;
  const lines = trimmed.split(/\r?\n/);
  const close = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (close === -1) throw invalid('Missing closing frontmatter fence');
  const existing = loadYaml(lines.slice(1, close).join('\n'));
  const merged = {
    ...(typeof existing === 'object' && existing !== null ? existing : {}),
    ...values,
  };
  const body = lines.slice(close + 1).join('\n').trim();
  if (body === '') throw invalid('Agent/skill instructions must not be empty');
  return `---\n${dumpYaml(merged).trimEnd()}\n---\n\n${body}\n`;
}

function redactMcpConfig(config: McpServerConfig): Record<string, unknown> {
  const { name: _name, ...rest } = config as McpServerConfig & { readonly name?: string };
  const copy: Record<string, unknown> = { ...rest };
  const env = copy['env'];
  if (env !== undefined && typeof env === 'object' && env !== null) {
    copy['env'] = Object.fromEntries(Object.keys(env).map((key) => [key, '']));
  }
  const headers = copy['headers'];
  if (headers !== undefined && typeof headers === 'object' && headers !== null) {
    copy['headers'] = Object.fromEntries(Object.keys(headers).map((key) => [key, '']));
  }
  copy['bearerTokenEnvVar'] = 'MCP_BEARER_TOKEN';
  return copy;
}

function groupSkillArchives(entries: readonly ArchiveFile[]): Array<{
  name: string;
  prefix: string;
  bundleFiles: readonly ArchiveFile[];
}> {
  const groups = new Map<string, { name: string; prefix: string; bundleFiles: ArchiveFile[] }>();
  for (const file of entries) {
    if (!file.path.startsWith(`${SKILLS_DIR}/`)) continue;
    const remainder = file.path.slice(SKILLS_DIR.length + 1);
    const slash = remainder.indexOf('/');
    if (slash === -1) {
      if (!remainder.toLowerCase().endsWith('.md')) continue;
      const name = remainder.slice(0, -'.md'.length);
      groups.set(name, { name, prefix: `${SKILLS_DIR}/${remainder}`, bundleFiles: [] });
      continue;
    }
    const name = remainder.slice(0, slash);
    const group = groups.get(name) ?? {
      name,
      prefix: `${SKILLS_DIR}/${name}`,
      bundleFiles: [],
    };
    group.bundleFiles.push(file);
    groups.set(name, group);
  }
  return [...groups.values()].toSorted((a, b) => a.name.localeCompare(b.name));
}

async function discoverFileSkills(
  fs: IHostFileSystem,
  roots: readonly SkillRoot[],
  warn: (message: string) => void,
): Promise<readonly SkillDefinition[]> {
  const skills: SkillDefinition[] = [];
  for (const root of roots) {
    await walkSkillRoot(fs, root.path, root, true, 0, skills, warn);
  }
  return skills;
}

async function walkSkillRoot(
  fs: IHostFileSystem,
  dir: string,
  root: SkillRoot,
  topLevel: boolean,
  depth: number,
  out: SkillDefinition[],
  warn: (message: string) => void,
): Promise<void> {
  if (depth > 8) return;
  let entries: readonly HostDirEntry[];
  try {
    entries = (await fs.readdir(dir)).toSorted((a, b) => a.name.localeCompare(b.name));
  } catch {
    return;
  }
  const hasSkill = async (candidate: string): Promise<boolean> => {
    try {
      return (await fs.stat(path.join(candidate, 'SKILL.md'))).isFile;
    } catch {
      return false;
    }
  };
  for (const entry of entries) {
    if (!entry.isDirectory || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const entryPath = path.join(dir, entry.name);
    if (!(await hasSkill(entryPath))) continue;
    try {
      const skill = parseSkillText({
        skillMdPath: path.join(entryPath, 'SKILL.md'),
        skillDirName: entry.name,
        source: root.source,
        text: await fs.readText(path.join(entryPath, 'SKILL.md')),
      });
      out.push(skill);
    } catch (error) {
      warn(`Skipping invalid skill at ${entryPath}: ${errorMessage(error)}`);
    }
  }
  if (topLevel) {
    for (const entry of entries) {
      if (!entry.isFile || !entry.name.toLowerCase().endsWith('.md') || entry.name === 'SKILL.md') {
        continue;
      }
      const name = entry.name.slice(0, -'.md'.length);
      if (await hasSkill(path.join(dir, name))) continue;
      try {
        const skill = parseSkillText({
          skillMdPath: path.join(dir, entry.name),
          skillDirName: name,
          source: root.source,
          text: await fs.readText(path.join(dir, entry.name)),
        });
        out.push(skill);
      } catch (error) {
        warn(`Skipping invalid skill at ${path.join(dir, entry.name)}: ${errorMessage(error)}`);
      }
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const entryPath = path.join(dir, entry.name);
    if (await hasSkill(entryPath)) continue;
    await walkSkillRoot(fs, entryPath, root, false, depth + 1, out, warn);
  }
}

async function collectFiles(
  fs: IHostFileSystem,
  root: string,
): Promise<readonly { relative: string; data: Buffer }[]> {
  const out: { relative: string; data: Buffer }[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await fs.readdir(dir)) {
      if (entry.isSymbolicLink) continue;
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory) {
        if (entry.name === '.git' || entry.name === 'node_modules') continue;
        await walk(entryPath);
      } else if (entry.isFile) {
        out.push({
          relative: path.relative(root, entryPath),
          data: Buffer.from(await fs.readBytes(entryPath)),
        });
      }
    }
  };
  await walk(root);
  return out;
}

function orderSkillRoots(roots: readonly SkillRoot[]): readonly SkillRoot[] {
  return [...roots].toSorted(
    (a, b) => (SOURCE_PRIORITY[a.source] ?? 9) - (SOURCE_PRIORITY[b.source] ?? 9),
  );
}

function orderAgentRoots(roots: readonly AgentFileRoot[]): readonly AgentFileRoot[] {
  return [...roots].toSorted(
    (a, b) => (SOURCE_PRIORITY[a.source] ?? 9) - (SOURCE_PRIORITY[b.source] ?? 9),
  );
}

function existingNames(items: readonly { readonly name: string }[]): Set<string> {
  return new Set(items.map((item) => item.name.toLowerCase()));
}

function requireDescription(description: string): string {
  const trimmed = description.trim();
  if (trimmed === '') throw invalid('Description must not be empty');
  return trimmed;
}

function validateName(raw: string, kind: string): string {
  const name = raw.trim().toLowerCase();
  if (!NAME_PATTERN.test(name)) {
    throw invalid(`Invalid ${kind} name "${raw}": use lowercase letters, digits, '-' or '_'`);
  }
  return name;
}

function invalid(message: string): Error2 {
  return new Error2(CoreErrors.codes.VALIDATION_FAILED, message);
}

function conflict(message: string): Error2 {
  return new Error2(CoreErrors.codes.VALIDATION_FAILED, message, { details: { kind: 'conflict' } });
}

function describeImportError(name: string, error: unknown): string {
  return `${name}: ${errorMessage(error)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function pathExists(fs: IHostFileSystem, target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch (error) {
    if (error instanceof HostFsError && error.code === OsFsErrors.codes.OS_FS_NOT_FOUND) return false;
    return false;
  }
}

function timestamp(): string {
  return new Date().toISOString().replaceAll(/[:.]/g, '-');
}

registerScopedService(
  LifecycleScope.App,
  ICatalogManagementService,
  CatalogManagementService,
  ScopeActivation.OnDemand,
  'catalogManagement',
);
