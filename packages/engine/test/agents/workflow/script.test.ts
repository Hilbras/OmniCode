import { describe, expect, it } from 'vitest';

import { WorkflowErrors } from '#/agents/runtime/workflow/errors';
import {
  parseWorkflowScript,
  validateWorkflowScript,
  workflowScriptFingerprint,
} from '#/agents/runtime/workflow/script';

function thrownCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined;
  }
  return undefined;
}

describe('workflow script parsing', () => {
  it('parses a valid script with dependencies and estimates', () => {
    const script = parseWorkflowScript({
      id: 'wf',
      label: 'Demo',
      steps: [
        { id: 'a', tool: 'Read', args: { path: 'README.md' }, estimatedTokens: 10 },
        { id: 'b', tool: 'Bash', args: {}, dependsOn: ['a'] },
      ],
    });
    expect(script.id).toBe('wf');
    expect(script.steps).toHaveLength(2);
    expect(script.steps[0]?.dependsOn).toBeUndefined();
    expect(script.steps[1]?.dependsOn).toEqual(['a']);
  });

  it('rejects schema violations', () => {
    expect(thrownCode(() => parseWorkflowScript(null))).toBe(
      WorkflowErrors.codes.WORKFLOW_INVALID_SCRIPT,
    );
    expect(
      thrownCode(() => parseWorkflowScript({ id: 'wf', steps: [] })),
    ).toBe(WorkflowErrors.codes.WORKFLOW_INVALID_SCRIPT);
    expect(
      thrownCode(() =>
        parseWorkflowScript({ id: 'wf', steps: [{ id: 'a', args: {} }] }),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_INVALID_SCRIPT);
    expect(
      thrownCode(() =>
        parseWorkflowScript({
          id: 'wf',
          steps: [{ id: 'a', tool: 'Read', args: { fn: () => 1 } }],
        }),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_INVALID_SCRIPT);
    expect(
      thrownCode(() =>
        parseWorkflowScript({
          id: 'wf',
          steps: [{ id: 'a', tool: 'Read', args: {}, extra: true }],
        }),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_INVALID_SCRIPT);
    expect(
      thrownCode(() =>
        parseWorkflowScript({
          id: 'wf',
          steps: [{ id: 'a', tool: 'Read', args: {}, estimatedTokens: 1.5 }],
        }),
      ),
    ).toBe(WorkflowErrors.codes.WORKFLOW_INVALID_SCRIPT);
  });

  it('rejects duplicate step ids, unknown deps, and self deps', () => {
    const duplicate = {
      id: 'wf',
      steps: [
        { id: 'a', tool: 'Read', args: {} },
        { id: 'a', tool: 'Bash', args: {} },
      ],
    };
    expect(thrownCode(() => validateWorkflowScript(duplicate))).toBe(
      WorkflowErrors.codes.WORKFLOW_INVALID_SCRIPT,
    );
    const unknownDep = {
      id: 'wf',
      steps: [{ id: 'a', tool: 'Read', args: {}, dependsOn: ['missing'] }],
    };
    expect(thrownCode(() => validateWorkflowScript(unknownDep))).toBe(
      WorkflowErrors.codes.WORKFLOW_INVALID_SCRIPT,
    );
    const selfDep = {
      id: 'wf',
      steps: [{ id: 'a', tool: 'Read', args: {}, dependsOn: ['a'] }],
    };
    expect(thrownCode(() => validateWorkflowScript(selfDep))).toBe(
      WorkflowErrors.codes.WORKFLOW_INVALID_SCRIPT,
    );
  });

  it('rejects dependency cycles', () => {
    const cyclic = {
      id: 'wf',
      steps: [
        { id: 'a', tool: 'Read', args: {}, dependsOn: ['c'] },
        { id: 'b', tool: 'Read', args: {}, dependsOn: ['a'] },
        { id: 'c', tool: 'Read', args: {}, dependsOn: ['b'] },
      ],
    };
    expect(thrownCode(() => validateWorkflowScript(cyclic))).toBe(
      WorkflowErrors.codes.WORKFLOW_INVALID_SCRIPT,
    );
  });

  it('fingerprints are order-independent for keys and sensitive to content', () => {
    const first = parseWorkflowScript({
      id: 'wf',
      steps: [
        { id: 'a', tool: 'Read', args: { path: 'x', mode: 'r' } },
        { id: 'b', tool: 'Bash', args: { cmd: 'ls' }, dependsOn: ['a'] },
      ],
    });
    const second = parseWorkflowScript({
      id: 'wf',
      steps: [
        { id: 'a', tool: 'Read', args: { mode: 'r', path: 'x' } },
        { id: 'b', tool: 'Bash', args: { cmd: 'ls' }, dependsOn: ['a'] },
      ],
    });
    expect(workflowScriptFingerprint(first)).toBe(workflowScriptFingerprint(second));

    const changed = parseWorkflowScript({
      id: 'wf',
      steps: [
        { id: 'a', tool: 'Read', args: { path: 'y', mode: 'r' } },
        { id: 'b', tool: 'Bash', args: { cmd: 'ls' }, dependsOn: ['a'] },
      ],
    });
    expect(workflowScriptFingerprint(changed)).not.toBe(workflowScriptFingerprint(first));

    const reordered = parseWorkflowScript({
      id: 'wf',
      steps: [
        { id: 'b', tool: 'Bash', args: { cmd: 'ls' }, dependsOn: ['a'] },
        { id: 'a', tool: 'Read', args: { path: 'x', mode: 'r' } },
      ],
    });
    expect(workflowScriptFingerprint(reordered)).not.toBe(workflowScriptFingerprint(first));
  });
});
