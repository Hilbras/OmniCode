import { AgentEvent2 } from '#/app/event/event2';

export type LoopSignalKind = 'text_loop' | 'result_stagnation';

export interface LoopSignalDetectedPayload {
  readonly agentId: string;
  readonly turnId: number;
  readonly kind: LoopSignalKind;
  readonly detail: string;
}

/**
 * Published once per newly detected loop/stagnation signal. Advisory only:
 * the turn keeps running and the model still receives the reminder channel —
 * this event exists so user surfaces can offer an explicit continue/stop
 * confirmation while the agent is visibly stuck.
 */
export class LoopSignalDetected extends AgentEvent2<LoopSignalDetectedPayload> {
  static override readonly type = 'loop.detected';
  static override readonly observable = true;
}
export interface LoopSignalDetected extends LoopSignalDetectedPayload {}

export interface LoopSignalDetectedEvent extends Omit<LoopSignalDetectedPayload, 'agentId'> {
  readonly type: 'loop.detected';
}
