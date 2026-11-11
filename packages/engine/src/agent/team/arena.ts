import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { LifecycleScope } from '#/app/scopes';
import { redactSecretString } from '@hilbras/omnicode-base/text/redaction';
import { Error2 } from '#/errors';

import { TeamErrors } from './errors';

export interface ArenaContender {
  readonly id: string;
  readonly model: string;
  readonly agentId?: string;
  readonly label?: string;
}

export interface ArenaUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface ArenaRunInput {
  readonly prompt: string;
  readonly contender: ArenaContender;
  readonly signal?: AbortSignal;
}

export interface ArenaRunOutput {
  readonly output: string;
  readonly score?: number;
  readonly durationMs?: number;
  readonly usage?: ArenaUsage;
}

export type ArenaRunner = (
  input: ArenaRunInput,
) => ArenaRunOutput | Promise<ArenaRunOutput>;

export interface ArenaCompareInput {
  readonly prompt: string;
  readonly contenders: readonly ArenaContender[];
  readonly signal?: AbortSignal;
}

export type ArenaContenderStatus = 'succeeded' | 'failed' | 'described';

export interface ArenaContenderResult {
  readonly id: string;
  readonly model: string;
  readonly agentId?: string;
  readonly label?: string;
  readonly status: ArenaContenderStatus;
  readonly rank?: number;
  readonly output?: string;
  readonly error?: string;
  readonly score?: number;
  readonly durationMs?: number;
  readonly usage?: ArenaUsage;
}

export interface ArenaComparison {
  readonly prompt: string;
  readonly mode: 'run' | 'described';
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly results: readonly ArenaContenderResult[];
  readonly winnerId?: string;
}

export interface ArenaServiceOptions {
  readonly runner?: ArenaRunner;
  readonly now?: () => number;
}

export class ArenaService {
  private readonly runner: ArenaRunner | undefined;
  private readonly now: () => number;

  constructor(options: ArenaServiceOptions = {}) {
    this.runner = options.runner;
    this.now = options.now ?? (() => Date.now());
  }

  async compare(input: ArenaCompareInput): Promise<ArenaComparison> {
    const prompt = input.prompt.trim();
    if (prompt.length === 0) {
      throw new Error2(TeamErrors.codes.ARENA_PROMPT_EMPTY, 'Arena prompt must not be empty.');
    }
    if (input.contenders.length < 2) {
      throw new Error2(
        TeamErrors.codes.ARENA_TOO_FEW_CONTENDERS,
        'Arena requires at least two contenders.',
        { details: { contenders: input.contenders.length } },
      );
    }
    const seen = new Set<string>();
    for (const contender of input.contenders) {
      if (contender.id.trim().length === 0 || contender.model.trim().length === 0) {
        throw new Error2(
          TeamErrors.codes.ARENA_CONTENDER_INVALID,
          'Arena contenders require non-empty id and model.',
          { details: { contender } },
        );
      }
      if (seen.has(contender.id)) {
        throw new Error2(
          TeamErrors.codes.ARENA_CONTENDER_DUPLICATE,
          `Arena contender id is duplicated: ${contender.id}`,
          { details: { contenderId: contender.id } },
        );
      }
      seen.add(contender.id);
    }

    const startedAt = this.now();
    if (this.runner === undefined) {
      const results = input.contenders.map((contender, index): ArenaContenderResult => ({
        ...contender,
        status: 'described',
        rank: index + 1,
      }));
      return {
        prompt,
        mode: 'described',
        startedAt,
        finishedAt: this.now(),
        results,
      };
    }

    const runner = this.runner;
    const results = await Promise.all(
      input.contenders.map(async (contender): Promise<ArenaContenderResult> => {
        const runStartedAt = this.now();
        try {
          const output = await runner({
            prompt,
            contender,
            signal: input.signal,
          });
          const durationMs = output.durationMs ?? Math.max(0, this.now() - runStartedAt);
          return {
            ...contender,
            status: 'succeeded',
            output: output.output,
            score: output.score,
            usage: output.usage,
            durationMs,
          };
        } catch (error) {
          return {
            ...contender,
            status: 'failed',
            error: redactSecretString(error instanceof Error ? error.message : String(error)),
            durationMs: Math.max(0, this.now() - runStartedAt),
          };
        }
      }),
    );

    const succeeded = results
      .filter((result) => result.status === 'succeeded')
      .sort(
        (left, right) =>
          (right.score ?? Number.NEGATIVE_INFINITY) -
            (left.score ?? Number.NEGATIVE_INFINITY) ||
          (left.durationMs ?? Number.POSITIVE_INFINITY) -
            (right.durationMs ?? Number.POSITIVE_INFINITY) ||
          left.id.localeCompare(right.id),
      )
      .map((result, index): ArenaContenderResult => ({ ...result, rank: index + 1 }));
    const failed = results.filter((result) => result.status === 'failed');
    const ranked = [...succeeded, ...failed];

    return {
      prompt,
      mode: 'run',
      startedAt,
      finishedAt: this.now(),
      results: ranked,
      winnerId: succeeded[0]?.id,
    };
  }
}

export const IArenaService = createDecorator<ArenaService>('arenaService');

registerScopedService(LifecycleScope.Session, IArenaService, ArenaService, ScopeActivation.OnDemand, 'agentTask');
