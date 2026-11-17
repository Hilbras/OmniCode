import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectImportSources,
  readImportBundle,
  type ImportBundle,
} from '@hilbras/omnicode-migration';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerImportCommand, type ImportCommandDeps } from '#/cli/sub/import';
import { applyImportedMcpServers, applyImportedSkills } from '#/cli/sub/import-apply';

interface Captured {
  stdout: string;
  exitCode: number;
}

function harness(overrides: Partial<ImportCommandDeps> = {}): {
  deps: ImportCommandDeps;
  captured: Captured;
} {
  const captured: Captured = { stdout: '', exitCode: 0 };
  const deps: ImportCommandDeps = {
    detect: async () => [],
    read: async () => {
      throw new Error('read should not be called');
    },
    homeDir: () => '/home/tester',
    targetHomeDir: () => '/home/target',
    apply: applyImportedSkills,
    applyMcp: applyImportedMcpServers,
    write: (chunk) => {
      captured.stdout += chunk;
    },
    setExitCode: (code) => {
      captured.exitCode = code;
    },
    ...overrides,
  };
  return { deps, captured };
}

async function run(deps: ImportCommandDeps, argv: readonly string[]): Promise<void> {
  const program = new Command('omnicode').exitOverride();
  registerImportCommand(program, deps);
  await program.parseAsync(['node', 'omnicode', 'import', ...argv]);
}

function bundle(overrides: Partial<ImportBundle> = {}): ImportBundle {
  return {
    source: 'claude-code',
    root: '/claude',
    agents: [
      { name: 'reviewer', instructions: 'Review the diff.', sourcePath: 'agents/reviewer.md' },
    ],
    skills: [
      { name: 'deploy', body: 'Deploy it.', sourcePath: 'skills/deploy/SKILL.md' },
    ],
    config: { source: 'claude-code', settings: { model: 'sonnet' }, sourcePath: '.' },
    warnings: [],
    ...overrides,
  };
}

describe('`omnicode import` wiring', () => {
  it('registers the command with an optional root and the source/json options', () => {
    const { deps } = harness();
    const program = new Command('omnicode').exitOverride();
    registerImportCommand(program, deps);

    const command = program.commands.find((candidate) => candidate.name() === 'import');
    expect(command).toBeDefined();
    expect(command?.registeredArguments.map((argument) => argument.required)).toEqual([false]);
    const flags = command?.options.map((option) => option.long);
    expect(flags).toEqual(['--source', '--json', '--apply', '--force']);
  });

  it('previews the detected source and never claims to install anything', async () => {
    const { deps, captured } = harness({
      detect: async () => ['claude-code'],
      read: async () => bundle(),
    });

    await run(deps, ['/claude']);

    expect(captured.exitCode).toBe(0);
    expect(captured.stdout).toContain('Claude Code install: /claude');
    expect(captured.stdout).toContain('agents:   1');
    expect(captured.stdout).toContain('skills:   1');
    expect(captured.stdout).toContain('agent names: reviewer');
    expect(captured.stdout).toContain('skill names: deploy');
    expect(captured.stdout).toContain('Nothing was written');
    expect(captured.stdout).toContain('Re-run with --apply');
  });

  it('uses --source when the caller names the tool, skipping detection', async () => {
    let detected = false;
    const { deps, captured } = harness({
      detect: async () => {
        detected = true;
        return [];
      },
      read: async (source) => bundle({ source }),
    });

    await run(deps, ['/codex', '--source', 'codex']);

    expect(detected).toBe(false);
    expect(captured.exitCode).toBe(0);
    expect(captured.stdout).toContain('Codex install: /codex');
  });

  it('fails with a usable message when no install is found', async () => {
    const { deps, captured } = harness({ detect: async () => [] });

    await run(deps, ['/empty']);

    expect(captured.exitCode).toBe(1);
    expect(captured.stdout).toContain('No Claude Code, Codex, or Qwen Code install found at /empty');
    expect(captured.stdout).toContain('--source');
  });

  it('lists the matches and refuses to guess when more than one layout matches', async () => {
    const { deps, captured } = harness({ detect: async () => ['claude-code', 'codex'] });

    await run(deps, ['/mixed']);

    expect(captured.exitCode).toBe(1);
    expect(captured.stdout).toContain('More than one tool');
    expect(captured.stdout).toContain('claude-code, codex');
  });

  it('rejects an unknown --source with the valid choices', async () => {
    const { deps, captured } = harness();

    await run(deps, ['/claude', '--source', 'aider']);

    expect(captured.exitCode).toBe(1);
    expect(captured.stdout).toContain('Unknown source "aider"');
    expect(captured.stdout).toContain('claude-code, codex, qwen');
  });

  it('reports a read failure instead of throwing through the CLI', async () => {
    const { deps, captured } = harness({
      detect: async () => ['qwen'],
      read: async () => {
        throw new Error('archive is corrupt');
      },
    });

    await run(deps, ['/qwen']);

    expect(captured.exitCode).toBe(1);
    expect(captured.stdout).toContain('Could not read qwen at /qwen: archive is corrupt');
  });

  it('redacts MCP env values in --json output', async () => {
    const { deps, captured } = harness({
      detect: async () => ['claude-code'],
      read: async () =>
        bundle({
          config: {
            source: 'claude-code',
            settings: {},
            sourcePath: '.',
            mcpServers: {
              github: {
                command: 'npx',
                args: ['-y', 'server-github'],
                env: { GITHUB_TOKEN: 'ghp_secret_value' },
                sourcePath: '.mcp.json',
              },
            },
          },
        }),
    });

    await run(deps, ['/claude', '--json']);

    const parsed = JSON.parse(captured.stdout) as ImportBundle;
    expect(parsed.config.mcpServers?.['github']?.command).toBe('npx');
    expect(parsed.config.mcpServers?.['github']?.env).toEqual({ GITHUB_TOKEN: '<redacted>' });
    expect(captured.stdout).not.toContain('ghp_secret_value');
  });
});

describe('`omnicode import` against a real Claude Code layout', () => {
  let root: string;

  afterEach(() => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  });

  it('counts agents and skills parsed from disk by the migration adapters', async () => {
    root = mkdtempSync(join(tmpdir(), 'omnicode-import-cli-'));
    mkdirSync(join(root, 'agents'), { recursive: true });
    mkdirSync(join(root, 'skills', 'deploy'), { recursive: true });
    writeFileSync(
      join(root, 'agents', 'reviewer.md'),
      '---\nname: reviewer\ndescription: Reviews the diff\n---\nReview the diff carefully.\n',
    );
    writeFileSync(
      join(root, 'skills', 'deploy', 'SKILL.md'),
      '---\nname: deploy\ndescription: Ships it\n---\nRun the deploy checklist.\n',
    );
    writeFileSync(join(root, 'settings.json'), JSON.stringify({ model: 'sonnet' }));

    const { deps, captured } = harness({
      detect: detectImportSources,
      read: readImportBundle,
    });

    await run(deps, [root, '--source', 'claude-code']);

    expect(captured.exitCode).toBe(0);
    expect(captured.stdout).toContain('Claude Code install: ');
    expect(captured.stdout).toContain('agents:   1');
    expect(captured.stdout).toContain('skills:   1');
    expect(captured.stdout).toContain('agent names: reviewer');
    expect(captured.stdout).toContain('skill names: deploy');
  });
});

describe('`omnicode import --apply`', () => {
  let workspace: string;
  let home: string;
  let sourceRoot: string;

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'omnicode-import-apply-'));
    home = join(workspace, 'home');
    sourceRoot = join(workspace, 'claude');
    mkdirSync(join(sourceRoot, 'skills', 'deploy'), { recursive: true });
    mkdirSync(home, { recursive: true });
    writeFileSync(
      join(sourceRoot, 'skills', 'deploy', 'SKILL.md'),
      '---\nname: deploy\ndescription: Ships it\n---\nRun the deploy checklist.\n',
    );
    writeFileSync(join(sourceRoot, 'skills', 'deploy', 'steps.md'), 'Step one.\n');
    mkdirSync(join(sourceRoot, 'agents'), { recursive: true });
    writeFileSync(
      join(sourceRoot, 'agents', 'reviewer.md'),
      '---\nname: reviewer\n---\nReview the diff.\n',
    );
  });

  afterEach(() => {
    if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
  });

  function applyHarness(): { deps: ImportCommandDeps; captured: Captured } {
    return harness({
      detect: detectImportSources,
      read: readImportBundle,
      targetHomeDir: () => home,
    });
  }

  it('writes the skill and its extra files into the home the runtime loads', async () => {
    const { deps, captured } = applyHarness();

    await run(deps, [sourceRoot, '--source', 'claude-code', '--apply']);

    expect(captured.exitCode).toBe(0);
    const skillFile = join(home, 'skills', 'deploy', 'SKILL.md');
    expect(existsSync(skillFile)).toBe(true);
    const written = readFileSync(skillFile, 'utf8');
    expect(written).toContain('name: "deploy"');
    expect(written).toContain('description: "Ships it"');
    expect(written).toContain('Run the deploy checklist.');
    expect(readFileSync(join(home, 'skills', 'deploy', 'steps.md'), 'utf8')).toBe('Step one.\n');
    expect(captured.stdout).toContain('Installed 1 skill(s)');
  });

  it('leaves an existing skill alone unless --force is passed', async () => {
    const first = applyHarness();
    await run(first.deps, [sourceRoot, '--source', 'claude-code', '--apply']);

    writeFileSync(join(home, 'skills', 'deploy', 'SKILL.md'), 'locally edited\n');
    const second = applyHarness();
    await run(second.deps, [sourceRoot, '--source', 'claude-code', '--apply']);
    expect(readFileSync(join(home, 'skills', 'deploy', 'SKILL.md'), 'utf8')).toBe('locally edited\n');
    expect(second.captured.stdout).toContain('already installed');

    const third = applyHarness();
    await run(third.deps, [sourceRoot, '--source', 'claude-code', '--apply', '--force']);
    expect(readFileSync(join(home, 'skills', 'deploy', 'SKILL.md'), 'utf8')).toContain(
      'Run the deploy checklist.',
    );
  });

  it('refuses a skill name that is not a plain directory name', async () => {
    const { deps, captured } = harness({
      detect: async () => ['claude-code'],
      read: async () =>
        bundle({
          skills: [{ name: '../escape', body: 'x', sourcePath: 'skills/escape/SKILL.md' }],
        }),
      targetHomeDir: () => home,
    });

    await run(deps, [sourceRoot, '--apply']);

    expect(captured.exitCode).toBe(0);
    expect(captured.stdout).toContain('name is not a plain directory name');
    expect(existsSync(join(workspace, 'escape'))).toBe(false);
  });

  it('reports agent files as uninstallable instead of writing them somewhere invented', async () => {
    const { deps, captured } = applyHarness();

    await run(deps, [sourceRoot, '--source', 'claude-code', '--apply']);

    expect(captured.stdout).toContain('agent file(s)');
    expect(captured.stdout).toContain('no user agent directory');
  });

  it('rejects --apply together with --json', async () => {
    const { deps, captured } = applyHarness();

    await run(deps, [sourceRoot, '--source', 'claude-code', '--apply', '--json']);

    expect(captured.exitCode).toBe(1);
    expect(captured.stdout).toContain('they do not combine');
    expect(existsSync(join(home, 'skills'))).toBe(false);
  });
});

describe('`omnicode import --apply` — MCP servers', () => {
  let workspace: string;
  let home: string;
  let sourceRoot: string;

  const githubServer = {
    command: 'npx',
    args: ['-y', 'server-github'],
    env: { GITHUB_TOKEN: 'ghp_super_secret' },
    sourcePath: '.mcp.json',
  };

  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'omnicode-import-mcp-'));
    home = join(workspace, 'home');
    sourceRoot = join(workspace, 'claude');
    mkdirSync(home, { recursive: true });
    mkdirSync(sourceRoot, { recursive: true });
  });

  afterEach(() => {
    if (workspace !== undefined) rmSync(workspace, { recursive: true, force: true });
  });

  function mcpHarness(): { deps: ImportCommandDeps; captured: Captured } {
    return harness({
      detect: async () => ['claude-code'],
      read: async () =>
        bundle({
          skills: [],
          agents: [],
          config: {
            source: 'claude-code',
            settings: {},
            mcpServers: { github: githubServer },
            sourcePath: '.',
          },
        }),
      targetHomeDir: () => home,
    });
  }

  it('writes the server into mcp.json with owner-only permissions', async () => {
    const { deps, captured } = mcpHarness();

    await run(deps, [sourceRoot, '--apply']);

    const file = join(home, 'mcp.json');
    expect(existsSync(file)).toBe(true);
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as {
      mcpServers: Record<string, { command: string; env: Record<string, string> }>;
    };
    expect(parsed.mcpServers['github']?.command).toBe('npx');
    expect(parsed.mcpServers['github']?.env).toEqual({ GITHUB_TOKEN: 'ghp_super_secret' });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(captured.stdout).toContain('Configured 1 MCP server(s)');
    expect(captured.stdout).not.toContain('ghp_super_secret');
  });

  it('keeps other keys in an existing mcp.json and skips a configured server', async () => {
    writeFileSync(
      join(home, 'mcp.json'),
      JSON.stringify({ other: true, mcpServers: { github: { command: 'old' } } }),
    );
    const { deps, captured } = mcpHarness();

    await run(deps, [sourceRoot, '--apply']);

    const parsed = JSON.parse(readFileSync(join(home, 'mcp.json'), 'utf8')) as {
      other: boolean;
      mcpServers: Record<string, { command: string }>;
    };
    expect(parsed.other).toBe(true);
    expect(parsed.mcpServers['github']?.command).toBe('old');
    expect(captured.stdout).toContain('already configured');

    const forced = mcpHarness();
    await run(forced.deps, [sourceRoot, '--apply', '--force']);
    const after = JSON.parse(readFileSync(join(home, 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { command: string }>;
    };
    expect(after.mcpServers['github']?.command).toBe('npx');
  });

  it('refuses to overwrite an mcp.json it cannot parse', async () => {
    writeFileSync(join(home, 'mcp.json'), '{ not json');
    const { deps, captured } = mcpHarness();

    await run(deps, [sourceRoot, '--apply']);

    expect(captured.exitCode).toBe(1);
    expect(captured.stdout).toContain('refusing to overwrite it');
    expect(readFileSync(join(home, 'mcp.json'), 'utf8')).toBe('{ not json');
  });
});
