# channels

Channel platform contracts and adapters. Lives outside `engine` so adapters can be tested without a running daemon.

- `src/contracts.ts` owns inbound/outbound messages, adapter contract, config, bindings, and the channel memory scope hint.
- `src/binding.ts` owns in-memory session bindings and channel config allowlists.
- `src/commands.ts` owns `/new`, `/stop`, `/status`, `/sessions`, `/bind`, `/unbind`, and `/help`.
- `src/registry.ts` owns adapter registration and lifecycle.
- `src/adapters/` owns Telegram, DingTalk, WeChat, Feishu, and Slack payload adapters. Network calls go through `ChannelHttpTransport`; tests inject a recording transport.

Run `pnpm --filter @hilbras/omnicode-channels typecheck` and `pnpm --filter @hilbras/omnicode-channels test`.


## Runtime service

`src/runtime.ts` loads `channels.json`, creates adapters from env-referenced secrets, enforces config allowlists, binds conversations to sessions, executes lifecycle commands, and dispatches bound messages through injected callbacks. `start()` never opens unconfigured channels; missing credentials become explicit status errors — the CLI helper fails closed instead of running a half-configured runtime. CLI composition lives in `apps/omnicode-cli/src/cli/channels.ts`; daemon composition stays outside this package, and no HTTP webhook listener is started by this package.


## Inbound security

`src/security.ts` provides HMAC-SHA256, Slack v0, Telegram secret-token, WeChat SHA1, DingTalk HMAC, and Feishu request-signature verification, plus replay protection and token-bucket rate limiting. `ChannelRuntimeService.handleInbound()` enforces provider/generic signatures (when required), rate limit, and replay checks before dispatch. Secrets stay in host env/config and are never logged.


## Durable bindings

`bindingStore.ts` provides `FileChannelBindingPersistence`: atomic JSON writes with mode 0600, missing-file empty load, malformed-entry filtering, and explicit malformed-JSON failure. `ChannelSessionBindingService` supports `load()` and `flush()` when persistence is supplied.
