/**
 * `omnicode import` — preview what a Claude Code, Codex, or Qwen Code install
 * holds, using the adapters in `@hilbras/omnicode-migration`.
 *
 * Read-only on purpose. The adapters produce a normalized bundle, but nothing
 * decides where agents and skills land in the OmniCode home or what an
 * overwrite means, so this command reports instead of copying into a directory
 * no loader reads.
 */

import { homedir } from 'node:os';
import { resolve } from 'node:path';

import {
  detectImportSources,
  readImportBundle,
  type ImportBundle,
  type ImportedSource,
} from '@hilbras/omnicode-migration';
import { Command } from 'commander';

import { applyImportedSkills, renderApplyReport } from './import-apply';
import { getDataDir } from '#/utils/paths';

export const IMPORT_SOURCES: readonly ImportedSource[] = ['claude-code', 'codex', 'qwen'];

const SOURCE_LABELS: Readonly<Record<ImportedSource, string>> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  qwen: 'Qwen Code',
};

const MAX_WARNINGS = 10;

export interface ImportCommandDeps {
  readonly detect: (root: string) => Promise<readonly ImportedSource[]>;
  readonly read: (source: ImportedSource, root: string) => Promise<ImportBundle>;
  readonly homeDir: () => string;
  readonly targetHomeDir: () => string;
  readonly apply: typeof applyImportedSkills;
  readonly write: (chunk: string) => void;
  readonly setExitCode: (code: number) => void;
}

function defaultDeps(): ImportCommandDeps {
  return {
    detect: detectImportSources,
    read: readImportBundle,
    homeDir: homedir,
    targetHomeDir: getDataDir,
    apply: applyImportedSkills,
    write: (chunk) => {
      process.stdout.write(chunk);
    },
    setExitCode: (code) => {
      process.exitCode = code;
    },
  };
}

export function isImportSource(value: string): value is ImportedSource {
  return (IMPORT_SOURCES as readonly string[]).includes(value);
}

export function renderImportPreview(root: string, bundle: ImportBundle): string {
  const lines = [
    `${SOURCE_LABELS[bundle.source]} install: ${root}`,
    `  agents:   ${String(bundle.agents.length)}`,
    `  skills:   ${String(bundle.skills.length)}`,
    `  mcp:      ${String(Object.keys(bundle.config.mcpServers ?? {}).length)} server(s)`,
  ];
  if (bundle.agents.length > 0) {
    lines.push(`  agent names: ${bundle.agents.map((agent) => agent.name).join(', ')}`);
  }
  if (bundle.skills.length > 0) {
    lines.push(`  skill names: ${bundle.skills.map((skill) => skill.name).join(', ')}`);
  }
  if (bundle.warnings.length > 0) {
    lines.push(`  warnings: ${String(bundle.warnings.length)}`);
    for (const warning of bundle.warnings.slice(0, MAX_WARNINGS)) {
      lines.push(`    - ${warning.code} at ${warning.sourcePath}: ${warning.message}`);
    }
    if (bundle.warnings.length > MAX_WARNINGS) {
      lines.push(`    - … ${String(bundle.warnings.length - MAX_WARNINGS)} more`);
    }
  }
  lines.push('');
  lines.push('Preview only: nothing was written. Installing these needs a target layout');
  lines.push('(where agents and skills land, and what an overwrite means) before it can copy.');
  return `${lines.join('\n')}\n`;
}

function redactBundle(bundle: ImportBundle): ImportBundle {
  const servers = bundle.config.mcpServers;
  if (servers === undefined) return bundle;
  const redacted = Object.fromEntries(
    Object.entries(servers).map(([name, server]) => [
      name,
      server.env === undefined
        ? server
        : { ...server, env: Object.fromEntries(Object.keys(server.env).map((key) => [key, '<redacted>'])) },
    ]),
  );
  return { ...bundle, config: { ...bundle.config, mcpServers: redacted } };
}

export function registerImportCommand(
  program: Command,
  deps: ImportCommandDeps = defaultDeps(),
): void {
  program
    .command('import')
    .description('Preview agents, skills, and MCP servers from a Claude Code, Codex, or Qwen Code install.')
    .argument('[root]', 'install directory to read; defaults to your home directory')
    .option('--source <source>', `one of ${IMPORT_SOURCES.join(', ')} (auto-detected when omitted)`)
    .option('--json', 'print the parsed bundle as JSON (MCP env values are redacted)')
    .option('--apply', 'install the skills into this home instead of only reporting them')
    .option('--force', 'with --apply, replace a skill directory that already exists')
    .action(
      async (
        rootArgument: string | undefined,
        options: { source?: string; json?: boolean; apply?: boolean; force?: boolean },
      ) => {
        if (options.apply === true && options.json === true) {
          deps.write('Choose one of --json (report) or --apply (install); they do not combine.\n');
          deps.setExitCode(1);
          return;
        }
      const root = resolve(rootArgument ?? deps.homeDir());
      let source: ImportedSource;
      if (options.source !== undefined) {
        if (!isImportSource(options.source)) {
          deps.write(
            `Unknown source "${options.source}". Choose one of ${IMPORT_SOURCES.join(', ')}.\n`,
          );
          deps.setExitCode(1);
          return;
        }
        source = options.source;
      } else {
        const detected = await deps.detect(root);
        if (detected.length === 0) {
          deps.write(
            `No Claude Code, Codex, or Qwen Code install found at ${root}.\n` +
              'Pass a directory, or --source with the tool that produced it.\n',
          );
          deps.setExitCode(1);
          return;
        }
        const [only] = detected;
        if (detected.length > 1 || only === undefined) {
          deps.write(
            `More than one tool's layout matches ${root}: ${detected.join(', ')}.\n` +
              'Pass --source to choose.\n',
          );
          deps.setExitCode(1);
          return;
        }
        source = only;
      }

      let bundle: ImportBundle;
      try {
        bundle = await deps.read(source, root);
      } catch (error) {
        deps.write(`Could not read ${source} at ${root}: ${error instanceof Error ? error.message : String(error)}\n`);
        deps.setExitCode(1);
        return;
      }

      if (options.apply === true) {
        const targetHome = deps.targetHomeDir();
        try {
          const result = await deps.apply(bundle, { homeDir: targetHome, force: options.force === true });
          deps.write(renderApplyReport(result, targetHome));
          if (bundle.agents.length > 0) {
            deps.write(
              `Found ${String(bundle.agents.length)} agent file(s); this runtime builds agents from ` +
                'profiles and session state, so there is no user agent directory to install them into.\n',
            );
          }
        } catch (error) {
          deps.write(
            `Could not install skills into ${targetHome}: ${error instanceof Error ? error.message : String(error)}\n`,
          );
          deps.setExitCode(1);
        }
        return;
      }

      deps.write(
        options.json === true
          ? `${JSON.stringify(redactBundle(bundle), null, 2)}\n`
          : renderImportPreview(root, bundle),
      );
    });
}
