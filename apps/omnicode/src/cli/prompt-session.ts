import type {
  ConfigDiagnostics,
  CreateSessionOptions,
  OmnicodeAuthFacade,
  OmnicodeConfig,
  ListSessionsOptions,
  ResumeSessionInput,
  Session,
  SessionSummary,
  TelemetryProperties,
} from '@hilbras/omnicode-sdk';

export interface PromptHarness {
  readonly homeDir: string;
  readonly auth: OmnicodeAuthFacade;

  track(event: string, properties?: TelemetryProperties): void;

  ensureConfigFile(): Promise<void>;
  getConfig(): Promise<Pick<OmnicodeConfig, 'defaultModel' | 'telemetry'>>;
  getConfigDiagnostics(): Promise<ConfigDiagnostics>;
  listSessions(options: ListSessionsOptions): Promise<readonly SessionSummary[]>;
  createSession(options: CreateSessionOptions): Promise<Session>;
  resumeSession(input: ResumeSessionInput): Promise<Session>;
  close(): Promise<void>;
}
