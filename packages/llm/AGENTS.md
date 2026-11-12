# packages/llm — Agent Guide

Read the root `AGENTS.md` first. `llm` is a leaf package.
## Role and non-goals

Pure LLM provider kernel: normalized messages/tools/streams, `generate()`, token
usage, model capability tables and catalog import, normalized errors, and
concrete wire adapters.

Non-goals: no agent loop, retries/policy, session state, prompt assembly,
permission checks, credential storage, or tool execution. The engine owns the
agent loop and compatibility boundary; this package must stay usable without it.
## Entry points

Root `@hilbras/omnicode-llm` exports message helpers/types, provider interfaces,
`createProvider`, `getModelCapability`, `generate`, catalog helpers, usage
helpers, and errors. Provider classes are deliberately absent from the root
barrel because their SDK type graphs pollute declaration bundles:

```ts
import { OmnicodeChatProvider } from '@hilbras/omnicode-llm/providers/omnicode';
import { OpenAILegacyChatProvider } from '@hilbras/omnicode-llm/providers/openai-legacy';
import { OpenAIResponsesChatProvider } from '@hilbras/omnicode-llm/providers/openai-responses';
import { AnthropicChatProvider } from '@hilbras/omnicode-llm/providers/anthropic';
import { GoogleGenAIChatProvider } from '@hilbras/omnicode-llm/providers/google-genai';
```

Key files:

- `src/message.ts`, `src/tool.ts`, `src/usage.ts`: kernel data model.
- `src/provider.ts`: `ChatProvider`, `StreamedMessage`, finish-reason and auth
  request types.
- `src/generate.ts`: stream consumption and callback/result normalization.
- `src/providers/index.ts`: provider factory and static capability lookup.
- `src/providers/openai-common.ts`, `chat-completions-stream.ts`,
  `tool-call-id.ts`, `request-auth.ts`: shared wire plumbing.
- `src/providers/omnicode*.ts`: managed Omnicode wire, quota errors, files.
- `src/catalog.ts`, `src/capability.ts`, `src/errors.ts`.
## Layering rules

- Leaf law: no `@hilbras/omnicode-*` imports.
- Runtime dependencies are the Anthropic/Google/OpenAI SDKs, `zod`, and
  `zod-to-json-schema`; `ajv` is dev-only.
- No provider fallback between wires. Unknown provider types fail explicitly.
## Local constraints

- Four protocol bases (OpenAI legacy, OpenAI Responses, Anthropic, Google
  GenAI) plus the Omnicode wire. `vertexai` is a Google GenAI alias; keep its
  behavior intentional.
- Adapters must not read credentials from `process.env`. Auth arrives per
  request as `GenerateOptions.auth`; tests assert this.
- Do not retain mutable credential state or silently switch models.
  `withThinking` and similar methods return a new provider.
- Resolve thinking effort and model compatibility before the adapter boundary.
  `getModelCapability` is static; unknown models return `UNKNOWN_CAPABILITY`
  and stay non-fatal. Omnicode capabilities come from host config/catalog, not
  the model name.
- Normalize each native finish reason; preserve the raw string in
  `rawFinishReason`. Do not conflate `tool_calls`, `completed`, and `truncated`.
- Tool call IDs are provider-scoped with length/charset policies. Use
  `tool-call-id.ts` helpers, not ad-hoc rewriting.
- Root files use relative imports; provider files commonly use `#/`. Follow the
  file; do not mass-rewrite either style.
- Keep adapters off the root barrel. Adding one there is an API/bundle
  regression.
## Tests
Test root: `packages/llm/test/`, 49 files. No `test` script exists; run Vitest
through the package filter. Project: `omnicode-llm`.
```bash
pnpm --filter @hilbras/omnicode-llm exec vitest run
pnpm --filter @hilbras/omnicode-llm exec vitest run test/provider.test.ts
pnpm --filter @hilbras/omnicode-llm typecheck
```
Provider e2e uses a local fake HTTP server
(`test/e2e/fake-provider-harness.ts`) on `127.0.0.1`; adapter tests replace only
the SDK client boundary, so no live credentials are required.
`test/type-safety-negative.ts` is excluded from the normal tsconfig on purpose;
do not fold it into the runtime suite.
## Local traps
- Vitest project name is `omnicode-llm`, not `llm`.
- Root imports do not expose adapter classes; use `providers/*`.
- `provider.ts` compatibility-era names (`openai_responses`, `google-genai`)
  are wire contract, not typos.
- The Omnicode provider is both a wire and a managed endpoint; capability
  lookups intentionally return unknown.
- `generate()` consumes a stream; final usage/finish reason appear after iteration.
## Belongs here vs neighbours
- Agent loop, tool dispatch, retries, permissions, prompts: `engine`.
- Credential storage/refresh: `auth`.
- Provider-SDK HTTP/SSE: `llm`; generic transport: `rpc`; tools: `Tools`.


## Cost accounting

`src/pricing.ts` owns model pricing, token-to-USD breakdowns, cache rates, unknown-model sentinel, and `CostBudget`. Unknown pricing must remain visible; never report an unknown model as zero cost. Engine usage/budget wiring is a separate composition step.


## Provider descriptors

`src/descriptor.ts` declares provider identity, model ownership matchers, key validators, base URLs, and discovery support. `ProviderDescriptorRegistry` resolves one owner per model and rejects multi-provider claims. No provider may silently claim another provider's model.


## Provider fallback

`src/fallback.ts` selects an untried, available, model-owning candidate only for retryable status/quota failures and only when its capability covers the request. It is a pure selection seam; caller-side retry/cancellation composition remains.
