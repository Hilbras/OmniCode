import type { ChannelKind, ChannelSessionBinding } from './contracts';

export type ChannelCommandName = 'new' | 'stop' | 'status' | 'sessions' | 'bind' | 'unbind' | 'help';

export interface ChannelCommand {
  readonly name: ChannelCommandName;
  readonly args: readonly string[];
  readonly raw: string;
}

export interface ChannelCommandContext {
  readonly channel: ChannelKind;
  readonly conversationId: string;
  readonly bindings: {
    get(channel: ChannelKind, conversationId: string): ChannelSessionBinding | undefined;
    bind(binding: Omit<ChannelSessionBinding, 'updatedAt'> & { readonly updatedAt?: number }): ChannelSessionBinding;
    unbind(channel: ChannelKind, conversationId: string): boolean;
    list(channel?: ChannelKind): readonly ChannelSessionBinding[];
  };
  readonly createSession?: (input: { readonly workspaceRoot?: string }) => Promise<{ readonly sessionId: string; readonly workspaceRoot: string }>;
  readonly stopSession?: (sessionId: string) => Promise<boolean>;
  readonly listSessions?: () => Promise<readonly { readonly sessionId: string; readonly workspaceRoot: string }[]>;
}

export interface ChannelCommandResult {
  readonly handled: boolean;
  readonly command?: ChannelCommandName;
  readonly ok: boolean;
  readonly text: string;
  readonly binding?: ChannelSessionBinding;
}

const COMMANDS = new Set<ChannelCommandName>(['new', 'stop', 'status', 'sessions', 'bind', 'unbind', 'help']);

export function parseChannelCommand(text: string): ChannelCommand | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return undefined;
  const [head, ...args] = trimmed.split(/\s+/);
  const name = head?.slice(1).split('@')[0]?.toLowerCase();
  if (name === undefined || !COMMANDS.has(name as ChannelCommandName)) return undefined;
  return { name: name as ChannelCommandName, args, raw: trimmed };
}

export async function executeChannelCommand(text: string, context: ChannelCommandContext): Promise<ChannelCommandResult> {
  const command = parseChannelCommand(text);
  if (command === undefined) return { handled: false, ok: false, text: '' };
  const current = context.bindings.get(context.channel, context.conversationId);

  switch (command.name) {
    case 'help':
      return {
        handled: true,
        command: command.name,
        ok: true,
        text: 'Commands: /new [workspace] · /stop · /status · /sessions · /bind <sessionId> [workspace] · /unbind · /help',
      };
    case 'status': {
      if (current === undefined) {
        return { handled: true, command: command.name, ok: true, text: 'No OmniCode session is bound to this conversation.' };
      }
      return {
        handled: true,
        command: command.name,
        ok: true,
        text: `Bound session: ${current.sessionId}\nWorkspace: ${current.workspaceRoot}`,
        binding: current,
      };
    }
    case 'sessions': {
      const sessions = await context.listSessions?.() ?? [];
      const lines = sessions.length === 0
        ? ['No active sessions.']
        : sessions.map((session) => `- ${session.sessionId} (${session.workspaceRoot})`);
      return { handled: true, command: command.name, ok: true, text: lines.join('\n') };
    }
    case 'new': {
      if (context.createSession === undefined) {
        return { handled: true, command: command.name, ok: false, text: 'Session creation is not available.' };
      }
      const created = await context.createSession({ workspaceRoot: command.args[0] });
      const binding = context.bindings.bind({
        channel: context.channel,
        conversationId: context.conversationId,
        sessionId: created.sessionId,
        workspaceRoot: created.workspaceRoot,
      });
      return {
        handled: true,
        command: command.name,
        ok: true,
        text: `Started session ${created.sessionId} in ${created.workspaceRoot}.`,
        binding,
      };
    }
    case 'stop': {
      if (current === undefined) {
        return { handled: true, command: command.name, ok: false, text: 'No session is bound to this conversation.' };
      }
      const stopped = await context.stopSession?.(current.sessionId) ?? false;
      if (stopped) context.bindings.unbind(context.channel, context.conversationId);
      return {
        handled: true,
        command: command.name,
        ok: stopped,
        text: stopped ? `Stopped session ${current.sessionId}.` : `Session ${current.sessionId} could not be stopped.`,
      };
    }
    case 'bind': {
      const sessionId = command.args[0];
      if (sessionId === undefined) {
        return { handled: true, command: command.name, ok: false, text: 'Usage: /bind <sessionId> [workspaceRoot]' };
      }
      const binding = context.bindings.bind({
        channel: context.channel,
        conversationId: context.conversationId,
        sessionId,
        workspaceRoot: command.args[1] ?? current?.workspaceRoot ?? process.cwd(),
      });
      return { handled: true, command: command.name, ok: true, text: `Bound ${sessionId}.`, binding };
    }
    case 'unbind': {
      const removed = context.bindings.unbind(context.channel, context.conversationId);
      return { handled: true, command: command.name, ok: removed, text: removed ? 'Unbound this conversation.' : 'Nothing was bound.' };
    }
  }
}
