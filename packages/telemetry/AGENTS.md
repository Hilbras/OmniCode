# packages/telemetry — Agent Guide

Read the root `AGENTS.md` first. `telemetry` is a leaf package.

## Role and non-goals

Telemetry transport infrastructure: primitive-only event properties, context
enrichment, buffering/flush, disk fallback and bounded retry, crash handlers,
system metrics, bootstrap, and remote identity normalization.

Non-goals: no product event taxonomy, no endpoint/region selection, no auth
storage, and no rich payloads. Hosts define event names and pass an endpoint
resolver and token getter.

## Entry points and modules

Root `@hilbras/omnicode-telemetry` (`src/index.ts`) exports:

- `track`, `setTelemetryContext`, `setTelemetryModel`,
  `withTelemetryContext`, `setTelemetryEnabled`.
- `flushTelemetrySync`, `shutdownTelemetry`.
- `initializeTelemetry`, `isTelemetryDisabledByEnv`, `shouldEnableTelemetry`.
- OTLP: `recordOtlpSpan`, `recordOtlpMetric` (emitters), `configureOtlpRuntime`,
  `flushOtlpRuntime`, `shutdownOtlpRuntime` (hosts), `isOtlpRuntimeConfigured`.
- `installCrashHandlers`, `setCrashPhase`, `normalizeRemote`.
- Types `TelemetryProperties`, `TelemetryPrimitive`, `TelemetryClient`,
  `TelemetryContextIds`.

Key files:

- `src/types.ts`: primitive guard and event/context shapes.
- `src/client.ts`: queue, context overrides, sink attach/teardown, shutdown.
- `src/sink.ts`: buffer, periodic/threshold flush, static context.
- `src/transport.ts`: HTTP send, retries, `failed_*.jsonl` disk fallback,
  `kfc_` server prefixes.
- `src/bootstrap.ts`: env disable switch and wiring.
- `src/crash.ts`, `src/systemMetrics.ts`, `src/remote.ts`.

## Layering rules

- Leaf law: no `@hilbras/omnicode-*` imports.
- This package has zero runtime dependencies and uses only Node builtins. Do not
  add `base` for logging, IDs, or env parsing.
- The host supplies endpoint, token, home directory, and device/session IDs.
  Region logic stays in the composition root or `auth`.

## Local constraints

- Properties must be JSON primitives. Non-primitives and non-finite numbers are
  dropped and reported through the optional unexpected-error handler; telemetry
  itself stays silent.
- Never emit file paths, raw env values, tokens, credentials, prompt/tool text,
  or raw error strings. Prefer counts, enums, booleans, and durations.
- `normalizeRemote` strips userinfo/credentials and `.git`; it keeps canonical
  host/port/path for remote identity. Do not feed it raw URLs with secrets.
- An absent endpoint means "skip send", never fall back to another region's
  host. The endpoint may be a resolver so a region switch takes effect.
- Disk fallback files are `0600`, expire after 7 days, and retry is bounded.
  Telemetry must never fail shutdown; `flushSync` is best-effort.
- `OMNICODE_DISABLE_TELEMETRY=1|true|t|yes|y` disables intake. `enabled: false`
  also disables; a disabled client clears its queue and buffer.
- Events tracked before a sink attaches are queued (max 1000), then drained with
  device/session backfill. Do not drop them on attach.
- System metrics and crash events must stay aggregate/structural, not payload
  dumps.

## Tests
Test root: `packages/telemetry/test/`; `package.json` has `test`; project is
`omnicode-telemetry`. Files: `telemetry.test.ts`, `normalize-remote.test.ts`,
`agentMetrics.test.ts`, `otlp.test.ts`, `otlpSender.test.ts`,
`otlpRuntime.test.ts`.
```bash
pnpm --filter @hilbras/omnicode-telemetry test
pnpm --filter @hilbras/omnicode-telemetry exec vitest run test/normalize-remote.test.ts
pnpm --filter @hilbras/omnicode-telemetry typecheck
```
Tests use recording/in-memory transports, fake fetch/timers, temp homes, and a
spawned child for crash behavior. No external endpoint is required.

## Local traps
- `SERVER_EVENT_PREFIX = 'kfc_'` and `USER_ID_PREFIX = 'kfc_device_id_'` are
  legacy wire names; renaming them breaks the server.
- The Vitest project name is `omnicode-telemetry`.
- `setTelemetryModel(undefined)` is a no-op; a resumed session must pass the
  real model.
- `flushTelemetrySync` never throws; do not use it as a delivery guarantee.
- `resetForTests` exists in `client.ts`; do not expose it through the root.
## Belongs here vs neighbours
- Event emission sites: CLI, engine, or host.
- Token/device identity: caller (`auth` or app), passed in by option.
- Product metrics definitions: owning feature package.
- PII filtering: this package enforces structure; callers still must not supply
  sensitive values.


## Agent metric schema

`src/agentMetrics.ts` defines redacted telemetry property builders for agent turns, tools, permissions, memory recall, sandbox, and channels. Payloads are enums/counts/safe names only; never pass paths, commands, prompts, or memory content.

## OTLP export shape

`src/otlp.ts` builds OTLP/HTTP JSON payloads: attribute allowlists per signal (`SPAN_ATTRIBUTE_ALLOWLIST`, `METRIC_ATTRIBUTE_ALLOWLIST`), primitives only, bounded span buffer, and a per-metric series cap that folds extra series into `overflow=true`. `src/otlpSender.ts` (`OtlpHttpSender`) is the transport: per-send endpoint and bearer token resolution, bounded 5xx retry, no 4xx retry, timeout, and never throws. No endpoint means no send. Never add a free-form attribute path here.

`src/otlpRuntime.ts` is the process-wide emission seam: emitters call
`recordOtlpSpan` / `recordOtlpMetric` (no-ops until a host configures the
runtime), the host calls `configureOtlpRuntime` once with endpoint/token and
`flushOtlpRuntime` / `shutdownOtlpRuntime` on exit. An absent or empty endpoint
keeps the runtime off and drops records. Each flush drains a signal's batch
before its send and restores it on failure, so acceptance is per signal and
overlapping flushes are skipped. Buffers are bounded: spans by `maxBufferedSpans`
and metric points by `maxBufferedPointsPerMetric` per name, oldest dropped and
counted. Extend the metric allowlist only for bounded, operator-controlled
values (model aliases, enums) — never for ids or paths.
