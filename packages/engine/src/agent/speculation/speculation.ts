import type { OverlayApplyResult } from './speculationOverlay';
import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';

export const SPECULATION_FOLLOWUP_ORIGIN_NAME = 'speculation_followup';

export interface SpeculationBranchInfo {
  readonly id: string;
  readonly origin: string;
  /** The turn the branch is bound to; `undefined` while waiting for it to start. */
  readonly turnId?: number;
  readonly pendingPaths: readonly string[];
  readonly state: 'live' | 'settled';
}

export interface BeginSpeculationInput {
  readonly origin: string;
}

export interface LaunchSpeculationFollowUpInput {
  readonly prompt: string;
}

export type SpeculationAcceptResult = OverlayApplyResult;

export interface IAgentSpeculationService {
  readonly _serviceBrand: undefined;

  /**
   * Arms the speculative boundary for the running turn (or the next one when
   * the loop is idle): risky tools are refused at preflight and whole-file
   * writes are captured in the branch overlay instead of executed.
   */
  begin(input: BeginSpeculationInput): SpeculationBranchInfo;

  /**
   * Starts a forked speculative follow-up: an idle-loop turn whose writes land
   * in the branch overlay. The branch settles when that turn ends.
   */
  launchFollowUp(input: LaunchSpeculationFollowUpInput): SpeculationBranchInfo;

  /** Copies the overlay onto the real filesystem and closes the branch. */
  accept(): Promise<SpeculationAcceptResult>;

  /** Drops the overlay and closes the branch without touching the filesystem. */
  discard(): void;

  status(): SpeculationBranchInfo | undefined;
}

export const IAgentSpeculationService = createDecorator<IAgentSpeculationService>(
  'agentSpeculationService',
);
