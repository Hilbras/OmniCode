import { describe, expect, it } from 'vitest';

import { ArenaService } from '#/agent/team/arena';
import { ArenaTool } from '#/agent/team/arenaTool';
import type { ExecutableToolContext } from '#/tool/toolContract';

const context = { turnId: 1, toolCallId: 'call-arena', signal: new AbortController().signal } as ExecutableToolContext;

describe('ArenaTool', () => {
  it('renders described contenders through the tool contract', async () => {
    const tool = new ArenaTool(new ArenaService());
    const execution = tool.resolveExecution({
      prompt: 'compare the build',
      contenders: [
        { id: 'a', model: 'model-a' },
        { id: 'b', model: 'model-b' },
      ],
    });
    if (!('execute' in execution)) throw new Error('expected executable execution');
    const result = await execution.execute(context);
    expect(result.isError).toBe(false);
    expect(result.output).toContain('"mode": "described"');
    expect(result.output).toContain('"id": "a"');
  });

  it('returns a tool error for invalid contender sets', async () => {
    const tool = new ArenaTool(new ArenaService());
    const execution = tool.resolveExecution({
      prompt: 'compare',
      contenders: [{ id: 'a', model: 'model-a' }],
    });
    if (!('execute' in execution)) throw new Error('expected executable execution');
    const result = await execution.execute(context);
    expect(result.isError).toBe(true);
    expect(result.output).toContain('at least two');
  });
});
