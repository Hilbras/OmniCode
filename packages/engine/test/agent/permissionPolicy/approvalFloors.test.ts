import { describe, expect, it } from 'vitest';

import {
  decideLiveness,
  evaluateApprovalFloor,
  type FloorInput,
  type LivenessState,
} from '#/agent/permissionPolicy/approvalFloors';

const floors = [{ pattern: 'Bash(ssh *)', reason: 'remote shell' }];
const input = (overrides: Partial<FloorInput> = {}): FloorInput => ({
  mode: 'yolo', toolName: 'Bash(ssh prod)', bypassRequested: true, floors, ...overrides,
});

describe('evaluateApprovalFloor', () => {
  it('requires approval even in yolo with bypass requested', () => {
    expect(evaluateApprovalFloor(input()).kind).toBe('must-ask');
  });

  it('matches wildcard patterns and exact names', () => {
    expect(evaluateApprovalFloor(input({ floors: [{ pattern: 'Write', reason: 'writes' }], toolName: 'Write' })).kind)
      .toBe('must-ask');
  });

  it('proceeds when no floor matches', () => {
    expect(evaluateApprovalFloor(input({ toolName: 'Read' })).kind).toBe('proceed');
  });
});

describe('decideLiveness', () => {
  const state = (overrides: Partial<LivenessState> = {}): LivenessState => ({
    generation: 2, observedGeneration: 2, lastProgressAt: 100, now: 200,
    timeoutMs: 500, ...overrides,
  });

  it('stays alive with observed progress', () => {
    expect(decideLiveness(state()).kind).toBe('alive');
  });

  it('trips on generation drift or timeout', () => {
    expect(decideLiveness(state({ observedGeneration: 1 })).kind).toBe('watchdog');
    expect(decideLiveness(state({ now: 700 })).kind).toBe('watchdog');
  });
});
