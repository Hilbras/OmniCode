/**
 * The agent facade — one `session.agent(id)` handle over the agent-scope
 * services the wire exposes. Turn-driving calls (prompt / steer / cancel),
 * skill activation, permission mode, and commands go straight to their domain
 * services, as do shell commands, model, usage, plan, and task calls;
 * `getContext` merges two reads client-side. Prompt streaming is
 * NOT on this interface: it flows through the agent's `events` hub
 * (`turn.*`, `assistant.delta`, `tool.call.*`, `prompt.completed`, …).
 */

import type { IAgentCommandService } from '@hilbras/omnicode-engine/agent/command/agentCommand';
import type { IAgentContextMemoryService } from '@hilbras/omnicode-engine/agent/contextMemory/contextMemory';
import type { IAgentMcpService } from '@hilbras/omnicode-engine/agent/mcp/mcp';
import type { PermissionMode } from '@hilbras/omnicode-engine/agent/permissionPolicy/types';
import type { IAgentProfileService } from '@hilbras/omnicode-engine/agent/profile/profile';
import type { IAgentRuntimeBindingService } from '@hilbras/omnicode-engine/agent/runtimeBinding/runtimeBinding';
import type { IAgentShellCommandService } from '@hilbras/omnicode-engine/agent/shellCommand/shellCommand';
import type { IAgentTaskService } from '@hilbras/omnicode-engine/agent/task/task';
import type { IAgentPlanService } from '@hilbras/omnicode-engine/features/plan/plan';
import type { IAgentSkillService } from '@hilbras/omnicode-engine/features/skill/skillService';
import type { ContentPart } from '@hilbras/omnicode-engine/human/llm/message';
import type { ISessionTokenCountingService } from '@hilbras/omnicode-engine/session/tokenCounting/sessionTokenCounting';
import type { ISessionUsageService } from '@hilbras/omnicode-engine/session/usage/sessionUsage';

// Wire-type aliases derived through the engine service interfaces (keeps the
// client contract free of protocol-package imports).
export type PromptLaunchResult =
  | import('@hilbras/omnicode-engine/agent/loop/loop').PromptLaunchResult
  | undefined;
export type PromptWithSkillsInput = Parameters<IAgentSkillService['promptWithSkills']>[0];
export type PromptWithSkillsResult = Awaited<ReturnType<IAgentSkillService['promptWithSkills']>>;
export type ShellCommandResult = Awaited<ReturnType<IAgentShellCommandService['run']>>;
export type SetModelResult = Awaited<ReturnType<IAgentProfileService['setModel']>>;
export type ThinkingLevel = ReturnType<IAgentProfileService['getEffectiveThinkingLevel']>;
export type UsageStatus = Awaited<ReturnType<ISessionUsageService['status']>>;
export type AgentContextData = {
  history: ReturnType<IAgentContextMemoryService['get']>;
  tokenCount: ReturnType<ISessionTokenCountingService['statusSize']>;
};
export type AgentCommandInfo = Awaited<ReturnType<IAgentCommandService['list']>>[number];
export type RuntimeBinding = ReturnType<IAgentRuntimeBindingService['get']>;
export type PlanData = Awaited<ReturnType<IAgentPlanService['status']>>;
export type AgentTaskInfo = Awaited<ReturnType<IAgentTaskService['list']>>[number];
export type McpServerEntry = ReturnType<IAgentMcpService['list']>[number];

export interface AgentFacade {
  prompt(input: { input: readonly ContentPart[]; promptId?: string }): Promise<PromptLaunchResult>;
  /**
   * Submit one prompt with one or more skill activations bundled into the
   * same user message: the skills are validated up front (an unknown name or
   * an empty list rejects the whole submission), rendered ahead of the
   * caller's parts in the same turn, and the bundle undoes as a single
   * anchor. Resolves with the submitted bundle's queue identity (`prompt_id`
   * / `created_at` / `state`), plus `turn_id` once launched — `state` is
   * `queued` when the submission queued behind a running turn.
   */
  promptWithSkills(input: PromptWithSkillsInput): Promise<PromptWithSkillsResult>;
  steer(input: { input: readonly ContentPart[] }): Promise<PromptLaunchResult>;
  /**
   * Activate a skill as a user-slash activation: the engine renders the skill
   * prompt and drives it as a normal turn (same settlement/event flow as
   * `prompt`). Resolves with the launched turn id; rejects when the skill is
   * unknown or the agent is busy.
   */
  activateSkill(input: { name: string; args?: string }): Promise<PromptLaunchResult>;
  cancel(input?: { turnId?: number }): Promise<void>;
  runShellCommand(input: { command: string; commandId?: string }): Promise<ShellCommandResult>;
  cancelShellCommand(input: { commandId: string }): Promise<void>;
  getModel(): Promise<string>;
  setModel(model: string): Promise<SetModelResult>;
  getThinking(): Promise<ThinkingLevel>;
  setThinking(level: string): Promise<void>;
  setPermission(mode: PermissionMode): Promise<void>;
  getUsage(): Promise<UsageStatus>;
  getContext(): Promise<AgentContextData>;
  listCommands(): Promise<readonly AgentCommandInfo[]>;
  runCommand(input: { name: string; args?: string }): Promise<void>;
  getRuntime(): Promise<RuntimeBinding>;
  switchRuntime(runtimeId: string): Promise<RuntimeBinding>;
  getPlan(): Promise<PlanData>;
  enterPlan(): Promise<void>;
  clearPlan(): Promise<void>;
  cancelPlan(input?: { id?: string }): Promise<void>;
  getTasks(input?: { activeOnly?: boolean; limit?: number }): Promise<readonly AgentTaskInfo[]>;
  stopTask(input: { taskId: string; reason?: string }): Promise<void>;
  getTaskOutput(input: { taskId: string; tail?: number }): Promise<string>;
  /**
   * Session-merged MCP server entries (workspace set + ephemeral session
   * overlay). This is a live snapshot, so entries may still be pending while
   * the initial connection attempt runs.
   */
  getMcpServers(): Promise<readonly McpServerEntry[]>;
  /**
   * Trigger a manual full compaction. Async: `true` means the compaction was
   * started (it runs in the background); `false` means one is already running.
   * Throws when there is nothing to compact or a turn is active.
   */
  compact(input?: { instruction?: string }): Promise<boolean>;
}
