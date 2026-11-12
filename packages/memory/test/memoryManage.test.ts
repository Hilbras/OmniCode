import { describe, expect, it } from 'vitest';

import type { IAgentMemoryContextService } from '#/context/agentMemoryContextService';
import type { IMemoryService } from '#/contracts/memoryContract';
import { MEMORY_MANAGE_DESCRIPTION, MemoryManageTool } from '#/tool/memoryManageTool';

const record = (id: string, sensitivity: string, content: string) => ({
  id,
  content,
  tier: 'distilled',
  category: 'fact',
  trust: 'unverified',
  sensitivity,
  lifecycle: 'active',
  subject: 'subject',
});

function runtime() {
  const service = {
    enabled: true,
    list: async () => [
      record('mem_public', 'internal', 'public content'),
      record('mem_secret', 'secret', 'secret content'),
    ],
    dreamConsolidate: async () => ({
      status: 'completed',
      scope: { tier: 'repository' },
      scanned: 0,
      groups: 0,
      consolidated: 0,
      superseded: 0,
      skipped: 0,
      ids: [],
    }),
  } as unknown as IMemoryService;
  const memory = {
    scopeFor: async () => ({ tier: 'repository', projectId: 'p' }),
    workspaceId: () => 'w',
    projectId: async () => 'p',
    sessionId: () => 's',
  } as unknown as IAgentMemoryContextService;
  return new MemoryManageTool(memory, service);
}

const context = { turnId: 1, toolCallId: 'call_memory_manage', signal: new AbortController().signal };

describe('memory_manage', () => {
  it('renders real newlines in its description', () => {
    expect(MEMORY_MANAGE_DESCRIPTION).toContain('\n');
    expect(MEMORY_MANAGE_DESCRIPTION).not.toContain('\\n');
  });

  it('lists metadata without content and redacts secret records', async () => {
    const execution = runtime().resolveExecution({ action: 'list', scope: 'repository' });
    if (!('execute' in execution)) throw new Error('expected executable execution');
    const result = await execution.execute(context);
    expect(result.isError).toBe(false);
    expect(result.output).toContain('memory manage status: list\n');
    expect(result.output).toContain('mem_public');
    expect(result.output).not.toContain('mem_secret');
    expect(result.output).not.toContain('public content');
    expect(result.output).not.toContain('secret content');
    expect(result.output).toContain('redacted=1');
  });

  it('reports dream consolidation counts with real newlines', async () => {
    const execution = runtime().resolveExecution({ action: 'dream', scope: 'repository' });
    if (!('execute' in execution)) throw new Error('expected executable execution');
    const result = await execution.execute(context);
    expect(result.isError).toBe(false);
    expect(result.output).toContain('memory manage status: completed\n');
    expect(result.output).not.toContain('\\n');
  });
});
