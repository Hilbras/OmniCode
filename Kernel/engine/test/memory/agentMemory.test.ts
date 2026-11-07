import { IMemoryService, MEMORY_SEARCH_TOOL_NAME } from '@hilbras/omnicode-memory';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import { IAgentProfileService } from '#/agent/profile/profile';
import { CompactionCompleted } from '#/agent/fullCompaction/compactionOps';
import { IEventBus } from '#/app/event/eventBus';
import { IAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import { ISessionContext } from '#/session/sessionContext/sessionContext';

import { createTestAgent, permissionModeServices, type TestAgentContext } from '../harness';

const PROJECT = 'project-under-test';

describe('memory inside a real agent turn', () => {
  let ctx: TestAgentContext;

  beforeEach(async () => {
    process.env['OMNICODE_EXPERIMENTAL_MEMORY'] = 'true';
    ctx = createTestAgent(permissionModeServices('yolo'));
    await ctx.restorePersisted();
  });

  afterEach(async () => {
    delete process.env['OMNICODE_EXPERIMENTAL_MEMORY'];
    await ctx.dispose();
  });

  async function seed(content: string, ref: string, global = false): Promise<string> {
    const stored = await ctx.get(IMemoryService).capture({
      content,
      tier: 'distilled',
      category: 'fact',
      sourceType: 'repository_file',
      origin: 'application',
      scope: global ? { tier: 'global' } : { tier: 'repository', projectId: PROJECT },
      evidence: [{ kind: 'file', ref, state: 'present', fingerprint: `sha-${ref}`, observedAt: 1 }],
    });
    expect(['stored', 'deduplicated']).toContain(stored.status);
    return stored.id as string;
  }

  function contextText(): string {
    return ctx
      .get(IAgentContextMemoryService)
      .get()
      .map((message: { content: readonly { type: string; text?: string }[] }) =>
        message.content.map((part) => (part.type === 'text' ? (part.text ?? '') : '')).join(''),
      )
      .join('\n');
  }

  it('enables the feature and activates the search tool', () => {
    expect(ctx.get(IMemoryService).enabled).toBe(true);
    ctx.get(IAgentProfileService).update({ activeToolNames: [MEMORY_SEARCH_TOOL_NAME] });
    expect(ctx.get(IAgentProfileService).data().activeToolNames).toContain(MEMORY_SEARCH_TOOL_NAME);
  });

  it('stores and recalls through the real service inside the agent scope', async () => {
    await seed('the cli is bundled with tsup', 'package.json');
    const found = await ctx.get(IMemoryService).search({
      query: 'bundle the cli tsup',
      projectId: PROJECT,
    });
    expect(found.status).toBe('complete');
    expect(
      found.memories.some((entry: { record: { content: string } }) =>
        entry.record.content.startsWith('the cli is bundled with tsup'),
      ),
    ).toBe(true);
    expect(found.memories[0]?.explanation.trust).toBe('verified');
  });

  it('answers a real model tool call with the memory search output', async () => {
    await seed('the release process is documented in docs/release.md', 'docs/release.md', true);
    ctx.get(IAgentProfileService).update({ activeToolNames: [MEMORY_SEARCH_TOOL_NAME] });

    ctx.mockNextProviderResponse({
      parts: [
        {
          type: 'function',
          id: 'call-1',
          name: MEMORY_SEARCH_TOOL_NAME,
          arguments: JSON.stringify({ query: 'how is the release documented' }),
        },
      ],
      finishReason: 'tool_calls',
    });
    ctx.mockNextProviderResponse({
      parts: [{ type: 'text', text: 'It is documented in docs/release.md.' }],
    });

    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'how is the release documented' }] });
    await ctx.untilTurnEnd();

    const rendered = contextText();
    expect(rendered).toContain('memory search status:');
    expect(rendered).toContain('the release process is documented in docs/release.md');
    expect(rendered).toContain('provenance=file:docs/release.md');
  });

  it('captures a compaction summary as the session task state', async () => {
    const agentId = ctx.get(IAgentScopeContext).agentId;
    const sessionId = ctx.get(ISessionContext).sessionId;
    const memory = ctx.get(IMemoryService);

    ctx.get(IEventBus).publish(
      new CompactionCompleted({
        agentId,
        result: {
          summary: [
            '## Objective',
            '- Finish the memory upgrade plan.',
            '',
            '## Decisions',
            '- Store the summary as the session task state.',
            '',
            '## Work State',
            '### Completed',
            '- Added the user control surface.',
            '### Active',
            '- Capturing compaction summaries.',
            '### Blocked',
            '- (none)',
            '',
            '## Next Move',
            '1. Run the full suite.',
          ].join('\n'),
          compactedCount: 12,
          tokensBefore: 9000,
          tokensAfter: 1200,
        },
      }),
    );

    const deadline = Date.now() + 5000;
    let record = (await memory.list({ sessionId, categories: ['task'], lifecycle: ['active'] }))[0];
    while (record === undefined && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      record = (await memory.list({ sessionId, categories: ['task'], lifecycle: ['active'] }))[0];
    }
    expect(record).toBeDefined();

    const restored = await memory.restoreTaskState({
      taskId: sessionId,
      scope: record?.scope ?? { tier: 'session', workspaceId: ctx.get(ISessionContext).workspaceId, sessionId },
      objective: '',
      completed: [],
      decisions: [],
      failedAttempts: [],
      blockers: [],
      fileRefs: [],
    });
    expect(restored.status).toBe('restored');
    expect(restored.record?.content).toContain('Finish the memory upgrade plan.');
    expect(restored.record?.content).toContain('Run the full suite.');
    expect(restored.record?.trust).toBe('unverified');
  });

  it('writes no task state from a compaction while the flag is off', async () => {
    const agentId = ctx.get(IAgentScopeContext).agentId;
    const sessionId = ctx.get(ISessionContext).sessionId;
    const memory = ctx.get(IMemoryService);
    process.env['OMNICODE_EXPERIMENTAL_MEMORY'] = 'false';
    try {
      ctx.get(IEventBus).publish(
        new CompactionCompleted({
          agentId,
          result: {
            summary: '## Objective\n- Should not be stored.\n\n## Next Move\n1. Nothing.',
            compactedCount: 3,
            tokensBefore: 100,
            tokensAfter: 10,
          },
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await memory.list({ sessionId, categories: ['task'] })).toHaveLength(0);
    } finally {
      process.env['OMNICODE_EXPERIMENTAL_MEMORY'] = 'true';
    }
  });

  it('tells the agent when a search found nothing instead of inventing one', async () => {
    ctx.get(IAgentProfileService).update({ activeToolNames: [MEMORY_SEARCH_TOOL_NAME] });

    ctx.mockNextProviderResponse({
      parts: [
        {
          type: 'function',
          id: 'call-1',
          name: MEMORY_SEARCH_TOOL_NAME,
          arguments: JSON.stringify({ query: 'a topic nothing was ever stored about' }),
        },
      ],
      finishReason: 'tool_calls',
    });
    ctx.mockNextProviderResponse({
      parts: [{ type: 'text', text: 'Nothing is stored about that.' }],
    });

    await ctx.rpc.prompt({ input: [{ type: 'text', text: 'tell me about that' }] });
    await ctx.untilTurnEnd();

    const rendered = contextText();
    expect(rendered).toContain('memory search status: no_match');
    expect(rendered).toContain('No stored memory matched this query.');
  });
});
