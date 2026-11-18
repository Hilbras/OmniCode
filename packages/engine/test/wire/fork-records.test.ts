import { describe, expect, it } from 'vitest';

import { buildUndoSwitchRecords } from '#/wire/tree/fork';

function input(turns: number) {
  return {
    agentId: 'main',
    branch: 'main',
    reason: 'test',
    base: { branch: 'main', line: 0 },
    turns,
    edgeLine: 4,
    time: 123,
  };
}

describe('buildUndoSwitchRecords', () => {
  it('serialises the legacy undo record through the ContextUndo event', () => {
    const records = buildUndoSwitchRecords(input(3));
    expect(records.legacyUndo).toEqual({
      type: 'context.undo',
      agentId: 'main',
      count: 3,
      time: 123,
    });
  });

  it('rejects a count the ContextUndo schema forbids instead of writing it', () => {
    expect(() => buildUndoSwitchRecords(input(0))).toThrow();
  });
});
