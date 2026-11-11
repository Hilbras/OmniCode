# channels

Channel platform contracts and adapters. Lives outside `engine` so adapters can be tested without a running daemon.

- `src/contracts.ts` owns inbound/outbound messages, adapter contract, config, bindings, and the channel memory scope hint.
- `src/binding.ts` owns in-memory session bindings and channel config allowlists.
- `src/commands.ts` owns `/new`, `/stop`, `/status`, `/sessions`, `/bind`, `/unbind`, and `/help`.
- `src/registry.ts` owns adapter registration and lifecycle.
- `src/adapters/` owns Telegram, DingTalk, WeChat, Feishu, and Slack payload adapters. Network calls go through `ChannelHttpTransport`; tests inject a recording transport.

Run `pnpm --filter @hilbras/omnicode-channels typecheck` and `pnpm --filter @hilbras/omnicode-channels test`.


## Runtime service

`src/runtime.ts` loads `channels.json`, creates adapters from env-referenced secrets, enforces config allowlists, binds conversations to sessions, executes lifecycle commands, and dispatches bound messages through injected callbacks. `start()` never opens unconfigured channels; missing credentials become explicit status errors. CLI/daemon composition remains outside this package.
