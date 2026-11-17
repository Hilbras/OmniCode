import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  detectImportSources,
  readImportBundle,
  type ImportBundle,
} from '@hilbras/omnicode-migration';
import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { registerImportCommand, type ImportCommandDeps } from '#/cli/sub/import';

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
    expect(flags).toEqual(['--source', '--json']);
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
    expect(captured.stdout).toContain('Preview only: nothing was written');
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
