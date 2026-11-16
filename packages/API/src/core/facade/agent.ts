/**
 * The agent facade — one `session.agent(id)` handle over the agent-scope
 * services the wire exposes. Turn-driving calls (prompt / steer / cancel),
 * skill activation, permission mode, and commands go straight to their domain
 * services, as do shell commands, model, usage, plan, and task calls;
 * `getContext` merges two reads client-side. Prompt streaming is
 * NOT on this interface: it flows through the agent's `events` hub
 * (`turn.*`, `assistant.delta`, `tool.call.*`, `prompt.completed`, …).
 */

import type {
  AgentCommandInfo,
  AgentContextData,
  AgentFacade,
  AgentTaskInfo,
  McpServerEntry,
  PlanData,
  PromptLaunchResult,
  PromptWithSkillsResult,
  RuntimeBinding,
  SetModelResult,
  ShellCommandResult,
  ThinkingLevel,
  UsageStatus,
} from '@hilbras/omnicode-client-contract';

import type { ScopeRef } from '@hilbras/omnicode-rpc/channel';
import type { ScopedCaller } from './session.js';

export type * from '@hilbras/omnicode-client-contract/facade-agent';

export function createAgentFacade(call: ScopedCaller, scope: ScopeRef): AgentFacade {
  return {
    prompt: (input) =>
      call(scope, 'agentPromptService', 'submit', [input]) as Promise<PromptLaunchResult>,
    promptWithSkills: (input) =>
      call(scope, 'agentSkillService', 'promptWithSkills', [
        input,
      ]) as Promise<PromptWithSkillsResult>,
    steer: (input) =>
      call(scope, 'agentPromptService', 'submitSteer', [input]) as Promise<PromptLaunchResult>,
    activateSkill: (input) =>
      call(scope, 'agentSkillService', 'activate', [input]) as Promise<PromptLaunchResult>,
    cancel: (input) =>
      // No turnId sends an empty arg list: `[undefined]` would cross the wire
      // as `[null]`, and `cancelFromUser(null)` would not match the active turn.
      call(
        scope,
        'agentLoopService',
        'cancelFromUser',
        input?.turnId === undefined ? [] : [input.turnId],
      ) as Promise<void>,
    runShellCommand: (input) =>
      call(scope, 'agentShellCommandService', 'run', [input]) as Promise<ShellCommandResult>,
    cancelShellCommand: (input) =>
      call(scope, 'agentShellCommandService', 'cancel', [input.commandId]) as Promise<void>,
    getModel: () => call(scope, 'agentProfileService', 'getModel', []) as Promise<string>,
    setModel: (model) =>
      call(scope, 'agentProfileService', 'setModel', [model]) as Promise<SetModelResult>,
    getThinking: () =>
      call(scope, 'agentProfileService', 'getEffectiveThinkingLevel', []) as Promise<ThinkingLevel>,
    setThinking: (level) =>
      call(scope, 'agentProfileService', 'setThinking', [level]) as Promise<void>,
    setPermission: (mode) =>
      call(scope, 'agentPermissionModeService', 'setModeAndBroadcast', [mode]) as Promise<void>,
    getUsage: () => call(scope, 'agentUsageService', 'status', []) as Promise<UsageStatus>,
    getContext: async () => {
      const [history, tokenCount] = await Promise.all([
        call(scope, 'agentContextMemoryService', 'get', []),
        call(scope, 'agentTokenCountingService', 'statusSize', []),
      ]);
      return { history, tokenCount } as AgentContextData;
    },
    listCommands: () =>
      call(scope, 'agentCommandService', 'list', []) as Promise<readonly AgentCommandInfo[]>,
    runCommand: (input) =>
      // Same `[undefined]` → `[null]` wire hazard as `cancel`: the engine's
      // `args = ''` default only applies to a missing arg.
      call(
        scope,
        'agentCommandService',
        'run',
        input.args === undefined ? [input.name] : [input.name, input.args],
      ) as Promise<void>,
    getRuntime: () =>
      call(scope, 'agentRuntimeBindingService', 'get', []) as Promise<RuntimeBinding>,
    switchRuntime: (runtimeId) =>
      call(scope, 'agentRuntimeBindingService', 'switch', [runtimeId]) as Promise<RuntimeBinding>,
    getPlan: () => call(scope, 'agentPlanService', 'status', []) as Promise<PlanData>,
    enterPlan: () => call(scope, 'agentPlanService', 'enter', []) as Promise<void>,
    clearPlan: () => call(scope, 'agentPlanService', 'clear', []) as Promise<void>,
    cancelPlan: (input) => call(scope, 'agentPlanService', 'cancel', [input?.id]) as Promise<void>,
    getTasks: (input) =>
      call(scope, 'agentTaskService', 'list', [
        input?.activeOnly ?? false,
        input?.limit,
      ]) as Promise<readonly AgentTaskInfo[]>,
    stopTask: async (input) => {
      if (input.reason === undefined) {
        await call(scope, 'agentTaskService', 'stopByUser', [input.taskId]);
        return;
      }
      await call(scope, 'agentTaskService', 'stop', [input.taskId, input.reason]);
    },
    getTaskOutput: (input) =>
      call(scope, 'agentTaskService', 'readOutput', [input.taskId, input.tail]) as Promise<string>,
    getMcpServers: () =>
      call(scope, 'agentMcpService', 'list', []) as Promise<readonly McpServerEntry[]>,
    compact: (input) =>
      call(scope, 'agentFullCompactionService', 'begin', [
        { source: 'manual', instruction: input?.instruction },
      ]) as Promise<boolean>,
  };
}
