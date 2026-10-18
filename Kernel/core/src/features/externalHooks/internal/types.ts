import type { ContentPart } from '#human/llm/message';

export const HOOK_EVENT_TYPES = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionResult',
  'UserPromptSubmit',
  'UserPromptQueued',
  'TurnStarted',
  'Stop',
  'StopFailure',
  'Interrupt',
  'SessionStart',
  'SessionEnd',
  'SessionHeartbeat',
  'SubagentStart',
  'SubagentStop',
  'TaskStarted',
  'PreCompact',
  'PostCompact',
  'Notification',
] as const;

export type HookEventType = (typeof HOOK_EVENT_TYPES)[number];

export interface HookDef {
  readonly event: HookEventType;
  readonly matcher?: string;
  readonly command: string;
  readonly timeout?: number;
  readonly cwd?: string;
  readonly env?: Record<string, string>;
}

export type HookAction = 'allow' | 'block' | 'approve';

export interface HookResult {
  readonly action: HookAction;
  readonly message?: string;
  readonly reason?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly timedOut?: boolean;
  readonly errored?: boolean;
  readonly structuredOutput?: boolean;
}

export interface HookBlockDecision {
  readonly kind: 'block';
  readonly reason: string;
}

export interface HookApproveDecision {
  readonly kind: 'approve';
  readonly reason?: string;
}

export type HookDecision = HookBlockDecision | HookApproveDecision | undefined;

export type HookMatcherValue = string | readonly ContentPart[];
