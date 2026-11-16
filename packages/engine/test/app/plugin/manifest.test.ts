import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseManifest, PLUGIN_SYSTEM_PROMPT_MAX_BYTES } from '#/app/plugin/manifest';

describe('plugin manifest parser', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'plugin-manifest-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads a manifest from the nested .omnicode-plugin/plugin.json location', async () => {
    await mkdir(join(dir, '.omnicode-plugin'), { recursive: true });
    await writeFile(
      join(dir, '.omnicode-plugin', 'plugin.json'),
      JSON.stringify({ name: 'legacy-demo' }),
      'utf8',
    );
    const result = await parseManifest(dir);
    expect(result.manifest?.name).toBe('legacy-demo');
    expect(result.manifestKind).toBe('omnicode-plugin-dir');
    expect(result.diagnostics).toEqual([]);
  });

  it('reads recursive command entries and valid hooks', async () => {
    await mkdir(join(dir, 'commands', 'frontend'), { recursive: true });
    await writeFile(join(dir, 'commands', 'frontend', 'component.md'), '# Component', 'utf8');
    await writeFile(join(dir, 'commands', 'deploy.md'), '# Deploy', 'utf8');
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({
        name: 'demo',
        permissions: { commands: true, hooks: true },
        commands: ['./commands'],
        hooks: [{ event: 'Stop', command: 'echo stop' }],
      }),
      'utf8',
    );

    const result = await parseManifest(dir);
    const root = await realpath(dir);

    expect(result.manifest?.commands).toEqual([
      { path: join(root, 'commands', 'deploy.md'), name: 'deploy' },
      { path: join(root, 'commands', 'frontend', 'component.md'), name: 'frontend/component' },
    ]);
    expect(result.manifest?.hooks).toEqual([{ event: 'Stop', command: 'echo stop' }]);
    expect(result.diagnostics).toEqual([]);
  });

  it('warns on invalid hooks and command paths', async () => {
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({
        name: 'demo',
        permissions: { commands: true, hooks: true },
        commands: ['../outside.md'],
        hooks: [{ event: 'Nope', command: 'echo nope' }],
      }),
      'utf8',
    );

    const result = await parseManifest(dir);

    expect(result.manifest?.commands).toBeUndefined();
    expect(result.manifest?.hooks).toBeUndefined();
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('Invalid hook at index 0'),
      '"commands" path must start with "./" (got "../outside.md")',
    ]);
  });

  it('resolves explicit agents directories', async () => {
    await mkdir(join(dir, 'agents'), { recursive: true });
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', agents: ['./agents'] }),
      'utf8',
    );

    const result = await parseManifest(dir);
    const root = await realpath(dir);

    expect(result.manifest?.agents).toEqual([join(root, 'agents')]);
    expect(result.diagnostics).toEqual([]);
  });

  it('defaults agents to the ./agents directory when the field is absent', async () => {
    await mkdir(join(dir, 'agents'), { recursive: true });
    await writeFile(join(dir, 'omnicode.plugin.json'), JSON.stringify({ name: 'demo' }), 'utf8');

    const result = await parseManifest(dir);

    expect(result.manifest?.agents).toEqual([join(dir, 'agents')]);
    expect(result.diagnostics).toEqual([]);
  });

  it('keeps agents empty when the field is absent and no ./agents directory exists', async () => {
    await writeFile(join(dir, 'omnicode.plugin.json'), JSON.stringify({ name: 'demo' }), 'utf8');

    const result = await parseManifest(dir);

    expect(result.manifest?.agents).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('warns on invalid agents paths', async () => {
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', agents: ['../outside'] }),
      'utf8',
    );

    const result = await parseManifest(dir);

    expect(result.manifest?.agents).toEqual([]);
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      '"agents" path must start with "./" (got "../outside")',
    ]);
  });

  it('reads the systemPrompt field, trimming surrounding whitespace', async () => {
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', systemPrompt: '\nAlways cite sources.\n' }),
      'utf8',
    );

    const result = await parseManifest(dir);

    expect(result.manifest?.systemPrompt).toBe('Always cite sources.');
    expect(result.diagnostics).toEqual([]);
  });

  it('treats a missing, blank, or non-string systemPrompt as absent', async () => {
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', systemPrompt: '   ' }),
      'utf8',
    );

    const blank = await parseManifest(dir);
    expect(blank.manifest?.systemPrompt).toBeUndefined();

    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', systemPrompt: 42 }),
      'utf8',
    );

    const nonString = await parseManifest(dir);
    expect(nonString.manifest?.systemPrompt).toBeUndefined();
    expect(nonString.diagnostics.map((d) => d.message)).toEqual([
      '"systemPrompt" must be a string',
    ]);
  });

  it('strips a UTF-8 BOM from the systemPromptPath file before trimming', async () => {
    await writeFile(join(dir, 'PROMPT.md'), '﻿Always cite sources.\n', 'utf8');
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', systemPromptPath: './PROMPT.md' }),
      'utf8',
    );

    const result = await parseManifest(dir);

    expect(result.manifest?.systemPrompt).toBe('Always cite sources.');
    expect(result.diagnostics).toEqual([]);
  });

  it('reads the systemPromptPath file, trimming surrounding whitespace', async () => {
    await writeFile(join(dir, 'PROMPT.md'), '\nAlways cite sources.\n', 'utf8');
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', systemPromptPath: './PROMPT.md' }),
      'utf8',
    );

    const result = await parseManifest(dir);

    expect(result.manifest?.systemPrompt).toBe('Always cite sources.');
    expect(result.diagnostics).toEqual([]);
  });

  it('combines systemPrompt and systemPromptPath, inline first', async () => {
    await writeFile(join(dir, 'PROMPT.md'), 'From file.', 'utf8');
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', systemPrompt: 'Inline.', systemPromptPath: './PROMPT.md' }),
      'utf8',
    );

    const result = await parseManifest(dir);

    expect(result.manifest?.systemPrompt).toBe('Inline.\n\nFrom file.');
    expect(result.diagnostics).toEqual([]);
  });

  it('warns on invalid systemPromptPath and keeps the inline systemPrompt', async () => {
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', systemPrompt: 'Inline.', systemPromptPath: 42 }),
      'utf8',
    );

    const nonString = await parseManifest(dir);
    expect(nonString.manifest?.systemPrompt).toBe('Inline.');
    expect(nonString.diagnostics.map((d) => d.message)).toEqual([
      '"systemPromptPath" must be a string',
    ]);

    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', systemPrompt: 'Inline.', systemPromptPath: 'PROMPT.md' }),
      'utf8',
    );

    const noPrefix = await parseManifest(dir);
    expect(noPrefix.manifest?.systemPrompt).toBe('Inline.');
    expect(noPrefix.diagnostics.map((d) => d.message)).toEqual([
      '"systemPromptPath" path must start with "./" (got "PROMPT.md")',
    ]);

    await mkdir(join(dir, 'docs'));
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', systemPrompt: 'Inline.', systemPromptPath: './docs' }),
      'utf8',
    );

    const notAFile = await parseManifest(dir);
    expect(notAFile.manifest?.systemPrompt).toBe('Inline.');
    expect(notAFile.diagnostics.map((d) => d.message)).toEqual([
      '"systemPromptPath" is not a file (./docs)',
    ]);
  });

  it('warns on a blank systemPromptPath', async () => {
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', systemPrompt: 'Inline.', systemPromptPath: '   ' }),
      'utf8',
    );

    const result = await parseManifest(dir);

    expect(result.manifest?.systemPrompt).toBe('Inline.');
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      '"systemPromptPath" must not be blank',
    ]);
  });

  it('rejects systemPromptPath values that escape the plugin root', async () => {
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', systemPromptPath: './../outside.md' }),
      'utf8',
    );

    const traversal = await parseManifest(dir);
    expect(traversal.manifest?.systemPrompt).toBeUndefined();
    expect(traversal.diagnostics.map((d) => d.message)).toEqual([
      '"systemPromptPath" path resolves outside the plugin (./../outside.md)',
    ]);

    const absolute = join(tmpdir(), 'outside-absolute.md');
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', systemPromptPath: absolute }),
      'utf8',
    );

    const absoluteResult = await parseManifest(dir);
    expect(absoluteResult.manifest?.systemPrompt).toBeUndefined();
    expect(absoluteResult.diagnostics.map((d) => d.message)).toEqual([
      `"systemPromptPath" path must start with "./" (got "${absolute}")`,
    ]);

    const outsideDir = await mkdtemp(join(tmpdir(), 'plugin-outside-'));
    await writeFile(join(outsideDir, 'secret.md'), 'outside content', 'utf8');
    await symlink(join(outsideDir, 'secret.md'), join(dir, 'linked.md'));
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', systemPromptPath: './linked.md' }),
      'utf8',
    );

    const linked = await parseManifest(dir);
    expect(linked.manifest?.systemPrompt).toBeUndefined();
    expect(linked.diagnostics.map((d) => d.message)).toEqual([
      '"systemPromptPath" path resolves outside the plugin (./linked.md)',
    ]);
    await rm(outsideDir, { recursive: true, force: true });
  });

  it('ignores an oversized inline systemPrompt with a warning', async () => {
    const oversized = 'x'.repeat(PLUGIN_SYSTEM_PROMPT_MAX_BYTES + 1);
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', systemPrompt: oversized }),
      'utf8',
    );

    const result = await parseManifest(dir);

    expect(result.manifest?.systemPrompt).toBeUndefined();
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      `"systemPrompt" is ${PLUGIN_SYSTEM_PROMPT_MAX_BYTES + 1} bytes, exceeding the 32 KB limit; the field is ignored`,
    ]);
  });

  it('ignores an oversized systemPromptPath file with a warning and keeps the inline field', async () => {
    await writeFile(join(dir, 'PROMPT.md'), 'x'.repeat(PLUGIN_SYSTEM_PROMPT_MAX_BYTES + 1), 'utf8');
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', systemPrompt: 'Inline.', systemPromptPath: './PROMPT.md' }),
      'utf8',
    );

    const result = await parseManifest(dir);

    expect(result.manifest?.systemPrompt).toBe('Inline.');
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      `"systemPromptPath" is ${PLUGIN_SYSTEM_PROMPT_MAX_BYTES + 1} bytes, exceeding the 32 KB limit; the file is ignored (./PROMPT.md)`,
    ]);
  });

  it('accepts system-prompt content exactly at the byte limit', async () => {
    await writeFile(join(dir, 'PROMPT.md'), 'x'.repeat(PLUGIN_SYSTEM_PROMPT_MAX_BYTES), 'utf8');
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', systemPromptPath: './PROMPT.md' }),
      'utf8',
    );

    const result = await parseManifest(dir);

    expect(result.manifest?.systemPrompt).toBe('x'.repeat(PLUGIN_SYSTEM_PROMPT_MAX_BYTES));
    expect(result.diagnostics).toEqual([]);
  });

  it('accepts declared permissions and retains them on the manifest', async () => {
    await mkdir(join(dir, 'commands'), { recursive: true });
    await writeFile(join(dir, 'commands', 'deploy.md'), '# Deploy', 'utf8');
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({
        name: 'demo',
        permissions: {
          hooks: true,
          commands: true,
          mcpServers: true,
          skills: true,
          agents: true,
        },
        commands: ['./commands'],
        hooks: [{ event: 'Stop', command: 'echo stop' }],
        mcpServers: { finance: { command: 'finance-mcp' } },
      }),
      'utf8',
    );

    const result = await parseManifest(dir);

    expect(result.manifest?.permissions).toEqual({
      hooks: true,
      commands: true,
      mcpServers: true,
      skills: true,
      agents: true,
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('rejects hooks without "permissions.hooks"', async () => {
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', hooks: [{ event: 'Stop', command: 'echo stop' }] }),
      'utf8',
    );

    const result = await parseManifest(dir);

    expect(result.diagnostics.map((d) => d.message)).toEqual([
      '"hooks" requires "permissions.hooks": true',
    ]);
    expect(result.diagnostics[0]?.severity).toBe('error');
  });

  it('rejects commands without "permissions.commands"', async () => {
    await mkdir(join(dir, 'commands'), { recursive: true });
    await writeFile(join(dir, 'commands', 'deploy.md'), '# Deploy', 'utf8');
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', commands: ['./commands'] }),
      'utf8',
    );

    const result = await parseManifest(dir);

    expect(result.diagnostics.map((d) => d.message)).toEqual([
      '"commands" requires "permissions.commands": true',
    ]);
    expect(result.diagnostics[0]?.severity).toBe('error');
  });

  it('rejects mcpServers without "permissions.mcpServers"', async () => {
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', mcpServers: { finance: { command: 'finance-mcp' } } }),
      'utf8',
    );

    const result = await parseManifest(dir);

    expect(result.diagnostics.map((d) => d.message)).toEqual([
      '"mcpServers" requires "permissions.mcpServers": true',
    ]);
    expect(result.diagnostics[0]?.severity).toBe('error');
  });

  it('accepts skills and agents acknowledgements without requiring them', async () => {
    await mkdir(join(dir, 'skills'), { recursive: true });
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({
        name: 'demo',
        skills: ['./skills'],
        agents: [],
        permissions: { skills: true, agents: true },
      }),
      'utf8',
    );

    const result = await parseManifest(dir);

    expect(result.manifest?.permissions).toEqual({ skills: true, agents: true });
    expect(result.diagnostics).toEqual([]);
  });

  it('rejects unknown permission keys', async () => {
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', permissions: { network: true } }),
      'utf8',
    );

    const result = await parseManifest(dir);

    expect(result.manifest?.permissions).toBeUndefined();
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      expect.stringContaining('Unknown key "network" in "permissions"'),
    ]);
    expect(result.diagnostics[0]?.severity).toBe('error');
  });

  it('rejects non-object and non-boolean permission values', async () => {
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', permissions: 'all' }),
      'utf8',
    );

    const nonObject = await parseManifest(dir);
    expect(nonObject.diagnostics.map((d) => d.message)).toEqual([
      '"permissions" must be an object',
    ]);

    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', permissions: { hooks: 'yes' } }),
      'utf8',
    );

    const nonBoolean = await parseManifest(dir);
    expect(nonBoolean.diagnostics.map((d) => d.message)).toEqual([
      '"permissions.hooks" must be a boolean',
    ]);
  });

  it('accepts a satisfiable "engines.omnicode" range against an explicit host version', async () => {
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', engines: { omnicode: '^0.6.0' } }),
      'utf8',
    );

    const result = await parseManifest(dir, { hostVersion: '0.6.0' });

    expect(result.manifest?.engines).toEqual({ omnicode: '^0.6.0' });
    expect(result.diagnostics).toEqual([]);
  });

  it('rejects an unsatisfiable "engines.omnicode" range', async () => {
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', engines: { omnicode: '^2.0.0' } }),
      'utf8',
    );

    const result = await parseManifest(dir, { hostVersion: '0.6.0' });

    expect(result.diagnostics.map((d) => d.message)).toEqual([
      'Plugin requires Omnicode "^2.0.0" ("engines.omnicode") but the host version is "0.6.0"',
    ]);
    expect(result.diagnostics[0]?.severity).toBe('error');
  });

  it('rejects an invalid "engines.omnicode" range', async () => {
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', engines: { omnicode: 'not-a-range' } }),
      'utf8',
    );

    const result = await parseManifest(dir, { hostVersion: '0.6.0' });

    expect(result.diagnostics.map((d) => d.message)).toEqual([
      '"engines.omnicode" must be a valid semver range (got "not-a-range")',
    ]);
    expect(result.diagnostics[0]?.severity).toBe('error');
  });

  it('warns but keeps the manifest when the host version is the placeholder', async () => {
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', engines: { omnicode: '^9.0.0' } }),
      'utf8',
    );

    const result = await parseManifest(dir, { hostVersion: '0.0.0' });

    expect(result.manifest?.name).toBe('demo');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe('warn');
    expect(result.diagnostics[0]?.message).toContain('^9.0.0');
    expect(result.diagnostics[0]?.message).toContain('plugins are not rejected');
  });

  it('warns but keeps the manifest when the host version is not valid semver', async () => {
    await writeFile(
      join(dir, 'omnicode.plugin.json'),
      JSON.stringify({ name: 'demo', engines: { omnicode: '^9.0.0' } }),
      'utf8',
    );

    const result = await parseManifest(dir, { hostVersion: 'not-semver' });

    expect(result.manifest?.name).toBe('demo');
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe('warn');
    expect(result.diagnostics[0]?.message).toContain('not-semver');
    expect(result.diagnostics[0]?.message).toContain('plugins are not rejected');
  });
});
