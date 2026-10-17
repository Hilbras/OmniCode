# Credits

Omnicode is built on two projects and two people.

## Upstream

**Omnicode CLI** — Hilbras · MIT License
<https://github.com/Hilbras/omnicode> · <https://hilbras.github.io/omnicode/en/>

Everything in this repository that is not listed under "Changes made after the upstream base" below is upstream
work, Copyright (c) 2026 Hilbras, and remains under the MIT License in [LICENSE](LICENSE).
This project is based on upstream commit `21406fb4c` (omnicode 2.1.1).

Project and release details live in the [README](README.md#project).

## Changes made after the upstream base

**Author: Hilbras** · <https://github.com/hilbras>

### Files authored in this project

These are new; the whole file is this project's work and carries an author line in its header.

| File | What it does |
|---|---|
| `packages/omnicode-auth/src/discover-models.ts` | Model discovery for hand-written providers — fetches `{base_url}/models`, handles Bearer / `x-api-key` / `x-goog-api-key` auth, and both the OpenAI (`data[].id`) and Google (`models[].name`) response shapes. |
| `apps/omnicode/src/utils/built-in-providers.ts` | The 17 built-in vendor endpoints, their wire, display name, key-prefix hint and discovery auth style. Shared by the CLI and the TUI so an endpoint cannot differ between them. |
| `scripts/omnicode-dev.mjs` | `pnpm run omnicode` — runs the CLI from this checkout against an isolated `OMNICODE_HOME`, so a dev run never touches an installed `omnicode`'s config. |

### Upstream files modified

These are upstream's files. The upstream copyright notice is left intact, as the MIT License
requires; this project's edits to them are recorded here instead of by rewriting their headers.

| File | Change |
|---|---|
| `packages/omnicode-auth/src/refreshProviderModels.ts` | New discovery branch: populates model aliases for a provider that has a declared base URL, no oauth ref and no registry source. Also the per-wire auth/version profile used by that branch. |
| `packages/omnicode-auth/src/index.ts` | Exports the new discovery module. |
| `packages/omnicode-core/test/app/kosongConfig/discovery.test.ts` | Tests for the discovery branch, including the exclusions (managed endpoint, `__omnicode_env__`). |
| `apps/omnicode/src/cli/sub/provider.ts` | `omnicode provider add-manual` and `omnicode provider add-builtin`. |
| `apps/omnicode/src/tui/commands/provider.ts` | The `/provider` built-in flow: key prompt, discovery, default-model picker. |
| `apps/omnicode/src/tui/components/dialogs/model-selector.ts` | Model search now matches the alias and model id, not only the display label. |
| `apps/omnicode/test/cli/provider.test.ts` | Tests for the new commands and the vendor table. |
| `apps/omnicode/test/tui/components/dialogs/model-selector.test.ts` | Test that search matches a gateway model id. |
| `apps/omnicode/package.json`, `package.json` | The `omnicode` / `dev:local` script entries. |
| `packages/omnicode-auth/src/discover-models.ts` | Per-model wire overrides: `resolveProtocolOverride` (longest-prefix-wins) and `applyProtocolOverrides`, plus writing a declared wire onto the model alias. |
| `packages/omnicode-auth/src/managed-omnicode.ts` | `parseModelProtocol` accepts every `ProtocolSchema` wire (`openai`, `google-genai` added), not just `anthropic` / `response`. |
| `packages/omnicode-core/src/llm-adapter/provider/provider.ts`, `app/kosongConfig/configSection.ts` | `providers.<id>.protocolOverrides` — the config field discovery reads the pins from. |
| `apps/omnicode/src/utils/built-in-providers.ts` | The `protocolOverrides` field, declared for `opencode-zen` (`claude-*` → `anthropic`); `vertexai` removed from the wire union, where it was a declared wire that `add-manual` rejected. |
| `apps/omnicode/test/cli/provider.test.ts` | Guards that a built-in declares only wires `add-manual` accepts, and that overrides name known wires. |
| `packages/omnicode-auth/test/discover-models.test.ts` | Override resolution, longest-prefix-wins, alias persistence. |
| `.gitignore` | Ignores the dev runner's isolated config home. |
| `README.md` | Project documentation. |

### Workflows removed from this project

Upstream's nine GitHub Actions workflows are intentionally **not** present here. `release.yml`
publishes to npm via OIDC trusted publishing, `vscode-publish.yml` publishes to the VS Code and
Open VSX marketplaces, and the native-build workflows require Apple signing certificates —
none of which should or can run under a personal account. Publishing is done manually by the maintainers
from the release branch.

## Acknowledgements

- **Hilbras** for Omnicode CLI, the foundation of this project.
- [`pi-tui`](https://github.com/earendil-works/pi-mono/tree/main/packages/tui) — upstream's TUI
  layer, used under its original license.
- The vendors behind the built-in providers (Cline, OpenRouter, OpenCode, NVIDIA, NaraRouter,
  Token Harbor, OpenAI, Anthropic, Google, xAI, Groq, Alibaba, MiniMax, DeepSeek, Mistral,
  Hugging Face), whose public APIs the discovery path reads.
