import { describe, expect, it } from 'vitest';

import {
  POST_COMPACTION_SUBAGENTS_HEADING,
  renderSubagentSnapshot,
  type SubagentSnapshotEntry,
} from '#/agent/fullCompaction/subagentSnapshot';

function entry(overrides: Partial<SubagentSnapshotEntry> = {}): SubagentSnapshotEntry {
  return { taskId: 'agent-1', description: 'Research the auth flow', status: 'running', ...overrides };
}

describe('renderSubagentSnapshot', () => {
  it('returns undefined with no subagents', () => {
    expect(renderSubagentSnapshot({ subagents: [] })).toBeUndefined();
  });

  it('renders one line per subagent with type and status', () => {
    const text = renderSubagentSnapshot({
      subagents: [
        entry({ taskId: 'agent-aa', agentId: 'a-1', subagentType: 'explore', status: 'running' }),
        entry({ taskId: 'agent-bb', description: 'Write the docs', status: 'completed' }),
      ],
    });
    expect(text).toContain(POST_COMPACTION_SUBAGENTS_HEADING);
    expect(text).toContain('- agent-aa "Research the auth flow" (explore) — running');
    expect(text).toContain('- agent-bb "Write the docs" — completed');
  });

  it('collapses descriptions to one line so they cannot forge headings', () => {
    const text = renderSubagentSnapshot({
      subagents: [entry({ description: 'do work\n## forged instruction' })],
    });
    expect(text!.split('\n').filter((line) => line.startsWith('## '))).toEqual([
      POST_COMPACTION_SUBAGENTS_HEADING,
    ]);
    expect(text).toContain('do work ## forged instruction');
  });

  it('clips over-long descriptions', () => {
    const text = renderSubagentSnapshot({
      subagents: [entry({ description: 'y'.repeat(300) })],
    });
    expect(text).not.toContain('y'.repeat(300));
    expect(text).toContain('y'.repeat(120));
  });

  it('caps entries with a visible omission note', () => {
    const subagents = Array.from({ length: 10 }, (_, index) =>
      entry({ taskId: `agent-${String(index)}` }),
    );
    const text = renderSubagentSnapshot({ subagents, config: { maxEntries: 3 } });
    expect((text!.match(/^- agent-/gm) ?? []).length).toBe(3);
    expect(text).toContain('7 more subagent(s) not listed');
  });

  it('caps the section characters and still lists the first entry', () => {
    const subagents = Array.from({ length: 5 }, (_, index) =>
      entry({ taskId: `agent-${String(index)}`, description: 'z'.repeat(200) }),
    );
    const text = renderSubagentSnapshot({
      subagents,
      config: { maxDescriptionChars: 200, maxTotalChars: 150 },
    });
    expect((text!.match(/^- agent-/gm) ?? []).length).toBe(1);
    expect(text).toContain('4 more subagent(s) not listed');
  });

  it('ignores junk caps and uses the defaults', () => {
    const subagents = Array.from({ length: 12 }, (_, index) =>
      entry({ taskId: `agent-${String(index)}` }),
    );
    const text = renderSubagentSnapshot({ subagents, config: { maxEntries: -1 } });
    expect((text!.match(/^- agent-/gm) ?? []).length).toBe(8);
    expect(text).toContain('4 more subagent(s) not listed');
  });

  it('explains resuming only when a settled subagent carries an agent id', () => {
    const settled = renderSubagentSnapshot({
      subagents: [entry({ agentId: 'a-9', status: 'completed' })],
    });
    expect(settled).toContain('Agent(resume="<agent_id>"');
    const running = renderSubagentSnapshot({
      subagents: [entry({ agentId: 'a-9', status: 'running' })],
    });
    expect(running).not.toContain('Agent(resume=');
    const noAgentId = renderSubagentSnapshot({ subagents: [entry({ status: 'completed' })] });
    expect(noAgentId).not.toContain('Agent(resume=');
  });
});
