import { createHash } from 'node:crypto';

import { z } from 'zod';

import { Error2 } from '#/errors';

import { WorkflowErrors } from './errors';

export interface WorkflowStep {
  readonly id: string;
  readonly tool: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly dependsOn?: readonly string[];
  readonly estimatedTokens?: number;
}

export interface WorkflowScript {
  readonly id: string;
  readonly label?: string;
  readonly steps: readonly WorkflowStep[];
}

const workflowStepSchema = z
  .object({
    id: z.string().min(1),
    tool: z.string().min(1),
    args: z.record(z.string(), z.json()),
    dependsOn: z.array(z.string().min(1)).min(1).optional(),
    estimatedTokens: z.number().int().finite().nonnegative().optional(),
  })
  .strict();

const workflowScriptSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1).optional(),
    steps: z.array(workflowStepSchema).min(1),
  })
  .strict();

function findCycle(steps: readonly WorkflowStep[]): string[] | undefined {
  const byId = new Map<string, WorkflowStep>();
  for (const step of steps) byId.set(step.id, step);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (id: string): string[] | undefined => {
    if (visited.has(id)) return undefined;
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      return stack.slice(start === -1 ? 0 : start).concat(id);
    }
    visiting.add(id);
    stack.push(id);
    const step = byId.get(id);
    if (step?.dependsOn !== undefined) {
      for (const dep of step.dependsOn) {
        const cycle = visit(dep);
        if (cycle !== undefined) return cycle;
      }
    }
    stack.pop();
    visiting.delete(id);
    visited.add(id);
    return undefined;
  };

  for (const step of steps) {
    const cycle = visit(step.id);
    if (cycle !== undefined) return cycle;
  }
  return undefined;
}

export function validateWorkflowScript(script: WorkflowScript): void {
  const seen = new Set<string>();
  for (const step of script.steps) {
    if (seen.has(step.id)) {
      throw new Error2(
        WorkflowErrors.codes.WORKFLOW_INVALID_SCRIPT,
        `Workflow script has duplicate step id ${step.id}.`,
        { details: { workflowId: script.id, stepId: step.id } },
      );
    }
    seen.add(step.id);
  }
  for (const step of script.steps) {
    if (step.dependsOn === undefined) continue;
    for (const dep of step.dependsOn) {
      if (!seen.has(dep)) {
        throw new Error2(
          WorkflowErrors.codes.WORKFLOW_INVALID_SCRIPT,
          `Step ${step.id} depends on unknown step ${dep}.`,
          { details: { workflowId: script.id, stepId: step.id, dependency: dep } },
        );
      }
      if (dep === step.id) {
        throw new Error2(
          WorkflowErrors.codes.WORKFLOW_INVALID_SCRIPT,
          `Step ${step.id} depends on itself.`,
          { details: { workflowId: script.id, stepId: step.id } },
        );
      }
    }
  }
  const cycle = findCycle(script.steps);
  if (cycle !== undefined) {
    throw new Error2(
      WorkflowErrors.codes.WORKFLOW_INVALID_SCRIPT,
      `Workflow script has a dependency cycle: ${cycle.join(' -> ')}.`,
      { details: { workflowId: script.id, cycle } },
    );
  }
}

export function parseWorkflowScript(input: unknown): WorkflowScript {
  const parsed = workflowScriptSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error2(
      WorkflowErrors.codes.WORKFLOW_INVALID_SCRIPT,
      `Invalid workflow script: ${issue === undefined ? 'schema mismatch' : `${issue.path.join('.') || '(root)'} ${issue.message}`}`,
      { details: { issueCount: parsed.error.issues.length } },
    );
  }
  const script: WorkflowScript = parsed.data;
  validateWorkflowScript(script);
  return script;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function workflowScriptFingerprint(script: WorkflowScript): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(script)))
    .digest('hex');
}

export function workflowStepById(script: WorkflowScript): ReadonlyMap<string, WorkflowStep> {
  return new Map(script.steps.map((step) => [step.id, step]));
}
