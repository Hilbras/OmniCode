import { describe, expect, it } from 'vitest';

import type { IBashParserService } from '#/app/bashParser/bashParser';
import type { PermissionPolicyContext } from '#/agent/permissionPolicy/types';
import { ExecPolicyPermissionPolicyService } from '#/agent/permissionPolicy/policies/exec-policy-rule';
import {
  EXEC_POLICY_ALLOWED_HOSTS_KEY,
  loadExecPolicy,
} from '#/agent/permissionPolicy/execPolicy/execPolicy';

const parser = {
  parse: () => ({ ok: true, hasError: false, root: { type: 'program', children: [] } }),
} as unknown as IBashParserService;

function context(toolName: string, args: unknown): PermissionPolicyContext {
  return {
    toolCall: { type: 'function', id: 'c1', name: toolName, arguments: null },
    tool: { name: toolName },
    args,
  } as unknown as PermissionPolicyContext;
}

const policy = loadExecPolicy({
  version: 1,
  opaque: 'forbidden',
  rules: [
    { decision: 'allow', prefix: 'git status' },
    { decision: 'forbidden', prefix: 'rm', sticky: true },
    { decision: 'prompt', alternatives: [['git', 'push']] },
    { decision: 'prompt-user', prefix: 'deploy' },
  ],
});

describe('ExecPolicyPermissionPolicyService', () => {
  it('is inert without a policy', () => {
    const service = new ExecPolicyPermissionPolicyService(parser);
    expect(service.evaluate(context('Bash', { command: 'rm -rf /' }))).toBeUndefined();
  });

  it('ignores non-shell tools', () => {
    const service = new ExecPolicyPermissionPolicyService(parser);
    service.setPolicy(policy);
    expect(service.evaluate(context('Write', { command: 'rm -rf /' }))).toBeUndefined();
  });

  it('approves, prompts, and denies by rule', () => {
    const service = new ExecPolicyPermissionPolicyService(parser);
    service.setPolicy(policy);
    expect(service.evaluate(context('Bash', { command: 'git status' }))).toMatchObject({
      kind: 'approve',
      reason: { exec_policy: 'rule' },
    });
    expect(service.evaluate(context('Bash', { command: 'git push origin main' }))).toMatchObject({
      kind: 'ask',
      reason: { exec_policy: 'rule' },
    });
    const denied = service.evaluate(context('Bash', { command: 'rm -rf build' }));
    expect(denied).toMatchObject({ kind: 'deny', reason: { exec_policy: 'rule' } });
    expect(denied && 'message' in denied ? denied.message : '').toContain('Do not retry');
  });

  it('marks prompt-user as human-required', () => {
    const service = new ExecPolicyPermissionPolicyService(parser);
    service.setPolicy(policy);
    expect(service.evaluate(context('Bash', { command: 'deploy prod' }))).toMatchObject({
      kind: 'ask',
      reason: { requires_human: true },
    });
  });

  it('denies opaque commands per the policy default', () => {
    const service = new ExecPolicyPermissionPolicyService(parser);
    service.setPolicy(policy);
    expect(service.evaluate(context('Bash', { command: 'echo x && rm -rf /' }))).toMatchObject({
      kind: 'deny',
      reason: { exec_policy: 'opaque' },
    });
  });

  it('clearing the policy makes it inert again', () => {
    const service = new ExecPolicyPermissionPolicyService(parser);
    service.setPolicy(policy);
    service.setPolicy(undefined);
    expect(service.evaluate(context('Bash', { command: 'rm -rf /' }))).toBeUndefined();
  });

  it('ignores empty or malformed commands', () => {
    const service = new ExecPolicyPermissionPolicyService(parser);
    service.setPolicy(policy);
    expect(service.evaluate(context('Bash', { command: '   ' }))).toBeUndefined();
    expect(service.evaluate(context('Bash', {}))).toBeUndefined();
  });

  it('carries the hosts amendment on an approved rule', () => {
    const service = new ExecPolicyPermissionPolicyService(parser);
    const hostPolicy = loadExecPolicy({
      version: 1,
      rules: [{ decision: 'allow', prefix: 'curl', hosts: ['API.Example.COM'] }],
    });
    service.setPolicy(hostPolicy);
    const result = service.evaluate(context('Bash', { command: 'curl api.example.com/data' }));
    expect(result).toMatchObject({ kind: 'approve' });
    expect(result && 'executionMetadata' in result ? result.executionMetadata : undefined).toEqual({
      [EXEC_POLICY_ALLOWED_HOSTS_KEY]: ['api.example.com'],
    });
  });

  it('attaches no amendment when the approved rule carries no hosts', () => {
    const service = new ExecPolicyPermissionPolicyService(parser);
    service.setPolicy(policy);
    const result = service.evaluate(context('Bash', { command: 'git status' }));
    expect(result).toMatchObject({ kind: 'approve' });
    expect(result && 'executionMetadata' in result ? result.executionMetadata : undefined).toBeUndefined();
  });
});
