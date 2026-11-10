import {
  applyManagedOmnicodeCodeConfig,
  applyManagedOmnicodeCodeLogoutConfig,
  OMNICODE_PROVIDER_NAME,
  OmnicodeOAuthToolkit,
  omnicodeRegionLoginHosts,
  resolveOmnicodeCodeLoginAuth,
  resolveOmnicodeCodeRuntimeAuth,
  type AuthManagedUsageResult,
  type AuthStatus,
  type BearerTokenProvider,
  type FetchCompleteFeedbackUploadResult,
  type FetchFeedbackUploadError,
  type FetchSubmitFeedbackResult,
  type OmnicodeHostIdentity,
  type OmnicodeOAuthLoginOptions,
  type OmnicodeRegion,
  type ManagedOmnicodeConfigShape,
  type OAuthRefreshOutcome,
  type OAuthTokenInspection,
} from '@hilbras/omnicode-auth';

import {
  loadRuntimeConfigSafe,
  readConfigFile,
  readConfigFileForUpdate,
  writeConfigFile,
  type OmnicodeConfig,
  type OAuthRef,
} from '#/config/index';
import { mapOAuthTokenError } from '#/oauth-error';

export interface OmnicodeAuthSubmitFeedbackInput {
  readonly content: string;
  readonly sessionId: string;
  readonly version: string;
  readonly os: string;
  readonly model: string | null;
  readonly contact?: string;
  readonly info?: Record<string, unknown>;
}

export interface OmnicodeAuthCreateFeedbackUploadUrlInput {
  readonly feedbackId: number;
  readonly filename: string;
  readonly size: number;
  readonly sha256: string;
}

export interface OmnicodeAuthCompleteFeedbackUploadPart {
  readonly partNumber: number;
  readonly etag: string;
}

export interface OmnicodeAuthCompleteFeedbackUploadInput {
  readonly uploadId: number;
  readonly parts: readonly OmnicodeAuthCompleteFeedbackUploadPart[];
}

export interface OmnicodeAuthFeedbackUploadPart {
  readonly partNumber: number;
  readonly url: string;
  readonly method: string;
  readonly size: number;
}

export interface OmnicodeAuthCreateFeedbackUploadUrlOk {
  readonly kind: 'ok';
  readonly uploadId: number;
  readonly parts: readonly OmnicodeAuthFeedbackUploadPart[];
}

export type OmnicodeAuthCreateFeedbackUploadUrlResult =
  | OmnicodeAuthCreateFeedbackUploadUrlOk
  | FetchFeedbackUploadError;

export type OmnicodeAuthLoginOptions = Omit<OmnicodeOAuthLoginOptions, 'provisionConfig'> & {
  /**
   * Explicit region choice from the login UI ('mainland-cn' / 'global'). Maps
   * to the region profile's OAuth/API hosts — including for 'mainland-cn', so
   * switching back overrides a persisted global login. Yields to
   * `OMNICODE_OAUTH_HOST` / `OMNICODE_BASE_URL` env overrides and to
   * explicit `oauthHost` / `baseUrl` options.
   */
  readonly region?: OmnicodeRegion;
};

export interface OmnicodeAuthLoginResult {
  readonly providerName: string;
  readonly ok: true;
  readonly defaultModel: string;
  readonly defaultThinking: boolean;
  readonly configPath?: string | undefined;
}

export interface OmnicodeAuthLogoutResult {
  readonly providerName: string;
  readonly ok: true;
}

/**
 * Post-refresh state, so a caller that forced a rotation can report when the
 * new token expires instead of only that the call returned.
 */
export interface OmnicodeAuthRefreshResult {
  readonly providerName: string;
  readonly ok: true;
  readonly token: OAuthTokenInspection;
}

export interface OmnicodeAuthFacadeOptions {
  readonly homeDir: string;
  readonly configPath: string;
  readonly identity?: OmnicodeHostIdentity | undefined;
  readonly onConfigUpdated?: ((config: OmnicodeConfig) => void) | undefined;
  readonly onRefresh?: ((outcome: OAuthRefreshOutcome) => void) | undefined;
}

type SDKManagedConfig = OmnicodeConfig & ManagedOmnicodeConfigShape;

export class OmnicodeAuthFacade {
  private readonly toolkit: OmnicodeOAuthToolkit<SDKManagedConfig>;

  constructor(private readonly options: OmnicodeAuthFacadeOptions) {
    this.toolkit = new OmnicodeOAuthToolkit<SDKManagedConfig>({
      homeDir: options.homeDir,
      identity: options.identity,
      onRefresh: options.onRefresh,
      configAdapter: {
        configPath: options.configPath,
        // Write-path base read: strict (a salvaged base would drop the user's
        // broken-but-fixable sections on rewrite) with an actionable message.
        read: () => readConfigFileForUpdate(options.configPath) as SDKManagedConfig,
        write: async (config) => {
          await writeConfigFile(options.configPath, config);
        },
        apply: applyManagedOmnicodeCodeConfig,
        remove: applyManagedOmnicodeCodeLogoutConfig,
      },
    });
  }

  async status(providerName?: string | undefined): Promise<AuthStatus> {
    return this.toolkit.status(providerName, this.resolveRuntimeManagedAuth(providerName).oauthRef);
  }

  async login(
    providerName: string | undefined = OMNICODE_PROVIDER_NAME,
    options: OmnicodeAuthLoginOptions = {},
  ): Promise<OmnicodeAuthLoginResult> {
    const { region, ...loginOptions } = options;
    const regionHosts = region === undefined ? undefined : omnicodeRegionLoginHosts(region);
    const auth = this.resolveManagedAuth(providerName);
    const loginAuth = resolveOmnicodeCodeLoginAuth({
      configuredBaseUrl: auth.baseUrl,
      configuredOAuthRef: auth.oauthRef,
      requestedBaseUrl: loginOptions.baseUrl ?? regionHosts?.baseUrl,
      requestedOAuthHost: loginOptions.oauthHost ?? regionHosts?.oauthHost,
    });
    const result = await this.toolkit.login(providerName, {
      ...loginOptions,
      baseUrl: loginAuth.baseUrl,
      oauthHost: loginAuth.oauthHost,
      oauthRef: loginOptions.oauthRef ?? loginAuth.oauthRef,
      provisionConfig: true,
    });
    if (result.provision === undefined) {
      throw new Error('Omnicode auth login did not provision model config.');
    }
    const updated = readConfigFile(this.options.configPath);
    this.options.onConfigUpdated?.(updated);
    return {
      providerName: result.providerName,
      ok: true,
      defaultModel: result.provision.defaultModel,
      defaultThinking: result.provision.defaultThinking,
      configPath: result.provision.configPath,
    };
  }

  async logout(providerName?: string | undefined): Promise<OmnicodeAuthLogoutResult> {
    const result = await this.toolkit.logout(
      providerName,
      this.resolveRuntimeManagedAuth(providerName).oauthRef,
    );
    const updated = readConfigFile(this.options.configPath);
    this.options.onConfigUpdated?.(updated);
    return {
      providerName: result.providerName,
      ok: result.ok,
    };
  }

  async getManagedUsage(providerName?: string | undefined): Promise<AuthManagedUsageResult> {
    const auth = this.resolveRuntimeManagedAuth(providerName);
    return this.toolkit.getManagedUsage(providerName, {
      oauthRef: auth.oauthRef,
      baseUrl: auth.baseUrl,
    });
  }

  async submitFeedback(
    input: OmnicodeAuthSubmitFeedbackInput,
    providerName?: string | undefined,
  ): Promise<FetchSubmitFeedbackResult> {
    const auth = this.resolveRuntimeManagedAuth(providerName);
    return this.toolkit.submitFeedback(
      {
        session_id: input.sessionId,
        content: input.content,
        version: input.version,
        os: input.os,
        model: input.model,
        contact: input.contact,
        info: input.info,
      },
      providerName,
      {
        oauthRef: auth.oauthRef,
        baseUrl: auth.baseUrl,
      },
    );
  }

  async createFeedbackUploadUrl(
    input: OmnicodeAuthCreateFeedbackUploadUrlInput,
    providerName?: string | undefined,
  ): Promise<OmnicodeAuthCreateFeedbackUploadUrlResult> {
    const auth = this.resolveRuntimeManagedAuth(providerName);
    const result = await this.toolkit.createFeedbackUploadUrl(
      {
        file_hash: input.sha256,
        file_name: input.filename,
        file_size: input.size,
        feedback_id: input.feedbackId,
      },
      providerName,
      {
        oauthRef: auth.oauthRef,
        baseUrl: auth.baseUrl,
      },
    );
    if (result.kind !== 'ok') return result;
    return {
      kind: 'ok',
      uploadId: result.upload_id,
      parts: result.parts.map((part) => ({
        partNumber: part.part_number,
        url: part.url,
        method: part.method,
        size: part.size,
      })),
    };
  }

  async completeFeedbackUpload(
    input: OmnicodeAuthCompleteFeedbackUploadInput,
    providerName?: string | undefined,
  ): Promise<FetchCompleteFeedbackUploadResult> {
    const auth = this.resolveRuntimeManagedAuth(providerName);
    return this.toolkit.completeFeedbackUpload(
      {
        upload_id: input.uploadId,
        parts: input.parts.map((part) => ({ part_number: part.partNumber, etag: part.etag })),
      },
      providerName,
      {
        oauthRef: auth.oauthRef,
        baseUrl: auth.baseUrl,
      },
    );
  }

  async getCachedAccessToken(
    providerName?: string,
    oauthRef?: OAuthRef | undefined,
  ): Promise<string | undefined> {
    return this.toolkit.getCachedAccessToken(
      providerName,
      this.runtimeOAuthRef(providerName, oauthRef),
    );
  }

  /**
   * Forces an OAuth token rotation and reports the resulting state.
   *
   * `getCachedAccessToken` is the right call on a request path — the runtime
   * refreshes on its own schedule and the caller never notices. This is for
   * surfaces that need the rotation to happen *now* and visibly: an explicit
   * `refresh`, or an operator who has just changed something at the identity
   * provider and wants the local copy re-read before the next session.
   */
  async refresh(
    providerName?: string | undefined,
    oauthRef?: OAuthRef | undefined,
  ): Promise<OmnicodeAuthRefreshResult> {
    const name = providerName ?? OMNICODE_PROVIDER_NAME;
    // Falls back to the provider's own configured ref, then applies the managed
    // runtime overrides for the Omnicode provider. Reading the managed ref
    // unconditionally would refresh a custom provider against Omnicode's
    // identity provider instead of the one it was configured with.
    const ref = this.runtimeOAuthRef(name, oauthRef ?? this.resolveManagedAuth(name).oauthRef);
    await this.toolkit.ensureFresh(name, { force: true, oauthRef: ref });
    return {
      providerName: name,
      ok: true,
      token: await this.toolkit.inspectCachedToken(name, ref),
    };
  }

  /**
   * Offline credential state: whether a token exists, whether it was revoked,
   * and when it expires. Makes no network call, so it is safe for a status
   * listing that may enumerate every provider.
   */
  async inspectToken(
    providerName?: string | undefined,
    oauthRef?: OAuthRef | undefined,
  ): Promise<OAuthTokenInspection> {
    return this.toolkit.inspectCachedToken(
      providerName ?? OMNICODE_PROVIDER_NAME,
      this.runtimeOAuthRef(providerName, oauthRef),
    );
  }

  readonly resolveOAuthTokenProvider = (
    providerName: string,
    oauthRef?: OAuthRef | undefined,
  ): BearerTokenProvider => {
    const provider = this.toolkit.tokenProvider(
      providerName,
      this.runtimeOAuthRef(providerName, oauthRef),
    );
    return {
      getAccessToken: async (options) => {
        try {
          return await provider.getAccessToken(options);
        } catch (error) {
          // Classify OAuth token failures into the public OmnicodeError protocol;
          // unrecognized errors are rethrown raw (see mapOAuthTokenError).
          throw mapOAuthTokenError(error, providerName) ?? error;
        }
      },
    };
  };

  private resolveManagedAuth(providerName?: string | undefined): {
    readonly oauthRef?: OAuthRef | undefined;
    readonly baseUrl?: string | undefined;
  } {
    const name = providerName ?? OMNICODE_PROVIDER_NAME;
    // Read path: token/status resolution must work off a degraded config
    // instead of failing the session when an unrelated section is broken.
    // Write paths (the toolkit's configAdapter.read) stay strict.
    const config = loadRuntimeConfigSafe(this.options.configPath).config;
    const provider = config.providers[name];
    return {
      oauthRef: provider?.oauth,
      baseUrl: provider?.baseUrl,
    };
  }

  private resolveRuntimeManagedAuth(providerName?: string | undefined): {
    readonly oauthRef: OAuthRef;
    readonly baseUrl?: string | undefined;
  } {
    const auth = this.resolveManagedAuth(providerName);
    return resolveOmnicodeCodeRuntimeAuth({
      configuredBaseUrl: auth.baseUrl,
      configuredOAuthRef: auth.oauthRef,
    });
  }

  private runtimeOAuthRef(
    providerName: string | undefined,
    oauthRef?: OAuthRef | undefined,
  ): OAuthRef | undefined {
    if ((providerName ?? OMNICODE_PROVIDER_NAME) !== OMNICODE_PROVIDER_NAME) return oauthRef;
    const auth = this.resolveManagedAuth(providerName);
    return resolveOmnicodeCodeRuntimeAuth({
      configuredBaseUrl: auth.baseUrl,
      configuredOAuthRef: oauthRef ?? auth.oauthRef,
    }).oauthRef;
  }
}
