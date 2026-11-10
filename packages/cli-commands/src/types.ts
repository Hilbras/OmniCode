export type CommandAvailability = 'always' | 'idle-only' | ((args: string) => 'always' | 'idle-only');

export interface CommandCompletionItem {
  readonly value: string;
  readonly label?: string;
  readonly description?: string;
}

export interface CommandContext {
  readonly cwd: string;
  readonly sessionId?: string;
  readonly signal?: AbortSignal;
  readonly [key: string]: unknown;
}

export interface CommandResult {
  readonly ok: boolean;
  readonly message?: string;
  readonly data?: unknown;
}

export interface CommandDefinition {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly usage?: string;
  readonly category?: string;
  readonly priority?: number;
  readonly hidden?: boolean;
  readonly enabled?: boolean;
  readonly experimentalFlag?: string;
  readonly availability?: CommandAvailability;
  readonly completeArgs?: (argumentPrefix: string) => readonly CommandCompletionItem[] | null;
  readonly execute?: (args: string, context: CommandContext) => Promise<CommandResult> | CommandResult;
}

export interface CommandListOptions {
  readonly includeHidden?: boolean;
  readonly includeDisabled?: boolean;
  readonly category?: string;
}
