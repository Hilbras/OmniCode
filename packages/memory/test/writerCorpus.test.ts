import { describe, expect, it } from 'vitest';

import { validateWriterOperations } from '#/writer/memoryWriter';
import { isMemoryOptOut } from '#/writer/memoryOptOut';

import { WRITER_CORPUS } from './fixtures/writerCorpus';

function sorted(entries: readonly (readonly [string, string])[]): (readonly [string, string])[] {
  return [...entries].sort(([left], [right]) => left.localeCompare(right));
}

describe('memory writer corpus', () => {
  it('covers at least fifty turns', () => {
    expect(WRITER_CORPUS.length).toBeGreaterThanOrEqual(50);
  });

  it.each(WRITER_CORPUS)('$name', (entry) => {
    const saved = new Map<string, string>();
    const rejected: string[] = [];
    let optedOut = false;

    for (const turn of entry.turns) {
      if (isMemoryOptOut(turn.user)) {
        optedOut = true;
        continue;
      }
      const validation = validateWriterOperations(
        { userMessage: turn.user },
        turn.operations,
      );
      for (const operation of validation.accepted) {
        saved.set(operation.subject, operation.content);
      }
      rejected.push(...validation.rejected.map((item) => item.reason));
    }

    expect(sorted([...saved.entries()])).toEqual(sorted(entry.expect.saved ?? []));
    if (entry.expect.rejected !== undefined) {
      expect(rejected.toSorted()).toEqual([...entry.expect.rejected].toSorted());
    }
    if (entry.expect.optOut !== undefined) {
      expect(optedOut).toBe(entry.expect.optOut);
    }
  });
});
