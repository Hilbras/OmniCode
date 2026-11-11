import { describe, expect, it } from 'vitest';

import { ArenaService } from '#/agent/team/arena';
import { TeamErrors } from '#/agent/team/errors';

const CONTENDERS = [
  { id: 'a', model: 'model-a' },
  { id: 'b', model: 'model-b' },
  { id: 'c', model: 'model-c' },
] as const;

describe('ArenaService', () => {
  it('describes a deterministic comparison when no runner is configured', async () => {
    const arena = new ArenaService({ now: () => 5_000 });
    const comparison = await arena.compare({ prompt: 'same prompt', contenders: CONTENDERS });
    expect(comparison.mode).toBe('described');
    expect(comparison.winnerId).toBeUndefined();
    expect(comparison.startedAt).toBe(5_000);
    expect(comparison.results.map((result) => result.id)).toEqual(['a', 'b', 'c']);
    expect(comparison.results.map((result) => result.rank)).toEqual([1, 2, 3]);
    expect(comparison.results.every((result) => result.status === 'described')).toBe(true);
  });

  it('requires at least two unique contenders and a non-empty prompt', async () => {
    const arena = new ArenaService();
    await expect(arena.compare({ prompt: 'x', contenders: [CONTENDERS[0]] })).rejects.toMatchObject({
      code: TeamErrors.codes.ARENA_TOO_FEW_CONTENDERS,
    });
    await expect(
      arena.compare({
        prompt: 'x',
        contenders: [CONTENDERS[0], { ...CONTENDERS[1], id: 'a' }],
      }),
    ).rejects.toMatchObject({ code: TeamErrors.codes.ARENA_CONTENDER_DUPLICATE });
    await expect(arena.compare({ prompt: '  ', contenders: CONTENDERS })).rejects.toMatchObject({
      code: TeamErrors.codes.ARENA_PROMPT_EMPTY,
    });
  });

  it('runs contenders concurrently, isolates failures, and ranks successes', async () => {
    const attempts: string[] = [];
    const arena = new ArenaService({
      runner: async ({ contender }) => {
        attempts.push(contender.id);
        if (contender.id === 'c') throw new Error('provider exploded');
        return {
          output: `answer-${contender.id}`,
          score: contender.id === 'b' ? 9 : 4,
          durationMs: contender.id === 'b' ? 20 : 10,
        };
      },
    });

    const comparison = await arena.compare({ prompt: 'compare', contenders: CONTENDERS });

    expect(attempts.sort()).toEqual(['a', 'b', 'c']);
    expect(comparison.mode).toBe('run');
    expect(comparison.winnerId).toBe('b');
    expect(comparison.results.map((result) => result.id)).toEqual(['b', 'a', 'c']);
    expect(comparison.results.map((result) => result.rank)).toEqual([1, 2, undefined]);
    expect(comparison.results[2]).toMatchObject({
      status: 'failed',
      error: 'provider exploded',
    });
    expect(comparison.results[0]).toMatchObject({
      status: 'succeeded',
      output: 'answer-b',
      score: 9,
    });
  });

  it('breaks score ties by duration and then contender id', async () => {
    const arena = new ArenaService({
      runner: async ({ contender }) => {
        if (contender.id === 'c') return { output: 'c', score: 5, durationMs: 5 };
        if (contender.id === 'b') return { output: 'b', score: 5, durationMs: 10 };
        return { output: 'a', score: 5, durationMs: 10 };
      },
    });
    const comparison = await arena.compare({ prompt: 'tie', contenders: CONTENDERS });
    expect(comparison.results.map((result) => result.id)).toEqual(['c', 'a', 'b']);
  });

  it('returns a failed result for every contender without rejecting the comparison', async () => {
    const arena = new ArenaService({
      runner: () => {
        throw new Error('down');
      },
    });
    const comparison = await arena.compare({ prompt: 'down', contenders: CONTENDERS });
    expect(comparison.winnerId).toBeUndefined();
    expect(comparison.results.every((result) => result.status === 'failed')).toBe(true);
    expect(comparison.results.every((result) => result.rank === undefined)).toBe(true);
  });
});
