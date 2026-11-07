import { GoogleGenAI as GenAIClient, type GenerateContentParameters } from '@google/genai';
import { assign, shake } from 'radashi';

import { modelKey, type LlmModel } from '#/llm/model';
import type { ProtocolBase, ProtocolRequesterOptions, TraitContext } from '#/llm/protocol/base';
import { resolveModelConnection } from '#/llm/protocol/connection';
import { resolveMaxCompletionCap, type FormatRequestInput } from '#/llm/protocol/format';
import { consumeStream, resolveTransportHeaders } from '#/llm/protocol/stream';
import { applyThinking } from '#/llm/protocol/thinking';
import {
  type LlmClientContext,
  type LlmRequestConfig,
  type LlmRequestContent,
  type LlmRequestControl,
  type LlmRequester,
  type LlmRequesterOptions,
  type LlmRequestEvent,
} from '#/llm/requester/requester';
import { toLlmSyntaxErrorMessage } from '#/llm/syntax-errors';

import {
  degradeRequestConfig,
  isOpaqueRejection,
  OpaqueRejectionRecoveries,
  recoverFromOpaqueRejection,
} from '../opaque-rejection';
import { getGoogleGenAIModelCapability } from './capability';
import {
  applyGoogleGenAIResponseFormat,
  assembleGoogleGenAIRequest,
  convertGoogleGenAIError,
  createGoogleGenAIFormat,
  encodeGoogleGenAIMaxOutputTokens,
  encodeGoogleGenAIRequest,
  encodeGoogleGenAIThinking,
  lowerGoogleGenAIMessages,
  defaultGoogleGenAITool,
  type GoogleGenAIRequestParams,
} from './format';
import type { GoogleGenAITrait } from './trait';

export interface GoogleGenAIRequesterOptions
  extends ProtocolRequesterOptions<GoogleGenAITrait>, LlmRequesterOptions<GenAIClient> {
  readonly vertexai?: boolean;
}

export interface GoogleGenAIRequestPreparationOptions {
  readonly trait?: GoogleGenAITrait;
}

export function prepareGoogleGenAIRequest(
  input: FormatRequestInput,
  options?: GoogleGenAIRequestPreparationOptions,
): GoogleGenAIRequestParams {
  const trait = options?.trait;
  const ctx: TraitContext = { model: input.model };
  let kwargs: Record<string, unknown> = {};
  if (input.thinking !== undefined) {
    kwargs = applyThinking(kwargs, input.thinking, trait?.thinking, ctx, (t, c) => ({
      thinkingConfig: encodeGoogleGenAIThinking(c.model.model, t.effort),
    })).kwargs;
  }
  const cap = resolveMaxCompletionCap(input);
  if (cap !== undefined) {
    kwargs = {
      ...kwargs,
      ...(trait?.encodeMaxCompletionTokens?.(cap, ctx) ?? encodeGoogleGenAIMaxOutputTokens(cap)),
    };
  }
  if (input.responseFormat !== undefined) {
    kwargs = applyGoogleGenAIResponseFormat(kwargs, input.responseFormat);
  }
  kwargs = shake(assign(kwargs, input.extraParams?.googleGenai ?? {}));

  const contents = lowerGoogleGenAIMessages(input.messages);
  const merged = trait?.mergeHistory?.(contents, ctx) ?? contents;
  const tools = input.tools.map(
    (tool) => trait?.convertTool?.(tool, ctx) ?? defaultGoogleGenAITool(tool),
  );
  const params = assembleGoogleGenAIRequest(input, { contents: merged, tools, kwargs });
  const finalParams = trait?.buildParams?.(params, ctx) ?? params;
  return encodeGoogleGenAIRequest(finalParams);
}

function createClient(
  model: LlmModel,
  headers: Record<string, string> | undefined,
  vertexai: boolean,
): GenAIClient {
  const httpOptions: { headers?: Record<string, string>; baseUrl?: string } = {};
  if (headers !== undefined) {
    httpOptions.headers = headers;
  }
  if (model.baseUrl !== undefined) {
    httpOptions.baseUrl = model.baseUrl;
  }
  return new GenAIClient({
    apiKey: model.apiKey,
    vertexai: vertexai ? true : undefined,
    httpOptions: Object.keys(httpOptions).length > 0 ? httpOptions : undefined,
  });
}

function createAbortException(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function abortPromise(signal: AbortSignal): {
  readonly promise: Promise<never>;
  readonly dispose: () => void;
} {
  if (signal.aborted) {
    return { promise: Promise.reject(createAbortException()), dispose: () => {} };
  }
  let dispose = (): void => {};
  const promise = new Promise<never>((_, reject) => {
    const onAbort = (): void => {
      reject(createAbortException());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    dispose = (): void => {
      signal.removeEventListener('abort', onAbort);
    };
  });
  return { promise, dispose };
}

interface GoogleGenAITransport {
  readonly connection: GoogleGenAIRequesterOptions['connection'];
  readonly ctx: TraitContext;
  readonly format: ReturnType<typeof createGoogleGenAIFormat>;
  readonly resolveClient: (request: LlmClientContext) => GenAIClient;
  readonly signal: AbortSignal;
  readonly onEvent?: (event: LlmRequestEvent) => void;
}

async function executeGoogleGenAIRequest(
  request: GoogleGenAIRequestParams,
  transport: GoogleGenAITransport,
): Promise<void> {
  const { connection, ctx, format, resolveClient, signal, onEvent } = transport;
  const client = resolveClient({
    model: ctx.model,
    headers: resolveTransportHeaders(connection, ctx, request.headers),
  });
  onEvent?.({ type: 'llm.sent' });
  const models = client.models as unknown as {
    generateContentStream(
      params: GenerateContentParameters,
    ): Promise<AsyncIterable<Record<string, unknown>>>;
  };
  const params = {
    ...request.params,
    ...(request.params.config === undefined
      ? { config: { abortSignal: signal } }
      : { config: { ...request.params.config, abortSignal: signal } }),
  } as typeof request.params;
  const abort = abortPromise(signal);
  let stream;
  try {
    stream = await Promise.race([models.generateContentStream(params), abort.promise]);
  } finally {
    abort.dispose();
  }
  await consumeStream(stream, format.createStreamParser(), onEvent, () => {
    if (signal.aborted) {
      throw createAbortException();
    }
  });
}

export function createGoogleGenAIRequester(options?: GoogleGenAIRequesterOptions): LlmRequester {
  const connection = options?.connection;
  const trait = options?.trait;
  const classifyError = options?.classifyError;
  const format = createGoogleGenAIFormat();
  const vertexai = options?.vertexai === true;
  const opaqueRejections = new OpaqueRejectionRecoveries();
  const resolveClient =
    options?.clientFactory ??
    ((request: LlmClientContext) =>
      createClient(request.model, request.headers, vertexai || request.model.vertexai === true));
  return {
    async generate(
      config: LlmRequestConfig,
      content: LlmRequestContent,
      control: LlmRequestControl,
    ): Promise<void> {
      const model = resolveModelConnection(config.model, connection);
      const { messages } = content;
      const { signal, onEvent } = control;
      const ctx: TraitContext = { model };
      const key = modelKey(model);
      const working = opaqueRejections.workingStep(key);
      const effectiveConfig =
        working === undefined ? config : (degradeRequestConfig(config, working) ?? config);
      let request: GoogleGenAIRequestParams;
      try {
        request = prepareGoogleGenAIRequest(
          {
            ...effectiveConfig,
            model,
            messages,
            tools: effectiveConfig.tools ?? [],
            usedContextTokens: content.usedContextTokens,
          },
          { trait },
        );
      } catch (error) {
        onEvent?.({ type: 'llm.failed.syntax', error: toLlmSyntaxErrorMessage(error) });
        return;
      }
      try {
        await executeGoogleGenAIRequest(request, {
          connection,
          ctx,
          format,
          resolveClient,
          signal,
          onEvent,
        });
      } catch (error) {
        if (!isOpaqueRejection(error)) {
          onEvent?.({
            type: 'llm.failed.remote',
            error: convertGoogleGenAIError(error, (e) => classifyError?.(e)),
          });
          return;
        }
        const outcome = await recoverFromOpaqueRejection({
          modelKey: key,
          config: effectiveConfig,
          error,
          recoveries: opaqueRejections,
          onRetry: () => onEvent?.({ type: 'llm.request.retrying' }),
          send: async (degraded) => {
            const degradedRequest = prepareGoogleGenAIRequest(
              {
                ...degraded,
                model,
                messages,
                tools: degraded.tools ?? [],
                usedContextTokens: content.usedContextTokens,
              },
              { trait },
            );
            await executeGoogleGenAIRequest(degradedRequest, {
              connection,
              ctx,
              format,
              resolveClient,
              signal,
              onEvent,
            });
          },
        });
        if (outcome.ok) return;
        onEvent?.({
          type: 'llm.failed.remote',
          error: convertGoogleGenAIError(outcome.error, (e) => classifyError?.(e)),
        });
      }
    },
  };
}

export function createGoogleGenAIBase(
  options?: Pick<GoogleGenAIRequesterOptions, 'clientFactory' | 'vertexai'>,
): ProtocolBase<GoogleGenAITrait> {
  return {
    capability: getGoogleGenAIModelCapability,
    createRequester: (requesterOptions) =>
      createGoogleGenAIRequester({ ...options, ...requesterOptions }),
  };
}

export const googleGenAIBase: ProtocolBase<GoogleGenAITrait> = createGoogleGenAIBase();
