import {
  createOmnicodeDefaultHeaders,
  OMNICODE_FLOW_CONFIG,
  OMNICODE_PROVIDER_NAME,
  OmnicodeOAuthToolkit,
  omnicodeCodeBaseUrl,
  parseOmnicodeCodeCustomHeaders,
  resolveOmnicodeCodeOAuthRef,
  type OmnicodeHostIdentity,
  type ManagedOmnicodeOAuthRef,
} from '@hilbras/omnicode-auth';
import type {
  ProviderConfig as KosongProviderConfig,
  ProviderRequestAuth,
} from '@hilbras/omnicode-llm';
import { APIStatusError, UNKNOWN_CAPABILITY } from '@hilbras/omnicode-llm';
import { resolveOmnicodeHome } from '@hilbras/omnicode-core';

import { ErrorCodes, OmnicodeError } from '#/errors';
import type { Logger } from '#/logging/index';
import type { ModelProvider, ResolvedRuntimeProvider } from '#/model-provider';
import { mapOAuthTokenError } from '#/oauth-error';

export interface OmnicodeForCodingProviderOptions extends OmnicodeHostIdentity {
  readonly homeDir?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly promptCacheKey?: string;
  readonly defaultHeaders?: Record<string, string>;
}

export class OmnicodeForCodingProvider implements ModelProvider {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly promptCacheKey: string | undefined;
  private readonly defaultHeaders: Record<string, string> | undefined;
  private readonly toolkit: OmnicodeOAuthToolkit;
  private readonly homeDir: string;
  private readonly identity: OmnicodeHostIdentity;
  private readonly oauthRef: ManagedOmnicodeOAuthRef;

  constructor(options: OmnicodeForCodingProviderOptions) {
    this.model = options.model ?? 'omnicode-for-coding';
    this.baseUrl = options.baseUrl ?? omnicodeCodeBaseUrl();
    this.promptCacheKey = options.promptCacheKey;
    this.defaultHeaders = options.defaultHeaders;
    this.homeDir = resolveOmnicodeHome(options.homeDir);
    this.identity = {
      productName: options.productName,
      version: options.version,
      platform: options.platform,
      userAgentSuffix: options.userAgentSuffix,
    };
    this.oauthRef = resolveOmnicodeCodeOAuthRef({
      oauthHost: OMNICODE_FLOW_CONFIG.oauthHost,
      baseUrl: this.baseUrl,
    });
    this.toolkit = new OmnicodeOAuthToolkit({
      homeDir: this.homeDir,
      identity: this.identity,
    });
  }

  get defaultModel(): string {
    return this.model;
  }

  resolveProviderConfig(model: string): ResolvedRuntimeProvider {
    if (model !== this.model) {
      throw new OmnicodeError(
        ErrorCodes.CONFIG_INVALID,
        `Model "${model}" is not supported by OmnicodeForCodingProvider.`,
      );
    }

    const provider: KosongProviderConfig = {
      type: 'omnicode',
      model: this.model,
      baseUrl: this.baseUrl,
      generationKwargs: this.promptCacheKey
        ? { prompt_cache_key: this.promptCacheKey }
        : undefined,
      defaultHeaders: {
        ...parseOmnicodeCodeCustomHeaders(),
        ...createOmnicodeDefaultHeaders({
          homeDir: this.homeDir,
          ...this.identity,
        }),
        ...this.defaultHeaders,
      },
    };

    return {
      providerName: 'omnicode-for-coding',
      provider,
      modelCapabilities: UNKNOWN_CAPABILITY,
      type: 'omnicode',
      protocol: undefined,
    };
  }

  resolveAuth(_model: string, _options?: { readonly log?: Logger }) {
    return async <T>(request: (auth: ProviderRequestAuth) => Promise<T>): Promise<T> => {
      let auth = await this.buildAuth(false);
      for (let refreshed = false; ; refreshed = true) {
        try {
          return await request(auth);
        } catch (error) {
          const is401 = error instanceof APIStatusError && error.statusCode === 401;
          if (!is401) throw error;
          if (refreshed) {
            throw new OmnicodeError(
              ErrorCodes.AUTH_LOGIN_REQUIRED,
              'OAuth token was rejected after refresh. Run /login to re-authenticate.',
              { cause: error },
            );
          }
          auth = await this.buildAuth(true);
        }
      }
    };
  }

  private async buildAuth(force: boolean): Promise<ProviderRequestAuth> {
    try {
      const apiKey = await this.toolkit.ensureFresh(OMNICODE_PROVIDER_NAME, {
        force,
        oauthRef: this.oauthRef,
      });
      return { apiKey };
    } catch (error) {
      // Classify OAuth token failures into the public OmnicodeError protocol so the
      // turn surfaces `auth.login_required` / `provider.connection_error`
      // instead of collapsing everything to `internal`. Unrecognized errors are
      // rethrown raw (see mapOAuthTokenError).
      throw mapOAuthTokenError(error, OMNICODE_PROVIDER_NAME) ?? error;
    }
  }
}
