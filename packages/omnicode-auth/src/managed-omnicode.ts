import { createHash } from 'node:crypto';

import { readApiErrorMessage } from './api-error';
import { DEFAULT_OMNICODE_OAUTH_HOST } from './constants';
import { OAuthUnauthorizedError } from './errors';
import { parseOmnicodeCodeCustomHeaders } from './identity';
import { DEFAULT_OMNICODE_BASE_URL, omnicodeCodeBaseUrl } from './managed-usage';
import { MANAGED_OMNICODE_MODEL_FIELDS, mergeRefreshedModelAlias } from './model-alias-merge';
import { isRecord } from './utils';

export const OMNICODE_PLATFORM_ID = 'omnicode';
export const OMNICODE_PROVIDER_NAME = 'managed:omnicode';
export const OMNICODE_OAUTH_KEY = 'oauth/omnicode';
const OMNICODE_SCOPED_OAUTH_KEY_PREFIX = 'oauth/omnicode-env-';

/**
 * Wires a model alias may pin itself to, independent of its provider's wire.
 *
 * `omnicode` and `openai_responses` are reachable because the managed endpoint
 * declares them (`response` on the wire is normalized to `openai_responses`).
 * `openai` and `google-genai` are the two remaining `ProtocolSchema` members,
 * added so a hand-written gateway can pin a model to a wire its provider does
 * not default to. Without them the parse below returned `undefined`, the alias
 * fell back to the provider's wire, and a model served over a different
 * protocol failed on first use with no way for the user to say otherwise.
 */
export type ManagedOmnicodeCodeProtocol =
  | 'omnicode'
  | 'anthropic'
  | 'openai_responses'
  | 'openai'
  | 'google-genai';

export function parseModelProtocol(value: unknown): ManagedOmnicodeCodeProtocol | undefined {
  if (value === 'anthropic') return 'anthropic';
  // The managed endpoint spells this wire `response` on the wire.
  if (value === 'response') return 'openai_responses';
  if (value === 'openai_responses') return 'openai_responses';
  if (value === 'openai') return 'openai';
  if (value === 'google-genai') return 'google-genai';
  // `omnicode` has no upstream spelling — the managed endpoint never declares it,
  // and it is accepted only when a config author writes it by hand.
  if (value === 'omnicode') return 'omnicode';
  return undefined;
}

/**
 * Server-declared thinking toggle support from `/models`:
 *  - 'only' — thinking cannot be turned off (always-thinking)
 *  - 'no'   — thinking is not supported at all
 *  - 'both' — thinking can be toggled on and off
 * Absent on older servers — callers fall back to `supportsReasoning`.
 */
export type SupportsThinkingType = 'only' | 'no' | 'both';

export interface ManagedOmnicodeCodeModelInfo {
  readonly id: string;
  readonly contextLength: number;
  readonly supportsReasoning: boolean;
  readonly supportsImageIn: boolean;
  readonly supportsVideoIn: boolean;
  readonly supportsToolUse?: boolean;
  readonly supportsDynamicTools?: boolean;
  readonly supportsThinkingType?: SupportsThinkingType;
  readonly supportEfforts?: readonly string[];
  readonly defaultEffort?: string;
  readonly displayName?: string | undefined;
  readonly protocol?: ManagedOmnicodeCodeProtocol | undefined;
}

export interface ManagedOmnicodeCodeProvisionResult {
  readonly providerName: typeof OMNICODE_PROVIDER_NAME;
  readonly defaultModel: string;
  readonly defaultThinking: boolean;
  readonly models: readonly ManagedOmnicodeCodeModelInfo[];
  readonly configPath?: string | undefined;
}

export interface FetchManagedOmnicodeCodeModelsOptions {
  readonly accessToken: string;
  readonly baseUrl?: string | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly headers?: Record<string, string> | undefined;
  /**
   * What `accessToken` actually is; only affects auth-error wording. Defaults
   * to 'oauth' (the managed login flow); api-key providers refreshed against
   * the managed endpoint pass 'apiKey' so a 401 doesn't tell the user their
   * "OAuth credentials" were rejected.
   */
  readonly credentialKind?: 'oauth' | 'apiKey' | undefined;
}

export interface ManagedOmnicodeCodeApplyResult {
  readonly defaultModel: string;
  readonly defaultThinking: boolean;
}

export interface ManagedOmnicodeCodeCleanupResult {
  readonly providerName: typeof OMNICODE_PROVIDER_NAME;
  readonly removedProvider: boolean;
  readonly removedModels: readonly string[];
  readonly defaultModelCleared: boolean;
  readonly removedServices: readonly string[];
}

export interface ManagedOmnicodeOAuthRef {
  readonly storage: 'file' | 'keyring';
  readonly key: string;
  readonly oauthHost?: string | undefined;
}

export interface ManagedOmnicodeOAuthRefInput {
  readonly storage?: 'file' | 'keyring' | undefined;
  readonly key?: string | undefined;
  readonly oauthHost?: string | undefined;
}

export interface ManagedOmnicodeRuntimeAuth {
  readonly baseUrl?: string | undefined;
  readonly oauthRef: ManagedOmnicodeOAuthRef;
}

export interface ManagedOmnicodeLoginAuth {
  readonly baseUrl?: string | undefined;
  readonly oauthHost?: string | undefined;
  readonly oauthRef?: ManagedOmnicodeOAuthRef | undefined;
}

export interface ManagedOmnicodeEnv {
  readonly OMNICODE_BASE_URL?: string | undefined;
  readonly OMNICODE_OAUTH_HOST?: string | undefined;
  readonly OMNICODE_AUTH_HOST?: string | undefined;
}

export class ManagedOmnicodeCodeModelsAuthError extends OAuthUnauthorizedError {
  readonly status: number;
  readonly baseUrl: string;

  constructor(options: {
    readonly status: number;
    readonly baseUrl: string;
    readonly message: string;
    readonly credentialKind?: 'oauth' | 'apiKey' | undefined;
  }) {
    super(
      `Omnicode models endpoint ${options.baseUrl} rejected ${
        options.credentialKind === 'apiKey' ? 'the API key' : 'OAuth credentials'
      }: ${options.message}`,
    );
    this.name = 'ManagedOmnicodeCodeModelsAuthError';
    this.status = options.status;
    this.baseUrl = options.baseUrl;
  }
}

export interface ManagedOmnicodeProviderConfig {
  type: ManagedOmnicodeCodeProtocol;
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  apiKeyEnv?: string;
  oauth?: ManagedOmnicodeOAuthRef | undefined;
  readonly [key: string]: unknown;
}

export interface ManagedOmnicodeModelAliasOverrides {
  maxContextSize?: number | undefined;
  maxOutputSize?: number | undefined;
  capabilities?: string[] | undefined;
  displayName?: string | undefined;
  reasoningKey?: string | undefined;
  adaptiveThinking?: boolean | undefined;
  supportEfforts?: readonly string[] | undefined;
  defaultEffort?: string | undefined;
  readonly [key: string]: unknown;
}

export interface ManagedOmnicodeModelAlias {
  provider: string;
  model: string;
  maxContextSize: number;
  capabilities?: string[] | undefined;
  supportEfforts?: readonly string[] | undefined;
  defaultEffort?: string | undefined;
  displayName?: string | undefined;
  protocol?: ManagedOmnicodeCodeProtocol;
  betaApi?: boolean;
  adaptiveThinking?: boolean | undefined;
  overrides?: ManagedOmnicodeModelAliasOverrides | undefined;
  readonly [key: string]: unknown;
}

export interface ManagedOmnicodeServiceConfig {
  baseUrl?: string | undefined;
  apiKey?: string | undefined;
  oauth?: ManagedOmnicodeOAuthRef | undefined;
}

export interface ManagedOmnicodeServicesConfig {
  hilbrasSearch?: ManagedOmnicodeServiceConfig | undefined;
  hilbrasFetch?: ManagedOmnicodeServiceConfig | undefined;
  readonly [key: string]: unknown;
}

export interface ManagedOmnicodeThinkingShape {
  enabled?: boolean | undefined;
  effort?: string | undefined;
  [key: string]: unknown;
}

export interface ManagedOmnicodeConfigShape {
  providers: Record<string, ManagedOmnicodeProviderConfig | Record<string, unknown>>;
  models?: Record<string, ManagedOmnicodeModelAlias | Record<string, unknown>> | undefined;
  defaultModel?: string | undefined;
  thinking?: ManagedOmnicodeThinkingShape | undefined;
  services?: ManagedOmnicodeServicesConfig | undefined;
  [key: string]: unknown;
}

export interface ManagedOmnicodeConfigAdapter<TConfig> {
  read(): Promise<TConfig> | TConfig;
  write(config: TConfig): Promise<void> | void;
  apply(
    config: TConfig,
    input: {
      readonly models: readonly ManagedOmnicodeCodeModelInfo[];
      readonly baseUrl?: string | undefined;
      readonly oauthKey?: string | undefined;
      readonly oauthHost?: string | undefined;
      readonly preserveDefaultModel?: boolean | undefined;
    },
  ): ManagedOmnicodeCodeApplyResult;
  remove?(config: TConfig): void;
  readonly configPath?: string | undefined;
}

export interface ProvisionManagedOmnicodeCodeConfigOptions<TConfig> {
  readonly adapter: ManagedOmnicodeConfigAdapter<TConfig>;
  readonly accessToken: string;
  readonly baseUrl?: string | undefined;
  readonly oauthKey?: string | undefined;
  readonly oauthHost?: string | undefined;
  readonly preserveDefaultModel?: boolean | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly headers?: Record<string, string> | undefined;
}

function managedModelKey(modelId: string): string {
  return `${OMNICODE_PLATFORM_ID}/${modelId}`;
}

interface SelectedDefaultModel {
  readonly modelKey: string;
  readonly thinking: boolean;
}

function capabilitiesForModel(model: ManagedOmnicodeCodeModelInfo): string[] | undefined {
  const caps = new Set<string>();
  // supports_thinking_type is the full three-state declaration and wins over
  // the legacy supports_reasoning boolean; absent (older servers) falls back.
  switch (model.supportsThinkingType) {
    case 'only':
      caps.add('thinking');
      caps.add('always_thinking');
      break;
    case 'both':
      caps.add('thinking');
      break;
    case 'no':
      break;
    case undefined:
      if (model.supportsReasoning) caps.add('thinking');
      break;
  }
  if (model.supportsImageIn) caps.add('image_in');
  if (model.supportsVideoIn) caps.add('video_in');
  if (model.supportsToolUse ?? true) caps.add('tool_use');
  if (model.supportsDynamicTools === true) caps.add('dynamically_loaded_tools');
  return caps.size > 0 ? [...caps] : undefined;
}

function defaultBaseUrl(baseUrl: string | undefined): string {
  return (baseUrl ?? omnicodeCodeBaseUrl()).replace(/\/+$/, '');
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function normalizeEndpoint(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function persistedOAuthHost(options: {
  readonly key: string;
  readonly oauthHost?: string | undefined;
}): string | undefined {
  const oauthHost = options.oauthHost;
  const normalized = normalizeEndpoint(oauthHost ?? DEFAULT_OMNICODE_OAUTH_HOST);
  if (
    options.key === OMNICODE_OAUTH_KEY &&
    normalized === normalizeEndpoint(DEFAULT_OMNICODE_OAUTH_HOST)
  ) {
    return undefined;
  }
  return normalized;
}

function managedOAuthRef(options: {
  readonly key: string;
  readonly oauthHost?: string | undefined;
  readonly storage?: 'file' | 'keyring' | undefined;
}): ManagedOmnicodeOAuthRef {
  const oauthHost = persistedOAuthHost(options);
  return {
    storage: options.storage ?? 'file',
    key: options.key,
    oauthHost,
  };
}

function configuredOAuthRef(
  oauthRef: ManagedOmnicodeOAuthRefInput | undefined,
): ManagedOmnicodeOAuthRef | undefined {
  if (oauthRef === undefined) return undefined;
  const key = oauthRef.key;
  if (key === undefined) return undefined;
  return managedOAuthRef({
    storage: oauthRef.storage,
    key,
    oauthHost: oauthRef.oauthHost,
  });
}

export function omnicodeCodeEnvBaseUrl(env: ManagedOmnicodeEnv = process.env): string | undefined {
  return env.OMNICODE_BASE_URL;
}

export function omnicodeCodeEnvOAuthHost(env: ManagedOmnicodeEnv = process.env): string | undefined {
  return env.OMNICODE_OAUTH_HOST ?? env.OMNICODE_AUTH_HOST;
}

// Base URLs that share the default `oauth/omnicode` credential slot.
const SHARED_DEFAULT_BASE_URLS: ReadonlySet<string> = new Set([
  normalizeEndpoint(DEFAULT_OMNICODE_BASE_URL),
]);

export function resolveOmnicodeCodeOAuthKey(options: {
  readonly oauthHost?: string | undefined;
  readonly baseUrl?: string | undefined;
}): string {
  const oauthHost = normalizeEndpoint(options.oauthHost ?? DEFAULT_OMNICODE_OAUTH_HOST);
  const baseUrl = defaultBaseUrl(options.baseUrl);
  const defaultOauthHost = normalizeEndpoint(DEFAULT_OMNICODE_OAUTH_HOST);

  if (oauthHost === defaultOauthHost && SHARED_DEFAULT_BASE_URLS.has(baseUrl)) {
    return OMNICODE_OAUTH_KEY;
  }

  const digest = createHash('sha256')
    .update(JSON.stringify({ oauthHost, baseUrl }))
    .digest('hex')
    .slice(0, 16);
  return `${OMNICODE_SCOPED_OAUTH_KEY_PREFIX}${digest}`;
}

/**
 * Resolve the full managed-Omnicode OAuth ref (credential storage key +
 * persisted host) for an (oauthHost, baseUrl) environment.
 *
 * Single source of truth for "which credential slot does this environment map
 * to". Login, provisioning, and the runtime provider all derive their ref
 * through here, so the slot a token is written to always matches the slot it
 * is later read from — preventing the env-mismatch credential mix-ups this
 * scoping is meant to fix.
 */
export function resolveOmnicodeCodeOAuthRef(options: {
  readonly oauthHost?: string | undefined;
  readonly baseUrl?: string | undefined;
}): ManagedOmnicodeOAuthRef {
  return managedOAuthRef({
    key: resolveOmnicodeCodeOAuthKey(options),
    oauthHost: options.oauthHost,
  });
}

export function resolveOmnicodeCodeRuntimeAuth(options: {
  readonly configuredBaseUrl?: string | undefined;
  readonly configuredOAuthRef?: ManagedOmnicodeOAuthRefInput | undefined;
  readonly env?: ManagedOmnicodeEnv | undefined;
}): ManagedOmnicodeRuntimeAuth {
  const env = options.env ?? process.env;
  const envBaseUrl = omnicodeCodeEnvBaseUrl(env);
  const envOAuthHost = omnicodeCodeEnvOAuthHost(env);
  const hasEnvOverride = envBaseUrl !== undefined || envOAuthHost !== undefined;
  const baseUrl =
    envBaseUrl !== undefined ? normalizeBaseUrl(envBaseUrl) : options.configuredBaseUrl;
  const expected = resolveOmnicodeCodeOAuthRef({
    oauthHost: hasEnvOverride ? envOAuthHost : options.configuredOAuthRef?.oauthHost,
    baseUrl,
  });
  const configured = configuredOAuthRef(options.configuredOAuthRef);
  if (configured === undefined) return { baseUrl, oauthRef: expected };
  if (hasEnvOverride) return { baseUrl, oauthRef: expected };
  if (configured.key !== expected.key) return { baseUrl, oauthRef: expected };
  return { baseUrl, oauthRef: configured };
}

export function resolveOmnicodeCodeLoginAuth(options: {
  readonly configuredBaseUrl?: string | undefined;
  readonly configuredOAuthRef?: ManagedOmnicodeOAuthRefInput | undefined;
  readonly requestedBaseUrl?: string | undefined;
  readonly requestedOAuthHost?: string | undefined;
  readonly env?: ManagedOmnicodeEnv | undefined;
}): ManagedOmnicodeLoginAuth {
  const env = options.env ?? process.env;
  const envBaseUrl = omnicodeCodeEnvBaseUrl(env);
  const envOAuthHost = omnicodeCodeEnvOAuthHost(env);
  const hasOverride =
    options.requestedBaseUrl !== undefined ||
    options.requestedOAuthHost !== undefined ||
    envBaseUrl !== undefined ||
    envOAuthHost !== undefined;
  const baseUrl =
    options.requestedBaseUrl !== undefined
      ? normalizeBaseUrl(options.requestedBaseUrl)
      : envBaseUrl !== undefined
        ? normalizeBaseUrl(envBaseUrl)
        : options.configuredBaseUrl;
  const oauthHost = options.requestedOAuthHost ?? envOAuthHost;
  if (hasOverride) return { baseUrl, oauthHost };

  const configured = configuredOAuthRef(options.configuredOAuthRef);
  if (configured === undefined) return { baseUrl, oauthHost };
  const expectedKey = resolveOmnicodeCodeOAuthKey({
    oauthHost: configured.oauthHost,
    baseUrl,
  });
  return configured.key === expectedKey
    ? { baseUrl, oauthHost, oauthRef: configured }
    : { baseUrl, oauthHost };
}

function toModelInfo(item: unknown): ManagedOmnicodeCodeModelInfo | undefined {
  if (!isRecord(item) || typeof item['id'] !== 'string' || item['id'].length === 0) {
    return undefined;
  }
  const contextLength = Number(item['context_length']);
  if (!Number.isInteger(contextLength) || contextLength <= 0) {
    throw new Error(`Omnicode model "${item['id']}" must include a positive context_length.`);
  }
  const displayName = item['display_name'];
  const normalizedDisplayName =
    typeof displayName === 'string' && displayName.length > 0 ? displayName : undefined;
  const supportsToolUse = Object.hasOwn(item, 'supports_tool_use')
    ? Boolean(item['supports_tool_use'])
    : true;
  // Effort levels come from the nested `think_efforts` object
  // ({ support, valid_efforts, default_effort }) returned by /models.
  const thinkEfforts = parseThinkEfforts(item['think_efforts']);
  return {
    id: item['id'],
    contextLength,
    supportsReasoning: Boolean(item['supports_reasoning']),
    supportsImageIn: Boolean(item['supports_image_in']),
    supportsVideoIn: Boolean(item['supports_video_in']),
    supportsToolUse,
    supportsDynamicTools: item['supports_dynamic_tools'] === true,
    supportsThinkingType: parseSupportsThinkingType(item['supports_thinking_type']),
    supportEfforts: thinkEfforts.supportEfforts,
    defaultEffort: thinkEfforts.defaultEffort,
    displayName: normalizedDisplayName,
    protocol: parseModelProtocol(item['protocol']),
  };
}

export function parseStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return out.length > 0 ? out : undefined;
}

// Unknown or missing values resolve to undefined so callers fall back to the
// legacy supports_reasoning boolean instead of guessing.
export function parseSupportsThinkingType(value: unknown): SupportsThinkingType | undefined {
  return value === 'only' || value === 'no' || value === 'both' ? value : undefined;
}

/**
 * Parse the nested `think_efforts` object from `/models`:
 *   { "support": true, "valid_efforts": ["low", "high", "max"], "default_effort": "high" }
 * Returns the effort list and default effort, or undefineds when absent so
 * callers can fall back to the legacy flat `support_efforts` / `default_effort`
 * fields on older servers.
 */
export function parseThinkEfforts(value: unknown): {
  supportEfforts: readonly string[] | undefined;
  defaultEffort: string | undefined;
} {
  if (value === null || typeof value !== 'object') {
    return { supportEfforts: undefined, defaultEffort: undefined };
  }
  const record = value as Record<string, unknown>;
  // `support` gates the whole object: when it is not true, ignore
  // valid_efforts / default_effort entirely.
  if (record['support'] !== true) {
    return { supportEfforts: undefined, defaultEffort: undefined };
  }
  const rawDefault = record['default_effort'];
  return {
    supportEfforts: parseStringArray(record['valid_efforts']),
    defaultEffort:
      typeof rawDefault === 'string' && rawDefault.length > 0 ? rawDefault : undefined,
  };
}

export async function fetchManagedOmnicodeCodeModels(
  options: FetchManagedOmnicodeCodeModelsOptions,
): Promise<ManagedOmnicodeCodeModelInfo[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = defaultBaseUrl(options.baseUrl);
  const response = await fetchImpl(`${baseUrl}/models`, {
    headers: {
      ...parseOmnicodeCodeCustomHeaders(),
      ...options.headers,
      Authorization: `Bearer ${options.accessToken}`,
      Accept: 'application/json',
    },
  });
  if (!response.ok) {
    const message = await readApiErrorMessage(
      response,
      `Failed to list Omnicode models (HTTP ${response.status}).`,
    );
    if (response.status === 401 || response.status === 402 || response.status === 403) {
      throw new ManagedOmnicodeCodeModelsAuthError({
        status: response.status,
        baseUrl,
        message,
        credentialKind: options.credentialKind,
      });
    }
    throw new Error(message);
  }
  const payload: unknown = await response.json();
  if (!isRecord(payload) || !Array.isArray(payload['data'])) {
    throw new Error(`Unexpected models response for ${baseUrl}.`);
  }
  return payload['data']
    .map((item) => toModelInfo(item))
    .filter((item): item is ManagedOmnicodeCodeModelInfo => item !== undefined);
}

/**
 * Builds the upstream-owned alias record for one `/models` entry. Shared by
 * `applyManagedOmnicodeCodeConfig` (OAuth provisioning/refresh) and
 * `applyManagedApiKeyProviderModels` (api-key provider refresh) so both write
 * identical upstream-owned fields for the same model payload.
 */
export function toManagedModelAlias(
  providerId: string,
  model: ManagedOmnicodeCodeModelInfo,
): ManagedOmnicodeModelAlias {
  const capabilities = capabilitiesForModel(model);
  // Omnicode's Anthropic-compatible endpoint only accepts adaptive thinking
  // (`thinking: { type: 'adaptive' }`); the kosong adapter otherwise infers
  // budget-based thinking from the model name, which fails for Omnicode model ids.
  // Restrict the override to thinking-capable models: the UI treats
  // `adaptiveThinking === true` as "supports a thinking toggle", so marking a
  // non-thinking model would misrepresent it.
  const supportsAdaptiveThinking =
    model.protocol === 'anthropic' &&
    (capabilities?.includes('thinking') === true ||
      capabilities?.includes('always_thinking') === true);
  return {
    provider: providerId,
    model: model.id,
    maxContextSize: model.contextLength,
    capabilities,
    ...(model.displayName !== undefined ? { displayName: model.displayName } : {}),
    ...(model.supportEfforts !== undefined ? { supportEfforts: model.supportEfforts } : {}),
    ...(model.defaultEffort !== undefined ? { defaultEffort: model.defaultEffort } : {}),
    protocol: model.protocol,
    // Omnicode's anthropic-compatible endpoint is served behind the beta Messages
    // API (`/v1/messages?beta=true`), so route anthropic-protocol models
    // through `client.beta.messages.create`. Cleared on refresh when the
    // server stops declaring anthropic so stale routing never lingers.
    betaApi: model.protocol === 'anthropic' ? true : undefined,
    adaptiveThinking: supportsAdaptiveThinking ? true : undefined,
  };
}

export function applyManagedOmnicodeCodeConfig(
  config: ManagedOmnicodeConfigShape,
  options: {
    readonly models: readonly ManagedOmnicodeCodeModelInfo[];
    readonly baseUrl?: string | undefined;
    readonly oauthKey?: string | undefined;
    readonly oauthHost?: string | undefined;
    readonly preserveDefaultModel?: boolean | undefined;
  },
): ManagedOmnicodeCodeApplyResult {
  if (options.models.length === 0) {
    throw new Error('No models available for Omnicode.');
  }
  for (const model of options.models) {
    assertPositiveContextLength(model);
  }

  const baseUrl = defaultBaseUrl(options.baseUrl);
  const oauth =
    options.oauthKey !== undefined
      ? managedOAuthRef({ key: options.oauthKey, oauthHost: options.oauthHost })
      : resolveOmnicodeCodeOAuthRef({ baseUrl, oauthHost: options.oauthHost });
  const existingModels = config.models ?? {};
  const selectedDefault = selectDefaultModel(config, options.models, {
    preserveExisting: options.preserveDefaultModel === true,
  });

  config.providers[OMNICODE_PROVIDER_NAME] = {
    type: 'omnicode',
    baseUrl,
    apiKey: '',
    oauth,
  };

  // Selectively merge upstream models into the existing config so any fields
  // the user added by hand (or that upstream does not declare) survive a
  // refresh. Managed models that upstream no longer lists are removed; the
  // rest are merged field-by-field — upstream-owned fields are overwritten,
  // everything else is preserved.
  const upstreamKeys = new Set(options.models.map((m) => managedModelKey(m.id)));
  for (const [key, model] of Object.entries(existingModels)) {
    if (
      isRecord(model) &&
      model['provider'] === OMNICODE_PROVIDER_NAME &&
      !upstreamKeys.has(key)
    ) {
      delete existingModels[key];
    }
  }
  for (const model of options.models) {
    const key = managedModelKey(model.id);
    const existing = isRecord(existingModels[key]) ? existingModels[key] : {};
    existingModels[key] = mergeRefreshedModelAlias(
      existing,
      toManagedModelAlias(OMNICODE_PROVIDER_NAME, model),
      MANAGED_OMNICODE_MODEL_FIELDS,
    );
  }

  config.models = existingModels;
  config.defaultModel = selectedDefault.modelKey;
  config.thinking = { ...config.thinking, enabled: selectedDefault.thinking };
  config.services = {
    hilbrasSearch: {
      baseUrl: `${baseUrl}/search`,
      apiKey: '',
      oauth,
    },
    hilbrasFetch: {
      baseUrl: `${baseUrl}/fetch`,
      apiKey: '',
      oauth,
    },
  };

  return {
    defaultModel: selectedDefault.modelKey,
    defaultThinking: selectedDefault.thinking,
  };
}

/**
 * Merge refreshed `/models` entries into the aliases of an api-key provider
 * pointing at the managed Omnicode endpoint (a hand-configured provider using
 * a distributed API key instead of OAuth). Unlike `applyManagedOmnicodeCodeConfig`
 * this touches ONLY `config.models`: the provider record (type / baseUrl /
 * apiKey and any hand-written extras), `services`, `defaultModel`, and
 * `thinking` are all left untouched — the provider is user-owned, only its
 * model catalog is upstream-owned.
 *
 * `aliasPrefix` scopes which aliases count as refresh-generated:
 * `${providerId}/` for ordinary providers, `omnicode/` for a hand-written
 * `managed:omnicode` entry so its aliases line up with the OAuth provisioned
 * shape. Aliases outside the prefix are the caller's responsibility (the
 * refresh orchestrator preserves them via `preserveUserProviderAliases`).
 */
export function applyManagedApiKeyProviderModels(
  config: ManagedOmnicodeConfigShape,
  providerId: string,
  models: readonly ManagedOmnicodeCodeModelInfo[],
  aliasPrefix: string,
): void {
  for (const model of models) {
    assertPositiveContextLength(model);
  }

  const existingModels = config.models ?? {};
  // Same merge contract as `applyManagedOmnicodeCodeConfig`: upstream-owned fields
  // are overwritten, hand-written extras survive, and aliases upstream no
  // longer lists are removed (the orchestrator restores non-prefix ones).
  const upstreamKeys = new Set(models.map((m) => `${aliasPrefix}${m.id}`));
  for (const [key, model] of Object.entries(existingModels)) {
    if (isRecord(model) && model['provider'] === providerId && !upstreamKeys.has(key)) {
      delete existingModels[key];
    }
  }
  for (const model of models) {
    const key = `${aliasPrefix}${model.id}`;
    const existing = isRecord(existingModels[key]) ? existingModels[key] : {};
    existingModels[key] = mergeRefreshedModelAlias(
      existing,
      toManagedModelAlias(providerId, model),
      MANAGED_OMNICODE_MODEL_FIELDS,
    );
  }

  config.models = existingModels;
}

export function applyManagedOmnicodeCodeLogoutConfig(config: ManagedOmnicodeConfigShape): void {
  delete config.providers[OMNICODE_PROVIDER_NAME];

  let removedDefaultModel = false;
  const existingModels = config.models ?? {};
  for (const [key, model] of Object.entries(existingModels)) {
    if (!isRecord(model) || model['provider'] !== OMNICODE_PROVIDER_NAME) continue;
    delete existingModels[key];
    if (config.defaultModel === key) removedDefaultModel = true;
  }
  config.models = existingModels;

  if (removedDefaultModel) {
    config.defaultModel = undefined;
  }

  if (config['defaultProvider'] === OMNICODE_PROVIDER_NAME) {
    config['defaultProvider'] = undefined;
  }

  if (config.services !== undefined) {
    delete config.services.hilbrasSearch;
    delete config.services.hilbrasFetch;
    if (Object.keys(config.services).length === 0) {
      config.services = undefined;
    }
  }
}

// The server's three-state declaration overrides any stale thinking.enabled
// being preserved from an earlier config: an always-thinking model ('only')
// must never end up with thinking off, and a non-thinking model ('no') must
// never end up with thinking on.
function forcedThinking(
  model: ManagedOmnicodeCodeModelInfo | undefined,
  fallback: boolean,
): boolean {
  if (model?.supportsThinkingType === 'only') return true;
  if (model?.supportsThinkingType === 'no') return false;
  return fallback;
}

function selectDefaultModel(
  config: ManagedOmnicodeConfigShape,
  models: readonly ManagedOmnicodeCodeModelInfo[],
  options: { readonly preserveExisting: boolean },
): SelectedDefaultModel {
  const firstModel = models[0];
  if (firstModel === undefined) {
    throw new Error('No models available for Omnicode.');
  }

  const managedModels = new Map(models.map((model) => [managedModelKey(model.id), model]));
  const existingModels = config.models ?? {};
  const currentDefault =
    typeof config.defaultModel === 'string' && config.defaultModel.length > 0
      ? config.defaultModel
      : undefined;

  if (
    options.preserveExisting &&
    currentDefault !== undefined &&
    canPreserveDefaultModel(existingModels, currentDefault, managedModels)
  ) {
    const preservedModel = managedModels.get(currentDefault);
    return {
      modelKey: currentDefault,
      thinking: forcedThinking(
        preservedModel,
        config.thinking?.enabled ?? preservedModel?.supportsReasoning ?? false,
      ),
    };
  }

  return {
    modelKey: managedModelKey(firstModel.id),
    thinking: forcedThinking(firstModel, config.thinking?.enabled ?? firstModel.supportsReasoning),
  };
}

function canPreserveDefaultModel(
  existingModels: Record<string, ManagedOmnicodeModelAlias | Record<string, unknown>>,
  defaultModel: string,
  managedModels: ReadonlyMap<string, ManagedOmnicodeCodeModelInfo>,
): boolean {
  if (managedModels.has(defaultModel)) return true;
  const existing = existingModels[defaultModel];
  return isRecord(existing) && existing['provider'] !== OMNICODE_PROVIDER_NAME;
}

export function clearManagedOmnicodeCodeConfig(
  config: ManagedOmnicodeConfigShape,
): ManagedOmnicodeCodeCleanupResult {
  const removedProvider = Object.hasOwn(config.providers, OMNICODE_PROVIDER_NAME);
  delete config.providers[OMNICODE_PROVIDER_NAME];

  const removedModels: string[] = [];
  const models = config.models;
  if (models !== undefined) {
    for (const [key, model] of Object.entries(models)) {
      if (!isRecord(model) || model['provider'] !== OMNICODE_PROVIDER_NAME) continue;
      delete models[key];
      removedModels.push(key);
    }
  }

  let defaultModelCleared = false;
  if (typeof config.defaultModel === 'string' && removedModels.includes(config.defaultModel)) {
    config.defaultModel = undefined;
    defaultModelCleared = true;
  }

  const removedServices: string[] = [];
  if (config.services?.hilbrasSearch !== undefined) {
    delete config.services.hilbrasSearch;
    removedServices.push('hilbrasSearch');
  }
  if (config.services?.hilbrasFetch !== undefined) {
    delete config.services.hilbrasFetch;
    removedServices.push('hilbrasFetch');
  }
  if (config.services !== undefined && Object.keys(config.services).length === 0) {
    config.services = undefined;
  }

  return {
    providerName: OMNICODE_PROVIDER_NAME,
    removedProvider,
    removedModels,
    defaultModelCleared,
    removedServices,
  };
}

function assertPositiveContextLength(model: ManagedOmnicodeCodeModelInfo): void {
  if (!Number.isInteger(model.contextLength) || model.contextLength <= 0) {
    throw new Error(`Omnicode model "${model.id}" must include a positive context_length.`);
  }
}

export async function provisionManagedOmnicodeCodeConfigAfterLogin(
  options: ProvisionManagedOmnicodeCodeConfigOptions<ManagedOmnicodeConfigShape>,
): Promise<ManagedOmnicodeCodeProvisionResult> {
  return provisionManagedOmnicodeCodeConfig(options);
}

export async function provisionManagedOmnicodeCodeConfig<TConfig>(
  options: ProvisionManagedOmnicodeCodeConfigOptions<TConfig>,
): Promise<ManagedOmnicodeCodeProvisionResult> {
  const models = await fetchManagedOmnicodeCodeModels(options);
  const config = await options.adapter.read();
  const applied = options.adapter.apply(config, {
    models,
    baseUrl: options.baseUrl,
    oauthKey: options.oauthKey,
    oauthHost: options.oauthHost,
    preserveDefaultModel: options.preserveDefaultModel,
  });
  await options.adapter.write(config);
  return {
    providerName: OMNICODE_PROVIDER_NAME,
    defaultModel: applied.defaultModel,
    defaultThinking: applied.defaultThinking,
    models,
    configPath: options.adapter.configPath,
  };
}
