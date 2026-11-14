import { createDecorator, type ServiceIdentifier } from '@hilbras/omnicode-base/di/instantiation';

export type TurnDiffStatus = 'added' | 'modified' | 'deleted';

export interface TurnDiffFile {
  readonly path: string;
  readonly status: TurnDiffStatus;
  readonly additions: number;
  readonly deletions: number;
  readonly binary?: boolean;
  readonly oversize?: boolean;
}

export interface TurnDiffSnapshot {
  readonly turnId: number;
  readonly state: 'open' | 'closed';
  readonly files: readonly TurnDiffFile[];
  readonly additions: number;
  readonly deletions: number;
}

/**
 * Per-turn file deltas, accumulated from the tool accesses that actually
 * wrote files and settled when the turn ends. The CLI `/diff` command is the
 * intended consumer: it reads a snapshot rather than re-deriving diffs.
 */
export interface IAgentTurnDiffService {
  readonly _serviceBrand: undefined;

  /** Turn currently accumulating deltas, if any. */
  activeTurn(): number | undefined;
  /** Resolves once queued filesystem work for started events has drained. */
  settled(): Promise<void>;
  /** Deltas for one observed turn; undefined when the turn was never tracked. */
  snapshot(turnId: number): Promise<TurnDiffSnapshot | undefined>;
  /** Deltas for the most recently started turn. */
  latest(): Promise<TurnDiffSnapshot | undefined>;
  /** Closed turns, oldest first, bounded. */
  turns(): Promise<readonly TurnDiffSnapshot[]>;
  /**
   * Bounded rendered diff of the latest turn (`latest`) or of every retained
   * turn merged per path (`session`). Rendered through
   * `features/sessionSearch/diffRender`, so every cap and the `truncated`
   * flag apply; binary and oversize files stay in `files` but render no body.
   */
  render(scope: TurnDiffRenderScope): Promise<TurnDiffView>;
}

export type TurnDiffRenderScope = 'latest' | 'session';

export interface TurnDiffView {
  readonly scope: TurnDiffRenderScope;
  /** Tracked turn for the `latest` scope; undefined when no turn was tracked, always undefined for `session`. */
  readonly turnId?: number;
  /** Rendered diff body; already carries the summary header and any truncation markers. */
  readonly text: string;
  /** True when a render cap dropped content. */
  readonly truncated: boolean;
  /** Per-file deltas behind the view, including binary/oversize files that contribute no rendered body. */
  readonly files: readonly TurnDiffFile[];
}

export const IAgentTurnDiffService: ServiceIdentifier<IAgentTurnDiffService> =
  createDecorator<IAgentTurnDiffService>('agentTurnDiffService');