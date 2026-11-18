import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DisposableStore } from '@hilbras/omnicode-base/di/lifecycle';
import { createServices, type TestInstantiationService } from '@hilbras/omnicode-base/di/test';
import { IAgentContextMemoryService } from '#/agent/contextMemory/contextMemory';
import type { ContextMessage } from '#/agent/contextMemory/types';
import { IAgentPermissionModeService } from '#/agent/permissionMode/permissionMode';
import {
  IAgentPermissionPolicyService,
  type PermissionPolicyEvaluation,
} from '#/agent/permissionPolicy/permissionPolicy';
import { AgentPermissionPolicyService } from '#/agent/permissionPolicy/permissionPolicyService';
import { EXEC_POLICY_SECTION } from '#/agent/permissionPolicy/execPolicy/configSection';
import type { PermissionMode } from '#/agent/permissionPolicy/types';
import { PERMISSION_SECTION } from '#/agent/permissionRules/configSection';
import {
  IAgentPermissionRulesService,
  type IAgentPermissionRulesService as PermissionRulesServiceContract,
  type PermissionRule,
} from '#/agent/permissionRules/permissionRules';
import { IAgentRuntimeService } from '#/agent/runtimeBinding/agentRuntime';
import { IAgentScopeContext, makeAgentScopeContext } from '#/agent/scopeContext/scopeContext';
import type { ResolvedToolExecutionHookContext } from '#/agent/toolExecutor/toolHooks';
import { IBashParserService } from '#/app/bashParser/bashParser';
import { BashParserService } from '#/app/bashParser/bashParserService';
import { IBootstrapService, type HostArgs } from '#/app/bootstrap/bootstrap';
import { IConfigService } from '#/app/config/config';
import { IGitService } from '#/app/git/git';
import { findGitWorkTree } from '#/app/git/workTree';
import { ITelemetryService } from '#/app/telemetry/telemetry';
import { HostFileSystem } from '#/os/backends/node-local/hostFsService';
import {
  IHostEnvironment,
  type IHostEnvironment as HostEnvironmentService,
} from '#/os/interface/hostEnvironment';
import { ISessionWorkspaceContext } from '#/session/workspaceContext/workspaceContext';
import {
  literalRulePattern,
  matchesGlobRuleSubject,
  matchesPathRuleSubject,
} from '#/tool/rule-match';
import { ToolAccesses, type ToolAccesses as ToolAccessList } from '#/tool/toolContract';
import type { ToolInputDisplay } from '#/tool/toolInputDisplay';
import type { ToolCall } from '#human/llm/message';

import { recordingTelemetry } from '../../app/telemetry/stubs';
import { stubPermissionModeService } from '../permissionMode/stubs';

const signal = new AbortController().signal;

const hostFs = new HostFileSystem();

describe('AgentPermissionPolicyService chain', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let mode: PermissionMode;
  let rules: PermissionRule[];
  let sessionApprovalRulePatterns: string[];
  let workspace: ReturnType<typeof workspaceStub>;
  let hostArgs: HostArgs;
  let dangerousCommandGuardEnabled: boolean;
  let contextMessages: ContextMessage[];
  let execPolicyConfig: unknown;
  let execPolicyDir: string | undefined;

  beforeEach(() => {
    disposables = new DisposableStore();
    mode = 'manual';
    rules = [];
    sessionApprovalRulePatterns = [];
    workspace = workspaceStub('/workspace');
    hostArgs = { requestHeaders: {}, nonInteractive: false };
    dangerousCommandGuardEnabled = true;
    contextMessages = [];
    execPolicyConfig = undefined;
    execPolicyDir = undefined;
    ix = createServices(disposables, {
      additionalServices: (reg) => {
        reg.defineInstance(IAgentContextMemoryService, {
          _serviceBrand: undefined,
          get: () => contextMessages,
          append: (...messages) => { contextMessages.push(...messages); },
          appendLoopEvent: () => {},
          publishTrailingRemoval: () => false,
          clear: () => { contextMessages = []; },
          applyCompaction: () => ({
            summary: '',
            contextSummary: '',
            compactedCount: 0,
            tokensBefore: 0,
            tokensAfter: 0,
            keptUserMessageCount: 0,
          }),
        } as IAgentContextMemoryService);
        reg.defineInstance(
          IAgentPermissionModeService,
          stubPermissionModeService(() => mode),
        );
        reg.definePartialInstance(IBootstrapService, {
          get args() {
            return hostArgs;
          },
        });
        reg.definePartialInstance(IConfigService, {
          get: ((section: string) =>
            section === EXEC_POLICY_SECTION
              ? execPolicyConfig
              : section === PERMISSION_SECTION && !dangerousCommandGuardEnabled
                ? { dangerousCommandGuard: false }
                : undefined) as IConfigService['get'],
          onDidSectionChange: (() => ({
            dispose: () => {},
          })) as IConfigService['onDidSectionChange'],
        });
        reg.defineInstance(
          IAgentScopeContext,
          makeAgentScopeContext({ agentId: 'main', agentScope: '' }),
        );
        reg.definePartialInstance(
          IAgentPermissionRulesService,
          permissionRulesStub({
            rules: () => rules,
            sessionApprovalRulePatterns: () => sessionApprovalRulePatterns,
          }),
        );
        reg.defineInstance(ISessionWorkspaceContext, workspace.stub);
        reg.defineInstance(IHostEnvironment, kaosStub());
        reg.defineInstance(IAgentRuntimeService, {
          _serviceBrand: undefined,
          onDidChange: () => ({ dispose: () => {} }),
          isAvailable: () => true,
          inspect() {
            return (this as IAgentRuntimeService).acquire().runtime;
          },
          acquire: () => ({
            track: (resource) => resource,
            runtime: {
              identity: { workspaceId: 'test', runtimeId: 'local', generation: 'test' },
              capabilities: new Set(),
              status: 'ready',
              onDidChangeStatus: () => ({ dispose: () => {} }),
              dispose: () => {},
              environment: { pathClass: 'posix' } as never,
              path: {
                separator: '/',
                delimiter: ':',
                isAbsolute: () => true,
                join: (...paths: readonly string[]) => join(...paths),
                relative: (from: string, to: string) => to.replace(`${from}/`, ''),
                resolve: (...paths: readonly string[]) => join(...paths),
                basename: (path: string) => basename(path),
                dirname: (path: string) => dirname(path),
              },
              workspace: { mapRoots: (roots) => roots },
            },
            dispose: () => {},
          }),
        });
        reg.defineInstance(ITelemetryService, recordingTelemetry([]));
        reg.definePartialInstance(IGitService, { findWorkTree: async () => null });
        reg.define(IBashParserService, BashParserService);
        reg.define(IAgentPermissionPolicyService, AgentPermissionPolicyService);
      },
      strict: true,
    });
  });

  afterEach(async () => {
    disposables.dispose();
    if (execPolicyDir !== undefined) await rm(execPolicyDir, { recursive: true, force: true });
  });

  function service(): IAgentPermissionPolicyService {
    return ix.get(IAgentPermissionPolicyService);
  }

  function setUserRequest(text: string): void {
    contextMessages.push({ role: 'user', content: [{ type: 'text', text }], toolCalls: [] });
  }

  async function evaluate(
    input: PolicyContextInput,
  ): Promise<PermissionPolicyEvaluation | undefined> {
    const svc = service();
    return svc.evaluate(policyContext(input));
  }

  it('keeps auto-mode AskUserQuestion deny above default approval', async () => {
    mode = 'auto';

    await expect(
      evaluate({
        toolName: 'AskUserQuestion',
        args: { questions: [] },
      }),
    ).resolves.toMatchObject({
      policyName: 'auto-mode-ask-user-question-deny',
      result: { kind: 'deny' },
    });
  });

  it('applies deny rules before yolo-mode approval', async () => {
    mode = 'yolo';
    rules.push({
      decision: 'deny',
      scope: 'user',
      pattern: 'Bash',
      reason: 'blocked by test',
    });

    await expect(
      evaluate({
        toolName: 'Bash',
        args: { command: 'printf first', timeout: 60 },
      }),
    ).resolves.toMatchObject({
      policyName: 'user-configured-deny',
      result: {
        kind: 'deny',
        message: 'Tool "Bash" was denied by permission rule. Reason: blocked by test',
      },
    });
  });

  it('keeps ask rules higher priority than matching allow rules', async () => {
    rules.push(
      {
        decision: 'allow',
        scope: 'project',
        pattern: 'Bash',
      },
      {
        decision: 'ask',
        scope: 'user',
        pattern: 'Bash',
      },
    );

    await expect(
      evaluate({
        toolName: 'Bash',
        args: { command: 'printf first', timeout: 60 },
      }),
    ).resolves.toMatchObject({
      policyName: 'user-configured-ask',
      result: { kind: 'ask' },
    });
  });

  it('reuses approve-for-session before matching ask rules', async () => {
    rules.push({
      decision: 'ask',
      scope: 'user',
      pattern: 'Bash',
    });
    sessionApprovalRulePatterns.push('Bash(printf first)');

    await expect(
      evaluate({
        toolName: 'Bash',
        args: { command: 'printf first', timeout: 60 },
      }),
    ).resolves.toMatchObject({
      policyName: 'session-approval-history',
      result: {
        kind: 'approve',
        reason: {
          has_rule_args: true,
          match_strategy: 'matches_rule',
        },
      },
    });
  });

  it.each(['manual', 'yolo'] as const)('asks for shutdown in %s mode', async (currentMode) => {
    mode = currentMode;

    await expect(
      evaluate({
        toolName: 'Bash',
        args: { command: 'shutdown -h now', timeout: 60 },
      }),
    ).resolves.toMatchObject({
      policyName: 'dangerous-command-ask',
      result: { kind: 'ask', reason: { dangerous_command: 'shutdown' } },
    });
  });

  it.each(['shutdown -h now', 'reboot', 'dd if=/dev/zero of=/dev/sda bs=1M'])(
    'asks for `%s` in auto mode',
    async (command) => {
      mode = 'auto';

      await expect(
        evaluate({
          toolName: 'Bash',
          args: { command, timeout: 60 },
        }),
      ).resolves.toMatchObject({
        policyName: 'dangerous-command-ask',
        result: { kind: 'ask', reason: { dangerous_command: expect.any(String) } },
      });
    },
  );

  it.each([
    ['sudo reboot', 'reboot'],
    ['sudo -u root reboot', 'reboot'],
    ['/sbin/poweroff', 'poweroff'],
    ['echo ok && shutdown now', 'shutdown'],
    ['if halt; then echo x; fi', 'halt'],
    ['echo $(reboot)', 'reboot'],
    ['init 0', 'init'],
    ['telinit 6', 'telinit'],
    ['mkfs.ext4 /dev/sda1', 'mkfs.ext4'],
    ['wipefs -a /dev/sda', 'wipefs'],
    ['dd if=/dev/zero of=/dev/sda bs=1M', 'dd'],
    ['Restart-Computer -Force', 'restart-computer'],
    ['Stop-Computer', 'stop-computer'],
    ['bcdedit /set x y', 'bcdedit'],
    ['diskpart /s script.txt', 'diskpart'],
    ['format C:', 'format'],
    ['SHUTDOWN /s /t 0', 'shutdown'],
    ['shut\\down -h now', 'shutdown'],
    ['systemctl poweroff', 'systemctl poweroff'],
    ['systemctl --user reboot', 'systemctl reboot'],
    ['bash -c "shutdown now"', 'shutdown'],
    ['rm -rf /tmp/build /root', 'rm -rf'],
    ['rm -fr dir', 'rm -rf'],
    ['rm -r -f dir', 'rm -rf'],
    ['rm -R --force dir', 'rm -rf'],
    ['rm -rfv dir', 'rm -rf'],
    ['sudo -u root rm --recursive --force dir', 'rm -rf'],
    ['echo ok && rm -rf dir', 'rm -rf'],
    ['env rm -rf dir', 'rm -rf'],
    ['env FOO=bar rm -rf dir', 'rm -rf'],
    ['env -i FOO=bar shutdown now', 'shutdown'],
    ['nohup rm -rf dir', 'rm -rf'],
    ['exec reboot', 'reboot'],
    ['command reboot', 'reboot'],
    ['builtin shutdown now', 'shutdown'],
    ['nice -n 5 poweroff', 'poweroff'],
    ['nice --adjustment=5 shutdown now', 'shutdown'],
    ['busybox poweroff', 'poweroff'],
    ['busybox rm -rf dir', 'rm -rf'],
    ['eval "shutdown now"', 'shutdown'],
    ['eval rm -rf dir', 'rm -rf'],
    ['bash -lc "shutdown now"', 'shutdown'],
    ['bash -c "env rm -rf dir"', 'rm -rf'],
    ['bash -c \'eval "shutdown now"\'', 'shutdown'],
  ] as const)('asks for `%s` in yolo mode', async (command, matched) => {
    mode = 'yolo';

    await expect(
      evaluate({
        toolName: 'Bash',
        args: { command, timeout: 60 },
      }),
    ).resolves.toMatchObject({
      policyName: 'dangerous-command-ask',
      result: { kind: 'ask', reason: { dangerous_command: matched } },
    });
  });

  it.each(['rm -rf /tmp/build', 'rm -rf /temp/cache'])(
    'approves `%s` in yolo mode',
    async (command) => {
      mode = 'yolo';

      await expect(
        evaluate({
          toolName: 'Bash',
          args: { command, timeout: 60 },
        }),
      ).resolves.toMatchObject({
        policyName: 'yolo-mode-approve',
        result: { kind: 'approve' },
      });
    },
  );

  it.each([
    'echo shutdown',
    'env FOO=bar echo ok',
    'command -v rm',
    'command echo ok',
    'nohup echo ok',
    'nice echo ok',
  ])('approves read-only commands via the auto-mode classifier', async (command) => {
    mode = 'auto';

    await expect(
      evaluate({
        toolName: 'Bash',
        args: { command, timeout: 60 },
      }),
    ).resolves.toMatchObject({
      policyName: 'auto-mode-classifier',
      result: { kind: 'approve' },
    });
  });

  it.each([
    'init 3',
    'dd if=/dev/zero of=/dev/null bs=1M count=1',
    'systemctl status sshd',
    'rm -r dir',
    'rm -f file',
    'rm -i file',
    'rm --recursive dir',
    'rm --force file',
    'rm dir',
  ])('asks for mutating commands via the auto-mode classifier', async (command) => {
    mode = 'auto';

    await expect(
      evaluate({
        toolName: 'Bash',
        args: { command, timeout: 60 },
      }),
    ).resolves.toMatchObject({
      policyName: 'auto-mode-classifier',
      result: { kind: 'ask' },
    });
  });

  it.each(['$CMD --force', 'bash -c "echo $HOME"', 'echo "unterminated'])(
    'approves unanalyzable command `%s` in yolo mode',
    async (command) => {
      mode = 'yolo';

      await expect(
        evaluate({
          toolName: 'Bash',
          args: { command, timeout: 60 },
        }),
      ).resolves.toMatchObject({
        policyName: 'yolo-mode-approve',
        result: { kind: 'approve' },
      });
    },
  );

  it('approves a heredoc command containing a single quote in yolo mode', async () => {
    mode = 'yolo';

    await expect(
      evaluate({
        toolName: 'Bash',
        args: { command: "gh --body \"$(cat <<'EOF'\nit's\nEOF\n)\"", timeout: 60 },
      }),
    ).resolves.toMatchObject({
      policyName: 'yolo-mode-approve',
      result: { kind: 'approve' },
    });
  });

  it.each(['$CMD --force', 'bash -c "echo $HOME"', 'env $FLAGS'])(
    'asks for unanalyzable command `%s` in auto mode',
    async (command) => {
      mode = 'auto';

      await expect(
        evaluate({
          toolName: 'Bash',
          args: { command, timeout: 60 },
        }),
      ).resolves.toMatchObject({
        policyName: 'dangerous-command-ask',
        result: { kind: 'ask', reason: { unanalyzable_command: true } },
      });
    },
  );

  it('does not load the dangerous command policy for non-interactive hosts', async () => {
    hostArgs = { ...hostArgs, nonInteractive: true };
    mode = 'auto';

    await expect(
      evaluate({
        toolName: 'Bash',
        args: { command: 'rm -rf /tmp/build', timeout: 60 },
      }),
    ).resolves.toMatchObject({
      policyName: 'auto-mode-classifier',
      result: { kind: 'ask' },
    });
  });

  it('does not load the dangerous command policy when disabled by config', async () => {
    dangerousCommandGuardEnabled = false;
    mode = 'yolo';

    await expect(
      evaluate({
        toolName: 'Bash',
        args: { command: 'shutdown -h now', timeout: 60 },
      }),
    ).resolves.toMatchObject({
      policyName: 'yolo-mode-approve',
      result: { kind: 'approve' },
    });
  });

  it('composes the exec policy from the configured policy file', async () => {
    execPolicyDir = await mkdtemp(join(tmpdir(), 'exec-policy-chain-'));
    await writeFile(
      join(execPolicyDir, 'policy.json'),
      JSON.stringify({
        version: 1,
        rules: [
          { decision: 'allow', prefix: 'git status' },
          { decision: 'forbidden', prefix: 'terraform destroy', sticky: true },
        ],
      }),
    );
    execPolicyConfig = { path: join(execPolicyDir, 'policy.json') };

    await expect(
      evaluate({ toolName: 'Bash', args: { command: 'git status', timeout: 60 } }),
    ).resolves.toMatchObject({
      policyName: 'exec-policy',
      result: { kind: 'approve', reason: { exec_policy: 'rule' } },
    });
    await expect(
      evaluate({
        toolName: 'Bash',
        args: { command: 'terraform destroy -auto-approve', timeout: 60 },
      }),
    ).resolves.toMatchObject({
      policyName: 'exec-policy',
      result: { kind: 'deny' },
    });
  });

  it('reuses a session approval for an exec-policy prompt instead of asking again', async () => {
    execPolicyDir = await mkdtemp(join(tmpdir(), 'exec-policy-chain-'));
    await writeFile(
      join(execPolicyDir, 'prompt.json'),
      JSON.stringify({ version: 1, rules: [{ decision: 'prompt', prefix: 'npm run build' }] }),
    );
    execPolicyConfig = { path: join(execPolicyDir, 'prompt.json') };

    await expect(
      evaluate({ toolName: 'Bash', args: { command: 'npm run build', timeout: 60 } }),
    ).resolves.toMatchObject({ policyName: 'exec-policy-prompt', result: { kind: 'ask' } });

    sessionApprovalRulePatterns.push('Bash(npm run build)');

    await expect(
      evaluate({ toolName: 'Bash', args: { command: 'npm run build', timeout: 60 } }),
    ).resolves.toMatchObject({
      policyName: 'session-approval-history',
      result: { kind: 'approve' },
    });
  });

  it('clears the auto-mode denial fallback once the user approves the fallback ask', async () => {
    mode = 'auto';
    const input = { toolName: 'Lookup', args: { query: 'blocked action' } };

    await expect(evaluate(input)).resolves.toMatchObject({
      policyName: 'auto-mode-classifier',
      result: { kind: 'ask', reason: { auto_mode_classifier: 'ask' } },
    });
    await expect(evaluate(input)).resolves.toMatchObject({
      policyName: 'auto-mode-classifier',
      result: { kind: 'ask', reason: { auto_mode_classifier: 'ask' } },
    });
    const fallback = await evaluate(input);
    expect(fallback?.result).toMatchObject({
      kind: 'ask',
      reason: { auto_mode_classifier: 'ask', denial_fallback: 'consecutive_block' },
    });

    const resolved =
      fallback?.result !== undefined && 'resolveApproval' in fallback.result
        ? fallback.result.resolveApproval?.({ decision: 'approved' })
        : 'missing resolveApproval';
    expect(resolved).toBeUndefined();

    await expect(evaluate(input)).resolves.toMatchObject({
      policyName: 'auto-mode-classifier',
      result: { kind: 'approve', reason: { auto_mode_classifier: 'trusted_user_answer' } },
    });
  });

  it('fails the policy service when the configured exec policy is broken', async () => {
    execPolicyDir = await mkdtemp(join(tmpdir(), 'exec-policy-chain-'));
    await writeFile(
      join(execPolicyDir, 'broken.json'),
      JSON.stringify({ version: 1, rules: [{ decision: 'refuse' }] }),
    );
    execPolicyConfig = { path: join(execPolicyDir, 'broken.json') };

    await expect(
      evaluate({ toolName: 'Bash', args: { command: 'git status', timeout: 60 } }),
    ).rejects.toThrow(/decision must be one of/);
    await expect(
      evaluate({ toolName: 'Bash', args: { command: 'git status', timeout: 60 } }),
    ).rejects.toThrow(/broken\.json/);
  });

  it('carries the exec-policy host amendment through the chain', async () => {
    execPolicyDir = await mkdtemp(join(tmpdir(), 'exec-policy-chain-'));
    await writeFile(
      join(execPolicyDir, 'hosts.json'),
      JSON.stringify({
        version: 1,
        rules: [{ decision: 'allow', prefix: 'curl', hosts: ['API.Example.COM'] }],
      }),
    );
    execPolicyConfig = { path: join(execPolicyDir, 'hosts.json') };

    const evaluation = await evaluate({
      toolName: 'Bash',
      args: { command: 'curl api.example.com/data', timeout: 60 },
    });
    expect(evaluation).toMatchObject({ policyName: 'exec-policy', result: { kind: 'approve' } });
    expect(
      evaluation !== undefined && 'executionMetadata' in evaluation.result
        ? evaluation.result.executionMetadata
        : undefined,
    ).toEqual({ execPolicyAllowedHosts: ['api.example.com'] });
  });

  it('does not let session approval history exempt dangerous commands', async () => {
    sessionApprovalRulePatterns.push('Bash(shutdown -h now)');

    await expect(
      evaluate({
        toolName: 'Bash',
        args: { command: 'shutdown -h now', timeout: 60 },
      }),
    ).resolves.toMatchObject({
      policyName: 'dangerous-command-ask',
      result: { kind: 'ask' },
    });
  });

  it('keeps deny rules above dangerous command ask', async () => {
    rules.push({
      decision: 'deny',
      scope: 'user',
      pattern: 'Bash(shutdown *)',
    });

    await expect(
      evaluate({
        toolName: 'Bash',
        args: { command: 'shutdown -h now', timeout: 60 },
      }),
    ).resolves.toMatchObject({
      policyName: 'user-configured-deny',
      result: { kind: 'deny' },
    });
  });

  it.each(['AgentSwarm', 'FetchURL', 'WebSearch', 'memory_forget', 'memory_manage', 'Arena'] as const)(
    'asks for %s in manual mode instead of blanket approval',
    async (toolName) => {
      await expect(evaluate({ toolName, args: {} })).resolves.toMatchObject({
        policyName: 'fallback-ask',
        result: { kind: 'ask' },
      });
    },
  );

  it.each(['EnterPlanMode', 'ExitPlanMode', 'CreateGoal', 'TeamCreate', 'Lsp', 'ArtifactRecord'] as const)(
    'approves %s through the default tool allowlist in manual mode',
    async (toolName) => {
      await expect(evaluate({ toolName, args: {} })).resolves.toMatchObject({
        policyName: 'default-tool-approve',
        result: { kind: 'approve' },
      });
    },
  );
});

describe('AgentPermissionPolicyService git cwd write approval', () => {
  let disposables: DisposableStore;
  let ix: TestInstantiationService;
  let mode: PermissionMode;
  let workspace: ReturnType<typeof workspaceStub>;
  let workspaceDir: string;
  let cleanupDirs: string[];
  let contextMessages: ContextMessage[];

  beforeEach(async () => {
    disposables = new DisposableStore();
    mode = 'manual';
    workspaceDir = await mkdtemp(join(tmpdir(), 'omnicode-permission-git-'));
    cleanupDirs = [workspaceDir];
    contextMessages = [];
    await mkdir(join(workspaceDir, '.git'), { recursive: true });
    workspace = workspaceStub(workspaceDir);
    ix = createServices(disposables, {
      additionalServices: (reg) => {
        reg.defineInstance(IAgentContextMemoryService, {
          _serviceBrand: undefined,
          get: () => contextMessages,
          append: (...messages) => { contextMessages.push(...messages); },
          appendLoopEvent: () => {},
          publishTrailingRemoval: () => false,
          clear: () => { contextMessages = []; },
          applyCompaction: () => ({
            summary: '',
            contextSummary: '',
            compactedCount: 0,
            tokensBefore: 0,
            tokensAfter: 0,
            keptUserMessageCount: 0,
          }),
        } as IAgentContextMemoryService);
        reg.defineInstance(
          IAgentPermissionModeService,
          stubPermissionModeService(() => mode),
        );
        reg.definePartialInstance(IBootstrapService, {
          args: { requestHeaders: {}, nonInteractive: false },
        });
        reg.definePartialInstance(IConfigService, {
          get: (() => undefined) as IConfigService['get'],
          onDidSectionChange: (() => ({
            dispose: () => {},
          })) as IConfigService['onDidSectionChange'],
        });
        reg.defineInstance(
          IAgentScopeContext,
          makeAgentScopeContext({ agentId: 'main', agentScope: '' }),
        );
        reg.definePartialInstance(IAgentPermissionRulesService, permissionRulesStub());
        reg.defineInstance(ISessionWorkspaceContext, workspace.stub);
        reg.defineInstance(IHostEnvironment, kaosStub());
        reg.defineInstance(IAgentRuntimeService, {
          _serviceBrand: undefined,
          onDidChange: () => ({ dispose: () => {} }),
          isAvailable: () => true,
          inspect() {
            return (this as IAgentRuntimeService).acquire().runtime;
          },
          acquire: () => ({
            track: (resource) => resource,
            runtime: {
              identity: { workspaceId: 'test', runtimeId: 'local', generation: 'test' },
              capabilities: new Set(),
              status: 'ready',
              onDidChangeStatus: () => ({ dispose: () => {} }),
              dispose: () => {},
              environment: { pathClass: 'posix' } as never,
              path: {
                separator: '/',
                delimiter: ':',
                isAbsolute: () => true,
                join: (...paths: readonly string[]) => join(...paths),
                relative: (from: string, to: string) => to.replace(`${from}/`, ''),
                resolve: (...paths: readonly string[]) => join(...paths),
                basename: (path: string) => basename(path),
                dirname: (path: string) => dirname(path),
              },
              workspace: { mapRoots: (roots) => roots },
            },
            dispose: () => {},
          }),
        });
        reg.defineInstance(ITelemetryService, recordingTelemetry([]));
        reg.definePartialInstance(IGitService, {
          findWorkTree: (cwd: string) => findGitWorkTree(hostFs, cwd),
        });
        reg.define(IBashParserService, BashParserService);
        reg.define(IAgentPermissionPolicyService, AgentPermissionPolicyService);
      },
      strict: true,
    });
  });

  afterEach(async () => {
    disposables.dispose();
    await Promise.all(cleanupDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function evaluate(
    input: PolicyContextInput,
  ): Promise<PermissionPolicyEvaluation | undefined> {
    const svc = ix.get(IAgentPermissionPolicyService);
    return svc.evaluate(policyContext(input));
  }

  function setUserRequest(text: string): void {
    contextMessages.push({ role: 'user', content: [{ type: 'text', text }], toolCalls: [] });
  }

  it('still asks for Bash inside a git cwd in manual mode', async () => {
    await expect(
      evaluate({
        toolName: 'Bash',
        args: { command: 'printf first', timeout: 60 },
      }),
    ).resolves.toMatchObject({
      policyName: 'fallback-ask',
      result: { kind: 'ask' },
    });
  });

  it('approves Write to a path inside the git cwd', async () => {
    await expect(
      evaluate({
        toolName: 'Write',
        args: { path: 'src/a.ts', content: 'x' },
        accesses: ToolAccesses.writeFile(join(workspaceDir, 'src/a.ts')),
      }),
    ).resolves.toMatchObject({
      policyName: 'git-cwd-write-approve',
      result: { kind: 'approve' },
    });
  });

  it('approves Edit on an additionalDir path in manual mode', async () => {
    const extraDir = await mkdtemp(join(tmpdir(), 'omnicode-permission-extra-'));
    cleanupDirs.push(extraDir);
    workspace.addAdditionalDir(extraDir);
    await expect(
      evaluate({
        toolName: 'Edit',
        args: { path: join(extraDir, 'src/a.ts'), old_string: 'A', new_string: 'B' },
        accesses: ToolAccesses.readWriteFile(join(extraDir, 'src/a.ts')),
      }),
    ).resolves.toMatchObject({
      policyName: 'git-cwd-write-approve',
      result: { kind: 'approve' },
    });
  });

  it('asks for paths outside cwd and additionalDirs', async () => {
    const extraDir = await mkdtemp(join(tmpdir(), 'omnicode-permission-extra-'));
    cleanupDirs.push(extraDir);
    workspace.addAdditionalDir(extraDir);
    const outsidePath = join(`${extraDir}-evil`, 'outside.ts');
    await expect(
      evaluate({
        toolName: 'Write',
        args: { path: outsidePath, content: 'x' },
        accesses: ToolAccesses.writeFile(outsidePath),
      }),
    ).resolves.toMatchObject({
      policyName: 'fallback-ask',
      result: { kind: 'ask' },
    });
  });

  it('asks for git control files before git-cwd approval', async () => {
    await expect(
      evaluate({
        toolName: 'Write',
        args: { path: '.git/config', content: 'x' },
        accesses: ToolAccesses.writeFile(join(workspaceDir, '.git/config')),
      }),
    ).resolves.toMatchObject({
      policyName: 'git-control-path-access-ask',
      result: { kind: 'ask' },
    });
  });

  it('asks for sensitive files before git-cwd approval', async () => {
    await expect(
      evaluate({
        toolName: 'Write',
        args: { path: '.env', content: 'SECRET=1' },
        accesses: ToolAccesses.writeFile(join(workspaceDir, '.env')),
      }),
    ).resolves.toMatchObject({
      policyName: 'sensitive-file-access-ask',
      result: { kind: 'ask' },
    });
  });

  it('asks before Bash reads a sensitive file in auto mode', async () => {
    mode = 'auto';
    setUserRequest('show me the environment');
    await expect(
      evaluate({
        toolName: 'Bash',
        args: { command: 'cat .env' },
        accesses: [],
      }),
    ).resolves.toMatchObject({
      policyName: 'sensitive-file-access-ask',
      result: { kind: 'ask' },
    });
  });

  it('asks before Bash reads a quoted sensitive path', async () => {
    mode = 'auto';
    setUserRequest('show me the key');
    await expect(
      evaluate({
        toolName: 'Bash',
        args: { command: 'cat "$HOME/.ssh/id_rsa"' },
        accesses: [],
      }),
    ).resolves.toMatchObject({
      policyName: 'sensitive-file-access-ask',
      result: { kind: 'ask' },
    });
  });

  it.each([
    ['echo secret > .env', 'redirect write'],
    ['cp notes.txt .env', 'copy destination'],
    ['sed -i s/a/b/ .env', 'in-place edit'],
    ['curl --output=.env https://example.com', 'curl output'],
    ['dd if=/dev/zero of=.env', 'dd output'],
  ])('asks when a shell command writes a sensitive file: %s', async (command) => {
    mode = 'auto';
    setUserRequest('update the environment file');
    await expect(
      evaluate({
        toolName: 'Bash',
        args: { command },
        accesses: [],
      }),
    ).resolves.toMatchObject({
      policyName: 'sensitive-file-access-ask',
      result: { kind: 'ask' },
    });
  });

  it('does not ask for a shell command that reads an ordinary file or fetches a URL', async () => {
    mode = 'auto';
    setUserRequest('show me the readme and fetch a page');
    const readme = await evaluate({
      toolName: 'Bash',
      args: { command: 'cat README.md' },
      accesses: [],
    });
    expect(readme?.policyName).not.toBe('sensitive-file-access-ask');

    const fetch = await evaluate({
      toolName: 'Bash',
      args: { command: 'curl https://example.com' },
      accesses: [],
    });
    expect(fetch?.policyName).not.toBe('sensitive-file-access-ask');
  });

  it('asks before Grep searches a sensitive path', async () => {
    mode = 'auto';
    setUserRequest('search my keys');
    await expect(
      evaluate({
        toolName: 'Grep',
        args: { pattern: 'PRIVATE', path: '~/.ssh/id_ed25519' },
        accesses: ToolAccesses.searchTree(join(workspaceDir, '.ssh')),
      }),
    ).resolves.toMatchObject({
      policyName: 'sensitive-file-access-ask',
      result: { kind: 'ask' },
    });
  });

  it('does not ask when Bash reads an ordinary file', async () => {
    mode = 'auto';
    setUserRequest('show me the readme');
    const result = await evaluate({
      toolName: 'Bash',
      args: { command: 'cat README.md' },
      accesses: [],
    });
    expect(result?.policyName).not.toBe('sensitive-file-access-ask');
  });

  it('asks for workspace writes in auto mode when the user did not ask for an edit', async () => {
    mode = 'auto';
    setUserRequest('what does this repository do?');
    await expect(
      evaluate({
        toolName: 'Write',
        args: { path: 'src/a.ts', content: 'x' },
        accesses: ToolAccesses.writeFile(join(workspaceDir, 'src/a.ts')),
      }),
    ).resolves.toMatchObject({
      policyName: 'auto-mode-classifier',
      result: { kind: 'ask', reason: { auto_mode_classifier: 'context_missing_edit_intent' } },
    });
  });

  it('approves workspace writes in auto mode when the user asked for an edit', async () => {
    mode = 'auto';
    setUserRequest('refactor src/a.ts to use the new parser');
    await expect(
      evaluate({
        toolName: 'Write',
        args: { path: 'src/a.ts', content: 'x' },
        accesses: ToolAccesses.writeFile(join(workspaceDir, 'src/a.ts')),
      }),
    ).resolves.toMatchObject({
      policyName: 'auto-mode-classifier',
      result: { kind: 'approve' },
    });
  });

  it('does not use git-cwd approval in auto mode', async () => {
    mode = 'auto';
    setUserRequest('fix src/a.ts');
    await expect(
      evaluate({
        toolName: 'Write',
        args: { path: 'src/a.ts', content: 'x' },
        accesses: ToolAccesses.writeFile(join(workspaceDir, 'src/a.ts')),
      }),
    ).resolves.toMatchObject({
      policyName: 'auto-mode-classifier',
      result: { kind: 'approve' },
    });
  });

  it('does not approve Write when execution has no write file access', async () => {
    await expect(
      evaluate({
        toolName: 'Write',
        args: { path: 'src/a.ts', content: 'x' },
        accesses: ToolAccesses.none(),
      }),
    ).resolves.toMatchObject({
      policyName: 'fallback-ask',
      result: { kind: 'ask' },
    });
  });

  it('does not approve when any write access is outside the cwd', async () => {
    await expect(
      evaluate({
        toolName: 'Write',
        args: { path: 'src/a.ts', content: 'x' },
        accesses: [
          { kind: 'file', operation: 'write', path: join(workspaceDir, 'src/a.ts') },
          { kind: 'file', operation: 'write', path: join(tmpdir(), 'outside.ts') },
        ],
      }),
    ).resolves.toMatchObject({
      policyName: 'fallback-ask',
      result: { kind: 'ask' },
    });
  });
});

interface MutablePermissionRulesStubOptions {
  readonly rules?: () => readonly PermissionRule[];
  readonly sessionApprovalRulePatterns?: () => readonly string[];
}

function permissionRulesStub(
  options: MutablePermissionRulesStubOptions = {},
): Partial<PermissionRulesServiceContract> {
  const rules = options.rules ?? (() => []);
  const sessionApprovalRulePatterns = options.sessionApprovalRulePatterns ?? (() => []);
  return {
    get rules() {
      return rules();
    },
    get sessionApprovalRulePatterns() {
      return sessionApprovalRulePatterns();
    },
    addRules: () => {},
    recordApprovalResult: () => {},
  };
}

interface PolicyContextInput {
  readonly id?: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly accesses?: ToolAccessList;
}

function policyContext(input: PolicyContextInput): ResolvedToolExecutionHookContext {
  const toolCall = toolCallFor(input.id ?? `call_${input.toolName}`, input.toolName, input.args);
  const subject = ruleSubject(input.toolName, input.args);
  return {
    turnId: 0,
    signal,
    toolCall,
    toolCalls: [toolCall],
    args: input.args,
    execution: {
      description: description(input.toolName),
      display: display(input.toolName, input.args),
      accesses: input.accesses ?? accesses(input.toolName, input.args),
      approvalRule:
        subject === undefined ? input.toolName : literalRulePattern(input.toolName, subject),
      matchesRule:
        subject === undefined
          ? undefined
          : (ruleArgs) => matchesRuleSubject(input.toolName, ruleArgs, subject),
      execute: async () => ({ output: '' }),
    },
  };
}

function toolCallFor(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return {
    type: 'function',
    id,
    name,
    arguments: JSON.stringify(args),
  };
}

function ruleSubject(toolName: string, args: Record<string, unknown>): string | undefined {
  switch (toolName) {
    case 'Bash':
      return stringArg(args, 'command');
    case 'Read':
    case 'ReadMediaFile':
    case 'Write':
    case 'Edit':
      return stringArg(args, 'path');
    case 'Grep':
    case 'Glob':
      return stringArg(args, 'pattern');
    default:
      return undefined;
  }
}

function matchesRuleSubject(toolName: string, ruleArgs: string, subject: string): boolean {
  switch (toolName) {
    case 'Read':
    case 'ReadMediaFile':
    case 'Write':
    case 'Edit':
      return matchesPathRuleSubject(ruleArgs, subject, { cwd: '/workspace', pathClass: 'posix' });
    default:
      return matchesGlobRuleSubject(ruleArgs, subject);
  }
}

function description(toolName: string): string {
  switch (toolName) {
    case 'Bash':
      return 'run command';
    case 'Write':
      return 'write file';
    case 'Edit':
      return 'edit file';
    default:
      return `Approve ${toolName}`;
  }
}

function display(toolName: string, args: Record<string, unknown>): ToolInputDisplay {
  const path = stringArg(args, 'path', '/workspace/file.txt');
  switch (toolName) {
    case 'Bash':
      return { kind: 'command', command: stringArg(args, 'command') };
    case 'Read':
    case 'ReadMediaFile':
      return { kind: 'file_io', operation: 'read', path };
    case 'Write':
      return { kind: 'file_io', operation: 'write', path };
    case 'Edit':
      return { kind: 'file_io', operation: 'edit', path };
    default:
      return { kind: 'generic', summary: `Approve ${toolName}`, detail: args };
  }
}

function accesses(toolName: string, args: Record<string, unknown>): ToolAccessList {
  const path = stringArg(args, 'path');
  switch (toolName) {
    case 'Read':
    case 'ReadMediaFile':
      return path.length > 0 ? ToolAccesses.readFile(path) : ToolAccesses.none();
    case 'Write':
      return path.length > 0 ? ToolAccesses.writeFile(path) : ToolAccesses.none();
    case 'Edit':
      return path.length > 0 ? ToolAccesses.readWriteFile(path) : ToolAccesses.none();
    case 'Grep':
    case 'Glob':
      return path.length > 0 ? ToolAccesses.searchTree(path) : ToolAccesses.none();
    default:
      return ToolAccesses.none();
  }
}

function stringArg(args: Record<string, unknown>, key: string, fallback = ''): string {
  const value = args[key];
  return typeof value === 'string' ? value : fallback;
}

function workspaceStub(initialWorkDir: string): {
  readonly stub: ISessionWorkspaceContext;
  addAdditionalDir(dir: string): void;
} {
  let additionalDirs: string[] = [];
  const stub: ISessionWorkspaceContext = {
    _serviceBrand: undefined,
    workDir: initialWorkDir,
    get additionalDirs() {
      return additionalDirs;
    },
    resolve: (path) => path,
    isWithin: () => true,
    assertAllowed: (path) => path,
  };
  return {
    stub,
    addAdditionalDir: (dir) => {
      if (!additionalDirs.includes(dir)) additionalDirs = [...additionalDirs, dir];
    },
  };
}

function kaosStub(
  pathClass: HostEnvironmentService['pathClass'] = 'posix',
): HostEnvironmentService {
  return {
    _serviceBrand: undefined,
    osKind: 'Linux',
    osArch: 'x86_64',
    osVersion: 'test',
    shellName: 'bash',
    shellPath: '/bin/bash',
    pathClass,
    homeDir: '/home/test',
    ready: Promise.resolve(),
  };
}
