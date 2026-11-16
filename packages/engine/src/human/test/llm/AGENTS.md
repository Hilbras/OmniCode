# llm test guide

## Provider cassettes

`cassette.ts` records and replays the HTTP traffic of the agent's provider requests. It
patches `globalThis.fetch`, which is the only place provider bytes leave the process —
the four protocol bases all delegate to a vendor SDK that defaults to global `fetch`, and
the `clientFactory` seam is not reachable through the DI registry. Patching `fetch` is
therefore what lets a test drive a real SDK end to end.

A cassette is one JSON file under `cassettes/`, keyed by `<METHOD> <url>`. Repeated
requests to the same URL replay in recorded order.

```ts
await withFetchCassette({ file, name, mode: 'replay' }, (cassette) => generate(...));
```

Recording is opt-in and off by default; `cassetteModeFromEnv` reads it.

```sh
OMNICODE_CASSETTE_RECORD=1 pnpm test                       # every cassette
OMNICODE_CASSETTE_RECORD=openai-chat-truncated pnpm test   # one cassette by name
```

`test/setup.ts` keeps this one variable when it clears the rest of the `OMNICODE_`
environment, so it reaches the suite from the shell. Any other cassette setting has to be
passed to `withFetchCassette` directly.

### Rules

- Recording replaces the whole file with what the run captured.
- Bodies are stored as text. Secret-bearing headers (`authorization`, `api-key`,
  `x-api-key`, `cookie`, `set-cookie`) are redacted, and `content-encoding`,
  `content-length`, `transfer-encoding` are dropped so the stored body replays as-is.
- A request with no recorded entry fails, and the cassette records the miss in
  `cassette.missed`: `<cassette> has no entry #<n> for "<METHOD> <url>"`. Read it instead
  of the event stream — the SDK replaces our error message with a generic one.
- Matching is by method and URL only, so a cassette does not notice when the outgoing
  body changes. Assert on `cassette.calls` for what the SDK actually sent.
- `cassettes/openai-chat-stream.json` and `openai-chat-truncated.json` are hand-authored
  to the providers' wire formats, not captured from live traffic. Refresh them with real
  recordings once credentials and network are available.

### Rendered-context goldens

`goldens/` pins the exact request bytes the provider path renders. A golden test deep-equals
the parsed body against the committed JSON, so any change to request shaping (system prompt
placement, think lowering, tool schema rendering, thinking/cache/token kwargs, SDK
serialization) fails loudly instead of shipping a drifted request.

- `goldens/openai-chat-stream-wire-body.json`: the body the real SDK sent under cassette
  replay (`cassette.calls[0].body` in `cassette.test.ts`).
- `goldens/openai-chat-rendered-request.json`: `prepareOpenAIRequest` output for a full
  agent context — system prompt, think history, tool call/result, tools, thinking,
  cache key, and token cap (`rendered-context-golden.test.ts`).
- `goldens/anthropic-messages-rendered-request.json`,
  `goldens/openai-responses-rendered-request.json`, and
  `goldens/google-genai-rendered-request.json`: the same full agent context rendered by
  the other three protocol bases, so a wire that shapes the request differently (or stops
  being exercised) shows up as its own diff instead of hiding behind the OpenAI golden.

The rendered system prompt itself is pinned outside this directory, in
`test/app/agentProfileCatalog/systemPromptGolden.test.ts` against
`test/app/agentProfileCatalog/goldens/`, because it is the profile catalog that renders
it, not the provider layer.

Hand-edit a golden only to adopt an intentional shaping change; the test failure is the
review point for that diff.
