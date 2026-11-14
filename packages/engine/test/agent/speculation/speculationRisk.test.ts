import { describe, expect, it } from 'vitest';

import {
  classifySpeculationTool,
  speculationRefusalMessage,
} from '#/agent/speculation/speculationRisk';

describe('classifySpeculationTool', () => {
  it('routes whole-file writes into the overlay', () => {
    expect(classifySpeculationTool('Write')).toEqual({ verdict: 'overlay' });
  });

  it('allows read-only tools to run normally', () => {
    for (const name of ['Read', 'Grep', 'Glob', 'Lsp', 'GetGoal', 'SearchSessions']) {
      expect(classifySpeculationTool(name)).toEqual({ verdict: 'allowed' });
    }
  });

  it('refuses process execution and network egress with reasons', () => {
    expect(classifySpeculationTool('Bash')).toEqual({ verdict: 'refused', reason: 'process-execution' });
    expect(classifySpeculationTool('FetchURL')).toEqual({ verdict: 'refused', reason: 'network-egress' });
    expect(classifySpeculationTool('WebSearch')).toEqual({ verdict: 'refused', reason: 'network-egress' });
  });

  it('refuses file mutations the overlay cannot capture', () => {
    expect(classifySpeculationTool('Edit')).toEqual({
      verdict: 'refused',
      reason: 'file-mutation-not-overlayable',
    });
    expect(classifySpeculationTool('ApplyPatch')).toEqual({
      verdict: 'refused',
      reason: 'file-mutation-not-overlayable',
    });
    expect(classifySpeculationTool('NotebookEdit')).toEqual({
      verdict: 'refused',
      reason: 'file-mutation-not-overlayable',
    });
    expect(classifySpeculationTool('RestoreFile')).toEqual({
      verdict: 'refused',
      reason: 'file-mutation-not-overlayable',
    });
  });

  it('refuses server-defined and unknown tools fail-closed', () => {
    expect(classifySpeculationTool('mcp__server__tool')).toEqual({
      verdict: 'refused',
      reason: 'server-defined-tool',
    });
    expect(classifySpeculationTool('NotAKnownTool')).toEqual({
      verdict: 'refused',
      reason: 'unknown-tool',
    });
  });

  it('refuses persistent state and agent spawning', () => {
    expect(classifySpeculationTool('CronCreate')).toEqual({
      verdict: 'refused',
      reason: 'persistent-state-mutation',
    });
    expect(classifySpeculationTool('AgentSwarm')).toEqual({ verdict: 'refused', reason: 'agent-spawn' });
    expect(classifySpeculationTool('Skill')).toEqual({ verdict: 'refused', reason: 'agent-spawn' });
    expect(classifySpeculationTool('AskUserQuestion')).toEqual({
      verdict: 'refused',
      reason: 'user-interaction',
    });
    expect(classifySpeculationTool('UpdateGoal')).toEqual({
      verdict: 'refused',
      reason: 'persistent-state-mutation',
    });
  });

  it('names the reason in the refusal message', () => {
    expect(speculationRefusalMessage('Bash', 'process-execution')).toContain('process-execution');
    expect(speculationRefusalMessage('Bash', 'process-execution')).toContain('speculative');
  });
});
