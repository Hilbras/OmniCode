import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { Buffer } from 'node:buffer';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';

import {
  MAX_ARCHIVE_ENTRIES,
  readArchiveEntries,
  writeArchive,
  type ArchiveFile,
} from '#/app/catalogManagement/catalogArchive';
import type { IMcpManagementService, McpManagedServer } from '#/app/mcpManagement/mcpManagement';
import { CatalogManagementService } from '#/app/catalogManagement/catalogManagementService';
import { HostFileSystem } from '#/os/backends/node-local/hostFsService';

import { stubBootstrap } from '../../app/bootstrap/stubs';
import { StubConfigService } from '../../stubs';

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'catalog-management-'));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function mcpStub(servers: readonly McpManagedServer[] = []): IMcpManagementService {
  return {
    _serviceBrand: undefined,
    listServers: async () => servers,
    getServer: async () => {
      throw new Error('unused');
    },
    addServer: async () => servers,
    updateServer: async () => servers,
    removeServer: async () => servers,
    testServer: async () => ({ success: true, output: '' }),
    listAuthStatuses: async () => [],
    inspectServers: async () => [],
    resolveServerByName: async () => ({ source: 'global', name: 'x' }),
    beginServerAuth: async () => ({ status: 'already-authorized' }),
    completeServerAuth: async () => undefined,
    cancelServerAuth: async () => undefined,
    resetServerAuth: async () => undefined,
  };
}

function service(
  mcp: IMcpManagementService = mcpStub(),
  config: StubConfigService = new StubConfigService(),
): CatalogManagementService {
  const log = { warn: () => undefined } as never;
  return new CatalogManagementService(
    stubBootstrap(home, {}, {}, home),
    new HostFileSystem(),
    config,
    mcp,
    log,
  );
}

async function zip(entries: readonly ArchiveFile[]): Promise<Buffer> {
  return writeArchive(entries);
}

function rawArchive(name: string, mode = 0o100644): Promise<Buffer> {
  return Promise.resolve(buildStoredZip(name, mode));
}

function buildStoredZip(name: string, mode: number): Buffer {
  const nameBytes = Buffer.from(name, 'utf8');
  const data = Buffer.from('x');
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(0, 10);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x0314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt32LE(0, 12);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(((mode & 0xffff) << 16) >>> 0, 38);
  central.writeUInt32LE(0, 42);
  const body = Buffer.concat([local, nameBytes, data]);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBytes.length, 12);
  end.writeUInt32LE(body.length, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([body, central, nameBytes, end]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

describe('catalog archive safety', () => {
  it('round-trips safe entries', async () => {
    const archive = await zip([
      { path: 'skills/a/SKILL.md', data: Buffer.from('x') },
      { path: 'skills/a/scripts/run.sh', data: Buffer.from('y') },
    ]);
    const entries = await readArchiveEntries(archive);
    expect(entries.map((entry) => entry.path).toSorted()).toEqual([
      'skills/a/SKILL.md',
      'skills/a/scripts/run.sh',
    ]);
  });

  it('rejects path traversal and absolute paths', async () => {
    for (const path of ['../escape.md', '/etc/passwd', 'skills/../../x.md']) {
      await expect(
      readArchiveEntries(await rawArchive(path)).then(
        () => 'accepted',
        () => 'rejected',
      ),
    ).resolves.toBe('rejected');
    }
  });

  it('normalizes windows-style backslash separators before validation', async () => {
    const entries = await readArchiveEntries(await rawArchive('skills\\a\\SKILL.md'));
    expect(entries.map((entry) => entry.path)).toEqual(['skills/a/SKILL.md']);
  });

  it('rejects archives with too many entries', async () => {
    const entries = Array.from({ length: MAX_ARCHIVE_ENTRIES + 1 }, (_, index) => ({
      path: `skills/s${index}/SKILL.md`,
      data: Buffer.from('-'),
    }));
    await expect(readArchiveEntries(await zip(entries))).rejects.toThrow(/more than/);
  });

  it('rejects symbolic links', async () => {
    await expect(
      readArchiveEntries(await rawArchive('skills/a/SKILL.md', 0o120777)).then(
        () => 'accepted',
        () => 'rejected',
      ),
    ).resolves.toBe('rejected');
  });
});

describe('CatalogManagementService', () => {
  it('creates a user skill, lists it, and rejects duplicates', async () => {
    const catalog = service();
    const skill = await catalog.createSkill({
      name: 'my-skill',
      description: 'Does things',
      content: 'Follow the steps.',
    });
    expect(skill.name).toBe('my-skill');
    expect(skill.source).toBe('user');
    const listed = await catalog.listSkills();
    expect(listed.map((entry) => entry.name)).toContain('my-skill');
    await expect(
      catalog.createSkill({ name: 'my-skill', description: 'Again', content: 'Body' }),
    ).rejects.toThrow(/already exists/);
  });

  it('rejects names that escape the user skills directory', async () => {
    const catalog = service();
    await expect(
      catalog.createSkill({ name: '../evil', description: 'x', content: 'Body' }),
    ).rejects.toThrow(/Invalid skill name/);
  });

  it('creates agent profiles with kebab-case names only', async () => {
    const catalog = service();
    const agent = await catalog.createAgentProfile({
      name: 'code-reviewer',
      description: 'Reviews code',
      whenToUse: 'Before merging',
      content: 'Review the diff.',
    });
    expect(agent.name).toBe('code-reviewer');
    await expect(
      catalog.createAgentProfile({ name: 'Bad Name', description: 'x', content: 'Body' }),
    ).rejects.toThrow(/Invalid agent name/);
  });

  it('exports skills and re-imports them while skipping conflicts', async () => {
    const catalog = service();
    await catalog.createSkill({ name: 'alpha', description: 'A', content: 'Alpha body.' });
    const exported = await catalog.exportSkills();
    expect(exported.fileName.endsWith('.zip')).toBe(true);

    const freshHome = await mkdtemp(join(tmpdir(), 'catalog-management-'));
    try {
      const other = new CatalogManagementService(
        stubBootstrap(freshHome, {}, {}, freshHome),
        new HostFileSystem(),
        new StubConfigService(),
        mcpStub(),
        { warn: () => undefined } as never,
      );
      const summary = await other.importSkills(exported.bytes);
      expect(summary).toEqual({ imported: ['alpha'], skipped: [], errors: [] });
      expect((await other.listSkills()).map((skill) => skill.name)).toContain('alpha');

      const second = await other.importSkills(exported.bytes);
      expect(second).toEqual({ imported: [], skipped: ['alpha'], errors: [] });
    } finally {
      await rm(freshHome, { recursive: true, force: true });
    }
  });

  it('reports invalid skills in an import and imports the rest', async () => {
    const catalog = service();
    const archive = await zip([
      { path: 'skills/good/SKILL.md', data: Buffer.from('---\nname: good\ndescription: ok\n---\nBody') },
      { path: 'skills/bad/SKILL.md', data: Buffer.from('no frontmatter') },
      { path: 'skills/empty/SKILL.md', data: Buffer.from('---\nname: empty\n---\nBody') },
    ]);
    const summary = await catalog.importSkills(archive);
    expect(summary.imported).toEqual(['good']);
    expect(summary.errors).toHaveLength(2);
    expect((await catalog.listSkills()).map((skill) => skill.name)).toEqual(['good']);
  });

  it('exports agent profiles and imports them with conflict skipping', async () => {
    const catalog = service();
    await catalog.createAgentProfile({
      name: 'helper',
      description: 'Helps',
      content: 'Help the user.',
    });
    const exported = await catalog.exportAgentProfiles();
    const summary = await catalog.importAgentProfiles(exported.bytes);
    expect(summary).toEqual({ imported: [], skipped: ['helper'], errors: [] });
  });

  it('redacts MCP secrets on export', async () => {
    const catalog = service(
      mcpStub([
        {
          name: 'remote',
          config: {
            transport: 'http',
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer secret', 'X-Trace': 'yes' },
          },
          source: 'global',
          origin: '/home/.omnicode/mcp.json',
          mutable: true,
        },
        {
          name: 'local',
          config: { transport: 'stdio', command: 'serve', env: { TOKEN: 'secret' } },
          source: 'global',
          origin: '/home/.omnicode/mcp.json',
          mutable: true,
        },
      ]),
    );
    const exported = await catalog.exportMcpServers();
    expect(JSON.stringify(exported)).not.toContain('Bearer secret');
    expect(JSON.stringify(exported)).not.toContain('"secret"');
    expect(exported.mcpServers['remote']!['headers']).toEqual({
      Authorization: '',
      'X-Trace': '',
    });
    expect(exported.mcpServers['local']!['env']).toEqual({ TOKEN: '' });
  });

  it('disables and enables skills idempotently via user config', async () => {
    const config = new StubConfigService();
    const catalog = service(mcpStub(), config);
    await catalog.createSkill({ name: 'toggle-me', description: 'T', content: 'Body.' });
    await catalog.createSkill({ name: 'keep-me', description: 'K', content: 'Body.' });

    expect(await catalog.disabledSkills()).toEqual([]);
    expect(await catalog.setSkillDisabled('toggle-me', true)).toEqual(['toggle-me']);
    expect(await catalog.disabledSkills()).toEqual(['toggle-me']);
    expect(config.get('disabledSkills')).toEqual(['toggle-me']);

    expect(await catalog.setSkillDisabled('TOGGLE-ME', true)).toEqual(['toggle-me']);
    expect(await catalog.setSkillDisabled('keep-me', true)).toEqual(['keep-me', 'toggle-me']);

    expect(await catalog.setSkillDisabled('toggle-me', false)).toEqual(['keep-me']);
    expect(await catalog.setSkillDisabled('keep-me', false)).toEqual([]);
    expect(await catalog.setSkillDisabled('keep-me', false)).toEqual([]);
    expect(config.get('disabledSkills')).toEqual([]);
  });

  it('rejects disabling an unknown skill name', async () => {
    const catalog = service();
    await expect(catalog.setSkillDisabled('missing', true)).rejects.toThrow(/was not found/);
    await expect(catalog.setSkillDisabled('../evil', true)).rejects.toThrow(/Invalid skill name/);
  });

  it('reads seeded disabledSkills config', async () => {
    const catalog = service(mcpStub(), new StubConfigService({ disabledSkills: ['Alpha'] }));
    expect(await catalog.disabledSkills()).toEqual(['Alpha']);
    await catalog.createSkill({ name: 'alpha', description: 'A', content: 'Body.' });
    expect(await catalog.setSkillDisabled('alpha', false)).toEqual([]);
  });
});
