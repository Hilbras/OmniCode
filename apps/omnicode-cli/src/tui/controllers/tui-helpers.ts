import type { ActivityPaneMode } from '../components/panes/activity-pane';
import type { QueuedMessage, SteerInputItem, StepRetryState } from '../types';
import { formatStepRetryLabel } from '../utils/step-retry';

/**
 * Pure presentation/selection helpers extracted from OmnicodeTUI (WS2.3).
 * The coordinator keeps orchestration only; these rules are independently
 * testable and cannot accumulate UI state.
 */
export type EffectiveActivityPaneMode = ActivityPaneMode | 'idle' | 'session';
export type LoadingTipKind = 'moon' | 'braille';

export function loadingTipKind(mode: EffectiveActivityPaneMode): LoadingTipKind | undefined {
  if (mode === 'waiting' || mode === 'tool') return 'moon';
  if (mode === 'composing' || mode === 'thinking') return 'braille';
  return undefined;
}

export function waitingSpinnerLabel(retry: StepRetryState | null): string {
  return retry === null ? '' : formatStepRetryLabel(retry);
}

export function sameStringArrays(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function isSteerableQueuedMessage(message: QueuedMessage): boolean {
  return (
    message.inlineSkillActivations === undefined &&
    message.mode !== 'bash' &&
    message.mode !== 'skill'
  );
}

export function toSteerInputItem(message: QueuedMessage): SteerInputItem {
  return {
    text: message.text,
    parts: message.parts,
    imageAttachmentIds: message.imageAttachmentIds,
    videoAttachmentIds: message.videoAttachmentIds,
  };
}
