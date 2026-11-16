export {
  createOmnicodeWebApi,
  type CreateOmnicodeWebApiDeps,
  buildRestUrl,
  buildWsUrl,
  DaemonEventSocket,
  type DaemonEventSocketHandlers,
  type DaemonEventSocketOptions,
} from '@hilbras/app-core/api';
export type {
  OmnicodeWebApi,
  AppSession,
  AppMessage,
  AppMessageRole,
  AppMessageContent,
  PromptSubmission,
  PromptSubmitResult,
  AppModel,
  Page,
  PageRequest,
  SessionTranscriptPage,
  SessionTranscriptQuery,
  AppSessionRuntimeStatus,
  AppTask,
  AppTaskStatus,
} from '@hilbras/app-core/api';
export type {
  ClientIdentity,
  CredentialStore,
  Tracer,
  Translator,
} from '@hilbras/app-core/contracts';
export { noopTracer } from '@hilbras/app-core/contracts';
