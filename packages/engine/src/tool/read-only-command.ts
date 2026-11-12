import type { BashSyntaxNode, IBashParserService } from '#/app/bashParser/bashParser';
import type { ToolAccesses, ToolResourceAccess } from '#/tool/toolContract';

/** Tools whose execution cannot observe or mutate workspace state beyond reads. */
export const READ_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  'Read',
  'Grep',
  'Glob',
  'ReadMediaFile',
  'TaskList',
  'TaskOutput',
  'CronList',
  'Lsp',
  'WorktreeList',
  'TaskBoardList',
  'TeamList',
  'memory_search',
]);

export const READ_ONLY_BASH_COMMANDS: ReadonlySet<string> = new Set<string>([
  'ls',
  'cat',
  'grep',
  'find',
  'pwd',
  'which',
  'head',
  'tail',
  'wc',
  'stat',
  'file',
  'du',
  'df',
  'tree',
  'sort',
  'uniq',
  'cut',
  'tr',
  'echo',
  'printf',
  'git',
]);

const LAUNCH_WRAPPERS = new Set<string>(['env', 'command', 'exec', 'nohup', 'builtin', 'nice']);
const PRIVILEGE_WRAPPERS = new Set<string>(['sudo', 'doas']);
const LAUNCH_VALUE_OPTIONS = new Set<string>([
  '-u',
  '--unset',
  '-C',
  '--chdir',
  '-S',
  '--split-string',
  '-a',
  '-n',
  '--adjustment',
]);
const PRIVILEGE_VALUE_OPTIONS = new Set<string>(['-u', '--user', '-g', '--group']);

const READ_ONLY_GIT_SUBCOMMANDS = new Set<string>([
  'status',
  'diff',
  'log',
  'show',
  'rev-parse',
  'ls-files',
  'blame',
  'grep',
  'describe',
]);

export function isReadOnlyToolName(name: string): boolean {
  return READ_ONLY_TOOL_NAMES.has(name);
}

function isReadOperation(access: ToolResourceAccess): boolean {
  return access.kind === 'file' && (access.operation === 'read' || access.operation === 'search');
}

/**
 * True when a call cannot mutate anything the scheduler serializes: either the
 * tool is a known read-only tool, or every declared access is a plain read or
 * search. Tools that declare no accesses are classified by name only, so an
 * unknown tool is never treated as safe to overlap.
 */
export function isReadOnlyToolCall(name: string, accesses: ToolAccesses): boolean {
  if (isReadOnlyToolName(name)) return true;
  return accesses.length > 0 && accesses.every(isReadOperation);
}

function bashCommandText(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const command = (args as { readonly command?: unknown }).command;
  return typeof command === 'string' ? command : undefined;
}

function commandName(node: BashSyntaxNode): string | undefined {
  const nameNode = node.children.find((child) => child.type === 'command_name');
  const nameWord = nameNode?.children.find((child) => child.isNamed);
  return nameWord?.text.replace(/^['"]|['"]$/g, '');
}

function normalizeCommandName(name: string): string {
  return name.split(/[\\/]/).pop()?.toLowerCase() ?? name.toLowerCase();
}

function dropLeadingOptions(args: readonly string[], valueOptions: ReadonlySet<string>): readonly string[] {
  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;
    if (arg === '--') {
      i += 1;
      break;
    }
    if (!arg.startsWith('-')) break;
    if (valueOptions.has(arg) && i + 1 < args.length) {
      i += 2;
      continue;
    }
    const valueOption = [...valueOptions].find((option) => arg.startsWith(`${option}=`));
    if (valueOption) {
      i += 1;
      continue;
    }
    i += 1;
  }
  return args.slice(i);
}

function collectCommandNodes(node: BashSyntaxNode, out: BashSyntaxNode[]): void {
  if (node.type === 'command') out.push(node);
  for (const child of node.children) collectCommandNodes(child, out);
}

function invocationFromCommand(command: BashSyntaxNode): { name: string; args: string[] } | undefined {
  const nameIndex = command.children.findIndex((child) => child.type === 'command_name');
  const rawName = commandName(command);
  if (rawName === undefined || rawName.length === 0) return undefined;

  const args: string[] = [];
  for (const child of command.children.slice(nameIndex + 1)) {
    if (child.type === 'variable_assignment' || child.type === 'file_redirect' || child.type === 'heredoc_redirect') continue;
    const value = typeof child.text === 'string' ? child.text.trim() : '';
    if (value.length > 0) args.push(value);
  }

  let name = normalizeCommandName(rawName);
  let rest = args;
  if (PRIVILEGE_WRAPPERS.has(name)) {
    rest = [...dropLeadingOptions(rest, PRIVILEGE_VALUE_OPTIONS)];
    const inner = rest[0];
    if (inner === undefined) return undefined;
    return { name: normalizeCommandName(inner), args: rest.slice(1) };
  }
  if (name === 'env') {
    let i = 0;
    while (i < rest.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[i]!)) i += 1;
    rest = rest.slice(i);
    if (rest.length === 0) return undefined;
    name = normalizeCommandName(rest[0]!);
    rest = rest.slice(1);
  }
  if (LAUNCH_WRAPPERS.has(name)) {
    if (name === 'command') {
      for (const arg of rest) {
        if (arg === '--') break;
        if (arg === '-') continue;
        if (!arg.startsWith('-')) break;
        if (/[vV]/.test(arg)) return { name: 'command', args: rest };
      }
    }
    rest = [...dropLeadingOptions(rest, LAUNCH_VALUE_OPTIONS)];
    const inner = rest[0];
    if (inner === undefined) return undefined;
    return { name: normalizeCommandName(inner), args: rest.slice(1) };
  }
  return { name, args: rest };
}

function isReadOnlyGitInvocation(args: readonly string[]): boolean {
  const rest = dropLeadingOptions(args, new Set(['-C', '--git-dir', '--work-tree', '-c']));
  let i = 0;
  while (i < rest.length && rest[i]!.startsWith('-')) {
    const arg = rest[i]!;
    if (arg === '--no-pager' || arg === '--no-ext-diff') {
      i += 1;
      continue;
    }
    if ((arg === '-C' || arg === '--git-dir' || arg === '--work-tree' || arg === '-c') && i + 1 < rest.length) {
      i += 2;
      continue;
    }
    i += 1;
  }
  const subcommand = rest[i];
  if (subcommand === undefined) return true;
  if (!READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) return false;
  return true;
}

/**
 * Classifies a `Bash` call by parsing it and requiring every command in the
 * pipeline to be a known read-only verb with no redirection. Parse failures,
 * oversized scripts, and redirects all fail closed.
 */
export function isReadOnlyBashCommand(args: unknown, parser: IBashParserService): boolean {
  const command = bashCommandText(args);
  if (command === undefined) return false;

  const parsed = parser.parse(command, { timeoutMs: 500, maxNodes: 10_000 });
  if (!parsed.ok || parsed.hasError) return false;

  const commands: BashSyntaxNode[] = [];
  collectCommandNodes(parsed.root, commands);
  if (commands.length === 0) return false;

  let hasRedirect = false;
  const visit = (node: BashSyntaxNode): void => {
    if (node.type.toLowerCase().includes('redirect')) hasRedirect = true;
    for (const child of node.children) visit(child);
  };
  visit(parsed.root);
  if (hasRedirect) return false;
  return commands.every((commandNode) => {
    const invocation = invocationFromCommand(commandNode);
    if (invocation === undefined) return false;
    if (invocation.name === 'command' && invocation.args.some((arg) => arg === '-v' || arg === '-V' || arg === '--version')) {
      return true;
    }
    if (!READ_ONLY_BASH_COMMANDS.has(invocation.name)) return false;
    if (invocation.name === 'git') return isReadOnlyGitInvocation(invocation.args);
    return true;
  });
}
