import { resolve } from 'node:path';

import type { BashSyntaxNode, IBashParserService } from '#/app/bashParser/bashParser';

export type ShellOperationKind = 'read' | 'write' | 'delete' | 'fetch';

export interface ShellOperation {
  readonly kind: ShellOperationKind;
  readonly path?: string;
  readonly resolvedPath?: string;
  readonly url?: string;
}

const READ_COMMANDS: ReadonlySet<string> = new Set([
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'grep',
  'rg',
  'awk',
  'sed',
  'sort',
  'uniq',
  'cut',
  'tr',
  'wc',
  'stat',
  'file',
  'strings',
  'xxd',
  'od',
  'base64',
  'jq',
  'diff',
  'comm',
]);
const PATTERN_FIRST: ReadonlySet<string> = new Set(['grep', 'rg', 'awk', 'sed', 'jq']);
const COPY_COMMANDS: ReadonlySet<string> = new Set(['cp', 'mv', 'install', 'ln']);
const WRITE_COMMANDS: ReadonlySet<string> = new Set([
  'tee',
  'touch',
  'mkdir',
  'mkdirp',
  'truncate',
  'chmod',
  'chown',
]);
const DELETE_COMMANDS: ReadonlySet<string> = new Set(['rm', 'rmdir', 'unlink']);
const FETCH_COMMANDS: ReadonlySet<string> = new Set(['curl', 'wget']);
const URL_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//i;

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'") && first === last) return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isUrl(value: string): boolean {
  return URL_PATTERN.test(value);
}

function commandName(node: BashSyntaxNode): string | undefined {
  const nameNode = node.children.find((child) => child.type === 'command_name');
  const word = nameNode?.children.find((child) => child.isNamed);
  const name = unquote(word?.text ?? '');
  return name.length === 0 ? undefined : (name.split(/[\\/]/).pop() ?? name).toLowerCase();
}

function argsOf(node: BashSyntaxNode): string[] {
  const nameIndex = node.children.findIndex((child) => child.type === 'command_name');
  if (nameIndex === -1) return [];
  const args: string[] = [];
  for (const child of node.children.slice(nameIndex + 1)) {
    if (child.type === 'variable_assignment') continue;
    if (child.type.toLowerCase().includes('redirect')) continue;
    const value = unquote(child.text);
    if (value.length > 0) args.push(value);
  }
  return args;
}

function withoutOptions(args: readonly string[]): string[] {
  return args.filter((arg) => arg !== '-' && !arg.startsWith('-'));
}

function operationFor(
  kind: ShellOperationKind,
  raw: string,
  cwd: string | undefined,
): ShellOperation | undefined {
  if (raw.length === 0 || raw === '-' || isUrl(raw) || raw.startsWith('&')) return undefined;
  const path = raw;
  return {
    kind,
    path,
    ...(cwd !== undefined ? { resolvedPath: resolve(cwd, raw) } : {}),
  };
}

function collectCommandNodes(node: BashSyntaxNode, out: BashSyntaxNode[]): void {
  if (node.type === 'command') out.push(node);
  for (const child of node.children) collectCommandNodes(child, out);
}

function collectRedirectOperations(
  node: BashSyntaxNode,
  cwd: string | undefined,
  out: ShellOperation[],
): void {
  if (node.type.toLowerCase().includes('redirect')) {
    const match = /^\d*(>>|>|<)\s*(.+)$/.exec(node.text.trim());
    if (match !== null) {
      const kind: ShellOperationKind = match[1] === '<' ? 'read' : 'write';
      const operation = operationFor(kind, unquote(match[2] ?? ''), cwd);
      if (operation !== undefined) out.push(operation);
    }
  }
  for (const child of node.children) collectRedirectOperations(child, cwd, out);
}

function readPaths(name: string, args: readonly string[]): string[] {
  const values = withoutOptions(args);
  if (PATTERN_FIRST.has(name) && values.length > 0) return values.slice(1);
  return values;
}

function operationsForCommand(
  name: string,
  args: readonly string[],
  cwd: string | undefined,
  out: ShellOperation[],
): void {
  if (READ_COMMANDS.has(name)) {
    const writing = name === 'sed' && args.some((arg) => arg === '-i' || arg.startsWith('-i'));
    for (const raw of readPaths(name, args)) {
      const read = operationFor('read', raw, cwd);
      if (read !== undefined) out.push(read);
      if (writing) {
        const write = operationFor('write', raw, cwd);
        if (write !== undefined) out.push(write);
      }
    }
    return;
  }
  if (COPY_COMMANDS.has(name)) {
    const values = withoutOptions(args);
    const target = values.at(-1);
    for (const raw of values.slice(0, -1)) {
      const read = operationFor('read', raw, cwd);
      if (read !== undefined) out.push(read);
    }
    if (target !== undefined) {
      const write = operationFor('write', target, cwd);
      if (write !== undefined) out.push(write);
    }
    return;
  }
  if (WRITE_COMMANDS.has(name)) {
    for (const raw of withoutOptions(args)) {
      const write = operationFor('write', raw, cwd);
      if (write !== undefined) out.push(write);
    }
    return;
  }
  if (DELETE_COMMANDS.has(name)) {
    for (const raw of withoutOptions(args)) {
      const operation = operationFor('delete', raw, cwd);
      if (operation !== undefined) out.push(operation);
    }
    return;
  }
  if (FETCH_COMMANDS.has(name)) {
    const outputFlags = name === 'curl' ? ['-o', '--output'] : ['-O', '--output-document'];
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index]!;
      if (outputFlags.includes(arg)) {
        const target = args[index + 1];
        if (target !== undefined) {
          const write = operationFor('write', target, cwd);
          if (write !== undefined) out.push(write);
        }
        index += 1;
        continue;
      }
      if (arg.startsWith('--output=')) {
        const write = operationFor('write', arg.slice('--output='.length), cwd);
        if (write !== undefined) out.push(write);
        continue;
      }
      if (isUrl(arg)) out.push({ kind: 'fetch', url: arg });
    }
    return;
  }
  if (name === 'dd') {
    for (const arg of args) {
      if (arg.startsWith('of=')) {
        const write = operationFor('write', arg.slice(3), cwd);
        if (write !== undefined) out.push(write);
      } else if (arg.startsWith('if=')) {
        const read = operationFor('read', arg.slice(3), cwd);
        if (read !== undefined) out.push(read);
      }
    }
  }
}

export function extractShellOperations(
  command: string,
  parser: IBashParserService,
  cwd?: string,
): readonly ShellOperation[] {
  const parsed = parser.parse(command, { timeoutMs: 500, maxNodes: 10_000 });
  if (!parsed.ok || parsed.hasError) return [];

  const commands: BashSyntaxNode[] = [];
  collectCommandNodes(parsed.root, commands);
  const operations: ShellOperation[] = [];
  collectRedirectOperations(parsed.root, cwd, operations);
  for (const node of commands) {
    const name = commandName(node);
    if (name === undefined) continue;
    operationsForCommand(name, argsOf(node), cwd, operations);
  }

  const seen = new Set<string>();
  return operations.filter((operation) => {
    const key = `${operation.kind}:${operation.path ?? operation.url ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
