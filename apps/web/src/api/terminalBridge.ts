import type {
  AppTerminal,
  OmnicodeEventConnection,
  OmnicodeWebApi,
} from '@hilbras/app-core/api';

/** The bridge surface components consume (no private fields — keeps Vue
 *  template pass-through assignability simple). */
export interface SessionTerminalBridgeLike {
  attach(terminalId: string): void;
  write(terminalId: string, data: string): void;
  resize(terminalId: string, cols: number, rows: number): void;
  onOutput(handler: (terminalId: string, data: string) => void): () => void;
  onExit(handler: (terminalId: string, exitCode: number | null) => void): () => void;
}

export interface TerminalCreateInput {
  cwd?: string;
  shell?: string;
  cols?: number;
  rows?: number;
}

/**
 * Session-scoped terminal bridge over the daemon API.
 *
 * Owns one event connection whose `onTerminalOutput` / `onTerminalExit`
 * frames fan out to subscribed views. Framework-free so the flow is testable
 * without a DOM: the Vue layer owns reactivity, this owns the protocol.
 */
export class SessionTerminalBridge implements SessionTerminalBridgeLike {
  private connection: OmnicodeEventConnection | undefined;
  private readonly outputHandlers = new Set<(terminalId: string, data: string) => void>();
  private readonly exitHandlers = new Set<(terminalId: string, exitCode: number | null) => void>();

  constructor(
    private readonly api: OmnicodeWebApi,
    private readonly sessionId: string,
  ) {}

  list(): Promise<readonly AppTerminal[]> {
    return this.api.listTerminals(this.sessionId);
  }

  async create(input?: TerminalCreateInput): Promise<AppTerminal> {
    const terminal = await this.api.createTerminal(this.sessionId, input);
    this.ensureConnection();
    this.connection?.terminalAttach(this.sessionId, terminal.id);
    return terminal;
  }

  /** Re-attach an existing terminal (e.g. after the panel reopens). */
  attach(terminalId: string): void {
    this.ensureConnection();
    this.connection?.terminalAttach(this.sessionId, terminalId);
  }

  async close(terminalId: string): Promise<void> {
    this.connection?.terminalClose(this.sessionId, terminalId);
    await this.api.closeTerminal(this.sessionId, terminalId);
  }

  write(terminalId: string, data: string): void {
    this.connection?.terminalInput(this.sessionId, terminalId, data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    this.connection?.terminalResize(this.sessionId, terminalId, cols, rows);
  }

  /** Subscribe to PTY output frames for attached terminals. */
  onOutput(handler: (terminalId: string, data: string) => void): () => void {
    this.ensureConnection();
    this.outputHandlers.add(handler);
    return () => this.outputHandlers.delete(handler);
  }

  /** Subscribe to terminal exit frames. */
  onExit(handler: (terminalId: string, exitCode: number | null) => void): () => void {
    this.ensureConnection();
    this.exitHandlers.add(handler);
    return () => this.exitHandlers.delete(handler);
  }

  dispose(): void {
    this.outputHandlers.clear();
    this.exitHandlers.clear();
    this.connection?.close();
    this.connection = undefined;
  }

  private ensureConnection(): void {
    if (this.connection !== undefined) return;
    this.connection = this.api.connectEvents({
      onEvent: () => undefined,
      onResync: () => undefined,
      onConnectionChange: () => undefined,
      onError: () => undefined,
      onTerminalOutput: (sessionId, terminalId, data) => {
        if (sessionId !== this.sessionId) return;
        for (const handler of this.outputHandlers) handler(terminalId, data);
      },
      onTerminalExit: (sessionId, terminalId, exitCode) => {
        if (sessionId !== this.sessionId) return;
        for (const handler of this.exitHandlers) handler(terminalId, exitCode);
      },
    });
  }
}
