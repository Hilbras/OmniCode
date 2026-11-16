import { describe, expect, it } from 'vitest';
import { planTurn } from '../src/lib/agent';

describe('planTurn', () => {
  it('routes research requests through web_search and read_url', () => {
    const steps = planTurn('Research the latest on-device vector databases');
    const tools = steps.filter((step) => step.kind === 'tool');
    expect(tools.map((step) => (step.kind === 'tool' ? step.tool : ''))).toEqual([
      'web_search',
      'read_url',
    ]);
    expect(tools.every((step) => step.kind === 'tool' && !step.needsApproval)).toBe(true);
  });

  it('requires approval before reading files', () => {
    const steps = planTurn('Read my quarterly report and summarize it');
    const tool = steps.find((step) => step.kind === 'tool');
    expect(tool?.kind === 'tool' && tool.tool).toBe('read_file');
    expect(tool?.kind === 'tool' && tool.needsApproval).toBe(true);
  });

  it('prioritizes attachments over keyword routing', () => {
    const steps = planTurn('research this', ['notes.md']);
    const tool = steps[0];
    expect(tool?.kind === 'tool' && tool.tool).toBe('read_file');
    expect(tool?.kind === 'tool' && tool.args['path']).toBe('notes.md');
    expect(tool?.kind === 'tool' && tool.needsApproval).toBe(true);
  });

  it('runs code in the sandbox without approval', () => {
    const steps = planTurn('Write and run a function that sums two numbers');
    const tool = steps.find((step) => step.kind === 'tool');
    expect(tool?.kind === 'tool' && tool.tool).toBe('run_code');
    expect(tool?.kind === 'tool' && tool.needsApproval).toBe(false);
  });

  it('saves memory as unverified', () => {
    const steps = planTurn('Remember that I prefer dark mode');
    const tool = steps.find((step) => step.kind === 'tool');
    expect(tool?.kind === 'tool' && tool.tool).toBe('memory_save');
    expect(tool?.kind === 'tool' && tool.args['trust']).toBe('unverified');
  });

  it('always ends with a text step', () => {
    for (const input of ['hello', 'research cats', 'read this file', 'run code', 'plan a trip']) {
      const steps = planTurn(input);
      expect(steps.length).toBeGreaterThan(0);
      expect(steps[steps.length - 1]?.kind).toBe('text');
    }
  });

  it('answers plain conversation without tools', () => {
    const steps = planTurn('hello there');
    expect(steps.every((step) => step.kind === 'text')).toBe(true);
  });
});
