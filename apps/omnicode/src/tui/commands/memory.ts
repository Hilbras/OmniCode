import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type {
  MemoryControlScope,
  MemoryControlStatus,
  MemoryControlMutation,
  MemoryExportView,
  MemoryListView,
  MemoryView,
} from '@hilbras/omnicode-api';

import { toTerminalHyperlink } from '#/utils/terminal-hyperlink';
import { formatErrorMessage } from '../utils/event-payload';
import type { SlashCommandHost } from './dispatch';

const MEMORY_DISABLED_MESSAGE =
  'Memory is disabled. Enable the experimental memory flag (OMNICODE_EXPERIMENTAL_MEMORY=1) to manage memories.';
const MEMORY_NOT_FOUND_MESSAGE = 'Memory not found, or not visible to this session.';
const LIST_CONTENT_CHARS = 70;

const SCOPES: readonly MemoryControlScope[] = ['global', 'workspace', 'repository', 'session'];
const STATUSES: readonly MemoryControlStatus[] = [
  'active',
  'superseded',
  'expired',
  'invalidated',
  'all',
];

type ParsedMemoryCommand =
  | {
      readonly action: 'list';
      readonly scope?: MemoryControlScope;
      readonly status?: MemoryControlStatus;
    }
  | { readonly action: 'show' | 'confirm'; readonly id: string }
  | { readonly action: 'forget'; readonly id: string; readonly reason?: string }
  | { readonly action: 'export'; readonly path?: string };

export function parseMemoryCommand(rawArgs: string): ParsedMemoryCommand | { readonly error: string } {
  const trimmed = rawArgs.trim();
  const tokens = trimmed.length === 0 ? [] : trimmed.split(/\s+/);
  const [head, ...rest] = tokens;
  if (head === undefined || head === 'list') {
    const scope = rest.find((token) => SCOPES.includes(token as MemoryControlScope));
    const status = rest.find((token) => STATUSES.includes(token as MemoryControlStatus));
    const unknown = rest.find(
      (token) =>
        !SCOPES.includes(token as MemoryControlScope) && !STATUSES.includes(token as MemoryControlStatus),
    );
    if (unknown !== undefined) {
      return {
        error: `Unknown filter "${unknown}". Scopes: ${SCOPES.join(', ')}. Statuses: ${STATUSES.join(', ')}.`,
      };
    }
    return {
      action: 'list',
      scope: scope as MemoryControlScope | undefined,
      status: status as MemoryControlStatus | undefined,
    };
  }
  if (head === 'export') {
    return { action: 'export', path: rest.join(' ') || undefined };
  }
  if (head === 'show' || head === 'confirm' || head === 'forget') {
    const id = rest[0];
    if (id === undefined) {
      return { error: `Usage: /memory ${head} <id>` };
    }
    if (head === 'forget') {
      return { action: 'forget', id, reason: rest.slice(1).join(' ') || undefined };
    }
    return { action: head, id };
  }
  return {
    error: `Unknown subcommand "${head}". Usage: /memory [list [scope] [status] | show <id> | confirm <id> | forget <id> [reason] | export [path]]`,
  };
}

export async function handleMemoryCommand(host: SlashCommandHost, args: string): Promise<void> {
  const parsed = parseMemoryCommand(args);
  if ('error' in parsed) {
    host.showError(parsed.error);
    return;
  }

  const session = host.session ?? (await host.ensureSession());
  if (session === undefined) return;

  try {
    switch (parsed.action) {
      case 'list':
        renderList(host, await session.listMemories({ scope: parsed.scope, status: parsed.status }));
        return;
      case 'show':
        renderShow(host, await session.getMemory(parsed.id));
        return;
      case 'confirm':
        renderMutation(host, 'confirmed', await session.confirmMemory(parsed.id));
        return;
      case 'forget':
        renderMutation(host, 'forgotten', await session.forgetMemory(parsed.id, parsed.reason));
        return;
      case 'export':
        await exportMemories(host, await session.exportMemories(), parsed.path);
        return;
    }
  } catch (error) {
    host.showError(`Memory command failed: ${formatErrorMessage(error)}`);
  }
}

function truncateContent(content: string): string {
  const singleLine = content.replaceAll(/\s+/g, ' ').trim();
  if (singleLine.length <= LIST_CONTENT_CHARS) return singleLine;
  return `${singleLine.slice(0, LIST_CONTENT_CHARS - 1)}…`;
}

function describeScope(memory: MemoryView): string {
  const scope = memory.scope;
  const parts: string[] = [scope.tier];
  if (scope.projectId !== undefined) parts.push(scope.projectId.slice(0, 8));
  if (scope.tier === 'session' && scope.sessionId !== undefined) parts.push(scope.sessionId.slice(0, 8));
  return parts.join(':');
}

function describeTrust(memory: MemoryView): string {
  return memory.suspicious ? `${memory.trust} (flagged)` : memory.trust;
}

function renderList(host: SlashCommandHost, listed: MemoryListView): void {
  if (!listed.enabled) {
    host.showError(MEMORY_DISABLED_MESSAGE);
    return;
  }
  if (listed.memories.length === 0) {
    host.showNotice('No memories', 'Nothing has been saved for this session yet.');
    return;
  }
  const lines = listed.memories.map(
    (memory) =>
      `${memory.id}  ${describeScope(memory)}  ${describeTrust(memory)}  ${memory.category}  ${truncateContent(memory.content)}`,
  );
  if (listed.truncated) lines.push('… more memories exist; narrow the list with /memory list <scope>.');
  host.showNotice(`Memories (${String(listed.memories.length)})`, lines.join('\n'));
}

function renderShow(host: SlashCommandHost, view: { enabled: boolean; memory?: MemoryView }): void {
  if (!view.enabled) {
    host.showError(MEMORY_DISABLED_MESSAGE);
    return;
  }
  const memory = view.memory;
  if (memory === undefined) {
    host.showError(MEMORY_NOT_FOUND_MESSAGE);
    return;
  }
  const lines = [
    memory.content,
    '',
    `id: ${memory.id}`,
    `scope: ${describeScope(memory)}`,
    `tier: ${memory.tier}   category: ${memory.category}`,
    `trust: ${describeTrust(memory)} (${memory.trustReason})`,
    `origin: ${memory.origin}   source: ${memory.sourceType}`,
    `lifecycle: ${memory.lifecycle}`,
    `updated: ${new Date(memory.updatedAt).toISOString()}`,
  ];
  if (memory.subject !== undefined) lines.push(`subject: ${memory.subject}`);
  if (memory.supersededBy !== undefined) lines.push(`superseded by: ${memory.supersededBy}`);
  if (memory.conflictsWith.length > 0) lines.push(`conflicts with: ${memory.conflictsWith.join(', ')}`);
  if (memory.evidence.length > 0) {
    lines.push(
      `evidence: ${memory.evidence.map((item) => `${item.kind} ${item.ref} (${item.state})`).join('; ')}`,
    );
  }
  if (memory.suspicious) lines.push(`flagged: ${memory.suspicionReasons.join(', ')}`);
  host.showNotice('Memory', lines.join('\n'));
}

function renderMutation(
  host: SlashCommandHost,
  action: 'confirmed' | 'forgotten',
  mutation: MemoryControlMutation,
): void {
  switch (mutation.status) {
    case 'confirmed':
    case 'forgotten':
      host.showNotice(
        action === 'confirmed' ? 'Memory confirmed' : 'Memory forgotten',
        mutation.memory === undefined
          ? undefined
          : `${mutation.memory.id}\n${truncateContent(mutation.memory.content)}`,
      );
      return;
    case 'unchanged':
      host.showNotice('Memory unchanged', mutation.reason ?? 'It is already trusted.');
      return;
    case 'not_found':
      host.showError(MEMORY_NOT_FOUND_MESSAGE);
      return;
    case 'not_active':
      host.showError('Memory is not active. Run /memory list to see the current state.');
      return;
    case 'disabled':
      host.showError(MEMORY_DISABLED_MESSAGE);
      return;
    case 'rejected':
    case 'failed':
      host.showError(`Memory update failed: ${mutation.reason ?? mutation.status}`);
      return;
  }
}

async function exportMemories(
  host: SlashCommandHost,
  exported: MemoryExportView,
  requestedPath: string | undefined,
): Promise<void> {
  if (!exported.enabled) {
    host.showError(MEMORY_DISABLED_MESSAGE);
    return;
  }
  const now = new Date();
  const timestamp = now.toISOString().replaceAll(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const outputPath =
    requestedPath === undefined
      ? resolve(host.state.appState.workDir, `omnicode-memory-export-${timestamp}.json`)
      : resolve(requestedPath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({ ...exported, exportedAt: now.getTime() }, null, 2)}\n`,
    'utf-8',
  );
  const linked = toTerminalHyperlink(outputPath, pathToFileURL(outputPath).href);
  host.showNotice(`Exported ${String(exported.memories.length)} memories`, linked);
}
