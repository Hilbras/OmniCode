export {
  DeviceCodeExpiredError,
  DeviceCodeTimeoutError,
  OAuthAccessDeniedError,
  OAuthConnectionError,
  OAuthError,
  OAuthUnauthorizedError,
  RetryableRefreshError,
} from './errors';

export type {
  DeviceAuthorization,
  DeviceHeaders,
  OAuthFlowConfig,
  OAuthStorageBackend,
  OAuthTokenInspection,
  TokenInfo,
  TokenInfoWire,
} from './types';
export { tokenFromWire, tokenToWire } from './types';

export type { TokenStorage } from './storage';
export { FileTokenStorage } from './storage';

export type { DevicePollResult, RefreshOptions } from './oauth';
export { pollDeviceToken, refreshAccessToken, requestDeviceAuthorization } from './oauth';

export type { LoginOptions, OAuthManagerOptions, OAuthRefreshOutcome } from './oauth-manager';
export { OAuthManager, defaultRefreshThreshold, newInstanceId } from './oauth-manager';

export {
  assertOmnicodeHostIdentity,
  createOmnicodeDefaultHeaders,
  createOmnicodeDeviceHeaders,
  createOmnicodeDeviceId,
  createOmnicodeUserAgent,
  OMNICODE_CUSTOM_HEADERS_ENV,
  OMNICODE_PLATFORM,
  parseOmnicodeCodeCustomHeaders,
  readOmnicodeDeviceId,
  replaceUserAgentProduct,
} from './identity';
export type { OmnicodeHostIdentity, OmnicodeIdentityOptions } from './identity';

export { OMNICODE_FLOW_CONFIG } from './constants';

export {
  OMNICODE_REGION_MARKER_FILENAME,
  OMNICODE_REGION_PROFILES,
  omnicodeCdnContentUrl,
  omnicodeRegionLoginHosts,
  omnicodeRegionProfile,
  omnicodeRegionSchema,
  resolveOmnicodeRegion,
  resolveOmnicodeRemoteControlAuth,
} from './region';
export type {
  OmnicodeRegion,
  OmnicodeRegionProfile,
  OmnicodeRemoteControlAuth,
  ResolveOmnicodeRegionOptions,
} from './region';

export {
  applyManagedApiKeyProviderModels,
  applyManagedOmnicodeCodeLogoutConfig,
  applyManagedOmnicodeCodeConfig,
  clearManagedOmnicodeCodeConfig,
  fetchManagedOmnicodeCodeModels,
  omnicodeCodeEnvBaseUrl,
  omnicodeCodeEnvOAuthHost,
  OMNICODE_OAUTH_KEY,
  OMNICODE_PLATFORM_ID,
  OMNICODE_PROVIDER_NAME,
  ManagedOmnicodeCodeModelsAuthError,
  provisionManagedOmnicodeCodeConfig,
  resolveOmnicodeCodeLoginAuth,
  resolveOmnicodeCodeOAuthKey,
  resolveOmnicodeCodeOAuthRef,
  resolveOmnicodeCodeRuntimeAuth,
  toManagedModelAlias,
} from './managed-omnicode';
export type {
  FetchManagedOmnicodeCodeModelsOptions,
  ManagedOmnicodeCodeApplyResult,
  ManagedOmnicodeCodeCleanupResult,
  ManagedOmnicodeCodeProtocol,
  ManagedOmnicodeEnv,
  ManagedOmnicodeLoginAuth,
  ManagedOmnicodeCodeModelInfo,
  ManagedOmnicodeCodeProvisionResult,
  ManagedOmnicodeConfigAdapter,
  ManagedOmnicodeConfigShape,
  ManagedOmnicodeOAuthRef,
  ManagedOmnicodeOAuthRefInput,
  ManagedOmnicodeRuntimeAuth,
  ProvisionManagedOmnicodeCodeConfigOptions,
} from './managed-omnicode';

export {
  fetchManagedUserInfo,
  omnicodeCodeUserInfoUrl,
  managedUserInfoPhoneSchema,
  managedUserInfoResultSchema,
  managedUserInfoSchema,
  parseManagedUserInfoPayload,
} from './managed-userinfo';
export type {
  FetchManagedUserInfoError,
  FetchManagedUserInfoResult,
  ManagedUserInfo,
  ManagedUserInfoPhone,
  ManagedUserInfoResult,
} from './managed-userinfo';

export {
  boosterWalletInfoSchema,
  fetchManagedUsage,
  formatDuration,
  isManagedOmnicodeCode,
  isManagedOmnicodeCodeBaseUrl,
  omnicodeCodeBaseUrl,
  omnicodeCodeUsageUrl,
  managedQuotaEntrySchema,
  managedQuotaSchema,
  managedQuotaUsagesSchema,
  managedUsageResultSchema,
  parseManagedUsagePayload,
} from './managed-usage';
export type {
  BoosterWalletInfo,
  FetchManagedUsageError,
  FetchManagedUsageResult,
  ManagedQuota,
  ManagedQuotaEntry,
  ManagedQuotaUsages,
  ManagedUsageResult,
} from './managed-usage';

export { fetchChatTitle, omnicodeCodeToolsUrl } from './managed-tools';
export type {
  FetchChatTitleError,
  FetchChatTitleOk,
  FetchChatTitleResult,
} from './managed-tools';

export { fetchSubmitFeedback, omnicodeCodeFeedbackUrl } from './managed-feedback';
export type {
  FetchSubmitFeedbackError,
  FetchSubmitFeedbackOk,
  FetchSubmitFeedbackResult,
  SubmitFeedbackBody,
} from './managed-feedback';

export {
  fetchCompleteFeedbackUpload,
  fetchCreateFeedbackUploadUrl,
  omnicodeCodeFeedbackUploadCompleteUrl,
  omnicodeCodeFeedbackUploadUrl,
} from './managed-feedback-upload';
export type {
  CompleteFeedbackUploadBody,
  CreateFeedbackUploadUrlBody,
  CreateFeedbackUploadUrlResponse,
  FetchCompleteFeedbackUploadResult,
  FetchCreateFeedbackUploadUrlResult,
  FetchFeedbackUploadError,
} from './managed-feedback-upload';

export {
  applyOpenPlatformConfig,
  capabilitiesForModel,
  fetchOpenPlatformModels,
  filterModelsByPrefix,
  getOpenPlatformById,
  isOpenPlatformId,
  OPEN_PLATFORMS,
  OpenPlatformApiError,
  removeOpenPlatformConfig,
} from './open-platform';
export type {
  ApplyOpenPlatformResult,
  OpenPlatformDefinition,
} from './open-platform';

export {
  applyCustomRegistryEntries,
  applyCustomRegistryProvider,
  capabilitiesFromCustomEntry,
  credentialEnvHints,
  CustomRegistryApiError,
  CUSTOM_REGISTRY_DEFAULT_CAPABILITIES,
  customRegistryReplacementKeys,
  fetchCustomRegistry,
  readCustomRegistrySource,
  removeCustomRegistryEntries,
  removeCustomRegistryProvider,
} from './custom-registry';
export type {
  CustomRegistryModelEntry,
  CustomRegistryProviderEntry,
  CustomRegistryProviderType,
  CustomRegistryRemoval,
  CustomRegistryReplacementKeys,
  CustomRegistrySource,
  FetchCustomRegistryOptions,
} from './custom-registry';

export {
  applyDiscoveredModels,
  applyProtocolOverrides,
  DiscoveredModelsAuthError,
  fetchDiscoveredModels,
  normalizeDiscoveryBaseUrl,
  resolveProtocolOverride,
} from './discover-models';
export type {
  DiscoveredModelInfo,
  DiscoveryAuthStyle,
  FetchDiscoveredModelsOptions,
  ProtocolOverrideMap,
} from './discover-models';

export {
  apiKeyEnvMissingMessage,
  credentialConflictMessage,
  declaredProviderCredential,
  reconcileProviderCredentialUpdate,
} from './provider-credential';
export type {
  DeclaredProviderCredential,
  ProviderCredentialReconciliation,
  ProviderCredentialUpdate,
  ProviderCredentialView,
} from './provider-credential';

export { OmnicodeOAuthToolkit, resolveOmnicodeTokenStorageName } from './toolkit';
export type {
  AuthManagedUsageResult,
  AuthManagedUserInfoResult,
  AuthProviderStatus,
  AuthStatus,
  BearerTokenProvider,
  OmnicodeOAuthLoginOptions,
  OmnicodeOAuthLoginResult,
  OmnicodeOAuthLogoutResult,
  OmnicodeOAuthTokenRef,
  OmnicodeOAuthToolkitOptions,
} from './toolkit';

export { refreshProviderModels } from './refreshProviderModels';
export type {
  ProviderChange,
  RefreshProviderHost,
  RefreshProviderOptions,
  RefreshProviderScope,
  RefreshResult,
} from './refreshProviderModels';

export type { OAuthTokenTransactionOptions } from './oauth-token-transaction';
export { OAuthTokenTransaction } from './oauth-token-transaction';
