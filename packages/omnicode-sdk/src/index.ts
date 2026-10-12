export { OmnicodeHarness } from '#/omnicode-harness';
export type { OmnicodeHarnessRuntimeOptions } from '#/omnicode-harness';
export { Session } from '#/session';
export { OmnicodeAuthFacade } from '#/auth';
export {
  createOmnicodeHarness,
  SDKRpcClientV2,
  type SDKRpcClientV2Options,
} from '#/sdk-rpc-client-v2';
export {
  createOmnicodeConfigRpc,
  OmnicodeConfigRpcClient,
  type OmnicodeConfigRpc,
  type OmnicodeConfigValidationIssue,
  type OmnicodeConfigValidationPathSegment,
  type ResolveOmnicodeConfigPathInput,
  type ValidateOmnicodeConfigTomlInput,
} from '#/config-rpc';
export { SDKRpcClientBase } from '#/rpc';
export { OmnicodeForCodingProvider } from '#/omnicode-model-provider';
export type { OmnicodeForCodingProviderOptions } from '#/omnicode-model-provider';
export { removeProviderFromConfig } from '#/v2/config-mapper';
export { providerEndpointEnvNames } from '#/provider-endpoint';
export type { ProviderEndpointEnvNames } from '#/provider-endpoint';

export {
  applyCatalogProvider,
  catalogBaseUrl,
  catalogModelToAlias,
  catalogProviderModels,
  CatalogFetchError,
  RegistryImportError,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  inferWireType,
  loadBuiltInCatalog,
  resolveCatalogImport,
} from '#/catalog';
export type {
  ApplyCatalogProviderOptions,
  Catalog,
  CatalogImportInvalidReason,
  CatalogImportResolution,
  CatalogModel,
  CatalogProviderEntry,
  FetchCatalogOptions,
} from '#/catalog';

export {
  ErrorCodes,
  OmnicodeError,
  type OmnicodeErrorCode,
  type OmnicodeErrorInfo,
  type OmnicodeErrorOptions,
  type OmnicodeErrorPayload,
  OMNICODE_ERROR_INFO,
  fromOmnicodeErrorPayload,
  isOmnicodeError,
  toOmnicodeErrorPayload,
} from '#/errors';

export {
  flushDiagnosticLogs,
  flushDiagnosticLogsSync,
  log,
  redact,
  resolveGlobalLogPath,
} from '#/logging/index';
export { resolveOmnicodeHome } from '@hilbras/omnicode-core';
export type { LogContext, LogLevel, LogPayload, Logger } from '#/logging/index';

export { effectiveModelAlias, loadRuntimeConfigSafe } from '#/config/index';
export { resolveConfigPath } from '@hilbras/omnicode-core';
export { limitAgentReplayByTurns } from '#/replay';
export { parseAgentFileText, resolveAgentPath } from '@hilbras/omnicode-core';
export { SECONDARY_DERIVED_MODEL_ALIAS } from '#/config/index';
export { PRIMARY_SUBAGENT_MODEL_CHOICE } from '@hilbras/omnicode-core/session/subagent/configSection';

export { installGlobalProxyDispatcher } from '#/proxy';

export {
  buildImageCompressionCaption,
  buildUnsupportedImageNotice,
  gateImageFormatParts,
  isModelAcceptedImageMime,
  normalizeImageMime,
  parseImageDataUrl,
  persistOriginalImage,
  sessionMediaOriginalsDir,
  IMAGE_BYTE_BUDGET,
  MAX_IMAGE_EDGE_PX,
} from '@hilbras/omnicode-core';
export { compressBase64ForModel, compressImageForModel, ImageLimits } from '#/image';
export type {
  CompressImageOptions,
  CompressImageResult,
  CompressBase64Result,
  ImageCompressionCaptionInput,
  ImageCompressionTelemetry,
} from '#/image';

export type {
  ExperimentalFeatureState,
  ExperimentalFlagMap,
  ExperimentalFlagSource,
  FlagDefinition,
  FlagDefinitionInput,
  FlagId,
  FlagSurface,
} from '#/flag';

export {
  buildDaemonFileUrl,
  buildMediaPathTag,
  isDaemonFileUrl,
  matchSingleMediaPathTag,
  parseDaemonFileUrl,
} from '@hilbras/omnicode-core/agent/media/mediaRef';
export type {
  DaemonFileRef,
  MediaKind,
} from '@hilbras/omnicode-core/agent/media/mediaRef';

export type {
  OmnicodeAuthCompleteFeedbackUploadInput,
  OmnicodeAuthCompleteFeedbackUploadPart,
  OmnicodeAuthCreateFeedbackUploadUrlInput,
  OmnicodeAuthCreateFeedbackUploadUrlOk,
  OmnicodeAuthCreateFeedbackUploadUrlResult,
  OmnicodeAuthFeedbackUploadPart,
  OmnicodeAuthLoginResult,
  OmnicodeAuthLogoutResult,
  OmnicodeAuthRefreshResult,
  OmnicodeAuthSubmitFeedbackInput,
} from '#/auth';

export * from '#/events';
export type * from '#/types';
