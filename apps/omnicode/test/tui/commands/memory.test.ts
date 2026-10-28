import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it, vi } from 'vitest';

import type { MemoryControlMutation, MemoryView, Session } from '@hilbras/omnicode-api';

import { handleMemoryCommand, parseMemoryCommand } from '#/tui/commands/memory';
import type { SlashCommandHost } from '#/tui/commands/dispatch';

function memoryView(overrides: Partial<MemoryView> = {}): MemoryView {
  return {
    id: 'mem_0001',
    content: 'the dev server runs on port 4310',
    category: 'observation',
    tier: 'working',
    trust: 'unverified',
    trustReason: 'model observation',
    origin: 'model',
    sourceType: 'agent_observation',
    scope: { tier: 'session', workspaceId: 'w-1', projectId: '0123456789abcdef', sessionId: 's-1' },
    lifecycle: 'active',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    conflictsWith: [],
    suspicious: false,
    suspicionReasons: [],
    redactionCount: 0,
    evidence: [],
    ...overrides,
  };
}

function makeHost(session: Record<string, unknown>, hasSession = true) {
  const host = {
    state: { appState: { workDir: tmpdir() } },
    session: hasSession ? (session as unknown as Session) : undefined,
    ensureSession: vi.fn(async () => session as unknown as Session),
    showError: vi.fn(),
    showStatus: vi.fn(),
    showNotice: vi.fn(),
  } as unknown as SlashCommandHost;
  return host;
}

const exports: string[] = [];
afterAll(() => {
  for (const dir of exports) rmSync(dir, { recursive: true, force: true });
});

describe('parseMemoryCommand', () => {
  it('defaults to listing every visible scope', () => {
    expect(parseMemoryCommand('')).toEqual({ action: 'list', scope: undefined, status: undefined });
    expect(parseMemoryCommand('list')).toEqual({ action: 'list', scope: undefined, status: undefined });
  });

  it('parses scope and status filters in any order', () => {
    expect(parseMemoryCommand('list repository')).toEqual({
      action: 'list',
      scope: 'repository',
      status: undefined,
    });
    expect(parseMemoryCommand('list repository invalidated')).toEqual({
      action: 'list',
      scope: 'repository',
      status: 'invalidated',
    });
    expect(parseMemoryCommand('list all')).toEqual({ action: 'list', scope: undefined, status: 'all' });
  });

  it('parses the mutation subcommands', () => {
    expect(parseMemoryCommand('show mem_1')).toEqual({ action: 'show', id: 'mem_1' });
    expect(parseMemoryCommand('confirm mem_1')).toEqual({ action: 'confirm', id: 'mem_1' });
    expect(parseMemoryCommand('forget mem_1 stale fact')).toEqual({
      action: 'forget',
      id: 'mem_1',
      reason: 'stale fact',
    });
    expect(parseMemoryCommand('export')).toEqual({ action: 'export', path: undefined });
    expect(parseMemoryCommand('export out/memories.json')).toEqual({
      action: 'export',
      path: 'out/memories.json',
    });
  });

  it('rejects unknown filters, missing ids and unknown subcommands', () => {
    expect(parseMemoryCommand('list bogus')).toHaveProperty('error');
    expect(parseMemoryCommand('show')).toHaveProperty('error');
    expect(parseMemoryCommand('confirm')).toHaveProperty('error');
    expect(parseMemoryCommand('nope')).toHaveProperty('error');
  });
});

describe('handleMemoryCommand', () => {
  it('renders the visible memories with scope and trust', async () => {
    const host = makeHost({
      listMemories: vi.fn(async () => ({ enabled: true, memories: [memoryView()], truncated: false })),
    });

    await handleMemoryCommand(host, '');

    expect(host.showNotice).toHaveBeenCalledWith(
      'Memories (1)',
      expect.stringContaining('mem_0001  session:01234567:s-1  unverified  observation'),
    );
    expect(host.showError).not.toHaveBeenCalled();
  });

  it('says so when memory is disabled', async () => {
    const host = makeHost({
      listMemories: vi.fn(async () => ({ enabled: false, memories: [], truncated: false })),
    });

    await handleMemoryCommand(host, 'list');

    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('OMNICODE_EXPERIMENTAL_MEMORY'));
  });

  it('reports an empty list without inventing memories', async () => {
    const host = makeHost({
      listMemories: vi.fn(async () => ({ enabled: true, memories: [], truncated: false })),
    });

    await handleMemoryCommand(host, 'list');

    expect(host.showNotice).toHaveBeenCalledWith('No memories', expect.any(String));
  });

  it('shows one memory with its provenance', async () => {
    const host = makeHost({ getMemory: vi.fn(async () => ({ enabled: true, memory: memoryView() })) });

    await handleMemoryCommand(host, 'show mem_0001');

    const detail = vi.mocked(host.showNotice).mock.calls[0]?.[1] ?? '';
    expect(detail).toContain('the dev server runs on port 4310');
    expect(detail).toContain('trust: unverified (model observation)');
    expect(detail).toContain('id: mem_0001');
  });

  it('reports a memory that is not visible to this session', async () => {
    const host = makeHost({ getMemory: vi.fn(async () => ({ enabled: true })) });

    await handleMemoryCommand(host, 'show mem_missing');

    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('confirms a memory and reports the promotion', async () => {
    const mutation: MemoryControlMutation = {
      status: 'confirmed',
      memory: memoryView({ trust: 'trusted', trustReason: 'user confirmation' }),
    };
    const session = { confirmMemory: vi.fn(async () => mutation) };
    const host = makeHost(session);

    await handleMemoryCommand(host, 'confirm mem_0001');

    expect(session.confirmMemory).toHaveBeenCalledWith('mem_0001');
    expect(host.showNotice).toHaveBeenCalledWith('Memory confirmed', expect.stringContaining('mem_0001'));
  });

  it('reports an unchanged confirmation instead of claiming success', async () => {
    const host = makeHost({
      confirmMemory: vi.fn(async () => ({ status: 'unchanged', memory: memoryView({ trust: 'trusted' }) })),
    });

    await handleMemoryCommand(host, 'confirm mem_0001');

    expect(host.showNotice).toHaveBeenCalledWith('Memory unchanged', expect.any(String));
    expect(host.showNotice).not.toHaveBeenCalledWith('Memory confirmed', expect.anything());
  });

  it('passes the reason when forgetting', async () => {
    const session = {
      forgetMemory: vi.fn(async () => ({ status: 'forgotten', memory: memoryView({ lifecycle: 'invalidated' }) })),
    };
    const host = makeHost(session);

    await handleMemoryCommand(host, 'forget mem_0001 no longer true');

    expect(session.forgetMemory).toHaveBeenCalledWith('mem_0001', 'no longer true');
    expect(host.showNotice).toHaveBeenCalledWith('Memory forgotten', expect.stringContaining('mem_0001'));
  });

  it('surfaces a rejected mutation as an error', async () => {
    const host = makeHost({
      forgetMemory: vi.fn(async () => ({ status: 'rejected', reason: 'memory is canonical' })),
    });

    await handleMemoryCommand(host, 'forget mem_0001');

    expect(host.showError).toHaveBeenCalledWith(expect.stringContaining('memory is canonical'));
  });

  it('writes the export to a file and links it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'omnicode-memory-export-'));
    exports.push(dir);
    const target = join(dir, 'memories.json');
    const host = makeHost({
      exportMemories: vi.fn(async () => ({
        enabled: true,
        format: 'omnicode.memory.export' as const,
        version: 1 as const,
        exportedAt: 1_700_000_000_000,
        truncated: false,
        memories: [memoryView()],
      })),
    });

    await handleMemoryCommand(host, `export ${target}`);

    const written = JSON.parse(readFileSync(target, 'utf-8')) as { memories: MemoryView[] };
    expect(written.memories).toHaveLength(1);
    expect(written.memories[0]?.id).toBe('mem_0001');
    expect(host.showNotice).toHaveBeenCalledWith('Exported 1 memories', expect.any(String));
  });
});
