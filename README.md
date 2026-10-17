<div align="center">

<img src="assets/logo-256.png" alt="Omnicode" width="128" />

# Omnicode CLI

**An AI coding agent that runs in your terminal — with any OpenAI-compatible endpoint as a
first-class provider.**

[![License](https://img.shields.io/badge/license-MIT-C06014?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524.15-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![npm](https://img.shields.io/badge/npm-%40hilbras%2Fomnicode-CB3837?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@hilbras/omnicode)

Omnicode works against any provider you can point it at. No registry document, no catalog
entry, no hand-written model metadata — you type the endpoint, it discovers the models itself.

</div>

---

## Adding a provider

Omnicode can set up and manage providers from the CLI and from the TUI.

| What you want | How |
|---|---|
| Import every provider in a custom `api.json` registry | `omnicode provider add <url>` |
| Import from the public models.dev catalog | `omnicode provider catalog add <id>` |
| **Add a provider by hand** (`--type` + `--base-url` + key) | `omnicode provider add-manual` |
| **Use one of the 17 built-in vendors** (see the table below) | `omnicode provider add-builtin <id>` |
| **Change a provider's endpoint, protocol or key later** | `omnicode provider edit <id>` |
| **Pick a provider in the TUI** (`/provider` → Add provider) | asks for the key, discovers the models, picks a default |

The first two need a registry document to exist somewhere. The two `add` commands do not: for
any provider with a declared `base_url`, no `oauth` reference and no registry `source`,
Omnicode fetches `{base_url}/models` and writes one alias per model. **You type the endpoint,
it discovers the models itself.**

The same discovery flow is available in both places — `/provider` → **Add provider** → pick a
vendor, or from the command line with `omnicode provider add-builtin <id>`.

### Built-in providers

All 17 are configured the same way — `omnicode provider add-builtin <id> --api-key "$KEY"`, or
`--api-key-env VAR` to read the key from the environment instead of storing it.

| Id | Vendor | Endpoint | Wire |
|---|---|---|---|
| `cline` | Cline | `https://api.cline.bot/api/v1` | openai |
| `openrouter` | OpenRouter | `https://openrouter.ai/api/v1` | openai |
| `opencode-zen` | OpenCode Zen | `https://opencode.ai/zen/v1` | openai |
| `opencode-go` | OpenCode Go | `https://opencode.ai/zen/go/v1` | openai |
| `nvidia` | NVIDIA | `https://integrate.api.nvidia.com/v1` | openai |
| `nara` | NaraRouter | `https://router.bynara.id/v1` | openai |
| `tokenharbor` | Token Harbor | `https://tokenharbor.ai/v1` | openai |
| `openai` | OpenAI | `https://api.openai.com/v1` | openai |
| `anthropic` | Anthropic | `https://api.anthropic.com` | anthropic |
| `gemini` | Google Gemini | `https://generativelanguage.googleapis.com/v1beta` | google-genai |
| `grok` | xAI Grok | `https://api.x.ai/v1` | openai |
| `groq` | Groq | `https://api.groq.com/openai/v1` | openai |
| `qwen` | Qwen | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | openai |
| `minimax` | MiniMax | `https://api.minimax.io/v1` | openai |
| `deepseek` | DeepSeek | `https://api.deepseek.com` | openai |
| `mistral` | Mistral | `https://api.mistral.ai/v1` | openai |
| `huggingface` | Hugging Face | `https://router.huggingface.co/v1` | openai |

Anthropic and Gemini are not plain OpenAI-compatible: Anthropic takes `x-api-key` plus a
pinned `anthropic-version` and its model list lives at `/v1/models` (the chat base is a bare
host), and Gemini returns `{models:[{name}]}` with the key in `x-goog-api-key`. The
discovery path handles both, so `add-builtin` needs no vendor-specific flags.

Built-ins skip the models.dev catalog entirely, so they work when models.dev is unreachable —
which is the case in a dev build, since the release-time catalog snapshot is not present.

**Per-model protocols.** `/models` returns model ids and little else, so it cannot express
that one model on a gateway is served over a different protocol than the rest. OpenCode Zen
lists Claude models that it actually serves over the Anthropic Messages API; models.dev marks
those models, but a plain `/models` fetch cannot see it.

Built-ins that hit this declare the mapping in the vendor table, which is written into config
as `providers.<id>.protocolOverrides` and copied onto each matching model alias — where it
takes precedence over the provider's own wire. `opencode-zen` declares `claude-*` as
`anthropic`, so its Claude models work rather than being listed and then failing on first use.
Matching is longest-prefix-wins, and an exact model id beats any glob.

A manual provider can set the same map by hand:

```toml
[providers.my-gateway]
type = "openai"
base_url = "https://gateway.example.com/v1"
protocolOverrides = { "claude-*" = "anthropic" }
```

Only `anthropic`, `openai`, `openai_responses` and `google-genai` are accepted; an unknown wire
is dropped with a warning rather than failing the whole refresh.

### `omnicode provider add-manual`

Configure any OpenAI-compatible endpoint and discover its models in one step:

```sh
omnicode provider add-manual my-gateway \
  --type openai \
  --base-url https://gateway.example.com/v1 \
  --api-key "$MY_GATEWAY_KEY"
```

```
Added provider "my-gateway" (type=openai, base_url=https://gateway.example.com/v1).
Discovering models from the endpoint…
  - my-gateway/llama-4-70b
  - my-gateway/qwen3-max
  - my-gateway/mistral-large-2

Set a default with: omnicode --model my-gateway/llama-4-70b
```

To keep the key out of `config.toml`, bind it to an environment variable instead:

```sh
omnicode provider add-manual my-gateway \
  --type openai \
  --base-url https://gateway.example.com/v1 \
  --api-key-env MY_GATEWAY_KEY
```

#### Options

| Flag | Required | Description |
|---|---|---|
| `--type <type>` | yes | Wire protocol: `openai`, `openai_responses`, or `omnicode` |
| `--base-url <url>` | yes | Base URL, e.g. `https://gateway.example.com/v1` |
| `--api-key <key>` | one of | Inline key. Falls back to `OMNICODE_REGISTRY_API_KEY` |
| `--api-key-env <VAR>` | one of | Read the key from this environment variable |

`anthropic` and `google-genai` are accepted: both vendors do expose a model-list route
(`GET /v1/models` with `x-api-key` + `anthropic-version`, and Google's
`{models:[{name}]}` with `x-goog-api-key`), and the discovery path speaks both.

**Discovery is best-effort, never silent.** If `{baseUrl}/models` is unreachable or returns
401, the provider is still saved and the command exits non-zero with instructions for
declaring models manually. You are never left with a provider that looks configured but
cannot resolve a model.

### `omnicode provider add-builtin <id>`

Configure any built-in vendor non-interactively — endpoint and protocol already set:

```sh
omnicode provider add-builtin cline --api-key "$CLINE_API_KEY"
omnicode provider add-builtin openrouter --api-key "$OPENROUTER_API_KEY"
omnicode provider add-builtin nvidia --api-key-env NVIDIA_API_KEY
```

`--api-key-env` keeps the key out of `config.toml`; the value is read from that environment
variable at request time.

Models are always read live from the vendor's `/models` route, never from a hardcoded list, so
a built-in tracks the vendor's current catalog. Several of these vendors are also importable
from the models.dev catalog (`omnicode provider catalog add openrouter`, `... add nvidia`), which is
worth preferring when you want the catalog's richer per-model metadata.

### `omnicode provider edit <id>`

Change a provider that is already configured — a rotated key, a moved endpoint, a different
protocol:

```sh
omnicode provider edit openai --api-key "$OPENAI_API_KEY"
omnicode provider edit mygw --base-url https://gateway.example.com/v1
omnicode provider edit mygw --type openai_responses
omnicode provider edit mygw --api-key-env GATEWAY_KEY   # stop storing the key inline
omnicode provider edit mygw --base-url https://x.test/v1 --no-refresh
```

| Flag | Effect |
|---|---|
| `--type <type>` | New wire protocol (`openai`, `openai_responses`, `anthropic`, `google-genai`, `omnicode`) |
| `--base-url <url>` | New endpoint. Must be `http(s)` |
| `--api-key <key>` | New inline key. Falls back to `OMNICODE_REGISTRY_API_KEY` |
| `--api-key-env <VAR>` | Read the key from this variable instead of storing it inline |
| `--no-refresh` | Apply the change without re-reading the model list |

Only the flags you pass are touched; everything else on the provider record is left as it was.
Three details worth knowing:

- **The edit is applied in place**, so existing model aliases and your `default_model` survive.
  Removing and re-adding would drop both and silently repoint the next session.
- **`--api-key` and `--api-key-env` replace each other**, not accumulate — the config rejects a
  record carrying both. Passing both flags at once is an error.
- **A failed refresh does not roll back the edit.** The change is saved, the error is reported,
  and the previous model list stays intact, so a wrong key is a one-flag fix rather than a
  re-add.

---

## How discovery works

The model refresh orchestrator has five branches for maintaining a provider's model list:
managed OAuth, first-party platforms, managed-endpoint API keys, endpoint discovery, and
custom registries. Endpoint discovery is the branch that handles a provider you typed in by
hand — the other four only cover providers Omnicode already knows how to reach. For any
provider with a declared `base_url`, no `oauth` reference, and no registry `source`, it
fetches `{base_url}/models` and writes one alias per model.

**Design decisions worth knowing:**

- **One implementation, not two.** The CLI command does not reimplement discovery — it writes
  the provider record and delegates to the same engine refresh the TUI uses. A provider added
  from the CLI refreshes identically to one added from the TUI.
- **The provider record is user-owned.** Discovery rewrites *only* model aliases. It never
  touches the `base_url` or the credential you configured.
- **Declared-but-absent metadata gets conservative defaults.** Many OpenAI-compatible servers
  return bare `{ id }` rows. Those models still become usable aliases rather than being
  rejected.
- **Providers that other branches already own are excluded.** The managed Omnicode endpoint and
  the synthetic `__omnicode_env__` provider (injected by the `OMNICODE_MODEL_*` env overlay) are
  explicitly skipped, so discovery never double-fetches or clobbers them.
- **Embedding entries are dropped.** Endpoints routinely mix embedding and fine-tune models
  into `/models`; those cannot drive a chat turn and are skipped rather than offered.

### Discovery payload shapes accepted

| Endpoint returns | Handling |
|---|---|
| `{ "data": [{ "id": "..." }] }` | ✅ OpenAI standard |
| `[{ "id": "..." }]` | ✅ bare array |
| `{ "id": "...", "context_length": 200000 }` | context window read from the row |
| `object: "embedding"` rows | skipped — not usable for chat |

---

## Install

The CLI is published to npm as
[`@hilbras/omnicode`](https://www.npmjs.com/package/@hilbras/omnicode); the VS Code marketplace
is not used. Publishing is done manually by the maintainers, not by an automated workflow.
You can also build and run it from source:

```sh
git clone https://github.com/hilbras/omnicode.git
cd omnicode
pnpm install
pnpm build
node apps/omnicode/dist/main.mjs --version
```

> **Clone tip:** a default clone pulls the full commit history, which is most of the clone
> weight. If you only want the code, clone the `lite` branch instead — byte-identical files,
> history squashed to a single commit and a much smaller download:
>
> ```sh
> git clone --branch lite --single-branch https://github.com/hilbras/omnicode.git
> ```

### One-shot install

`install-devtools.sh` installs the computer-use tools, checks the Node toolchain, and builds the
CLI from this checkout:

```sh
./install-devtools.sh
```

| Flag | Effect |
|---|---|
| `--check` | Report what is present and what is missing. Changes nothing |
| `--tools` | Install only the computer-use tools |
| `--no-build` | Install the tools, skip the pnpm build |
| `--vm` | Also create a disposable VM for the autonomous-agent work (see below) |

It installs into this checkout and a user-local prefix
(`~/.local/opt/omnicode-computer-tools`) — it never touches an already installed
`omnicode`, and never writes outside those paths. Without passwordless `sudo` it
falls back to `apt-get download` plus `dpkg-deb -x`, so it works unprivileged;
it will not prompt for a password.

Run it whenever you want to know the state of the machine:

```sh
./install-devtools.sh --check
```

#### Node.js

This repo requires **Node.js >= 24.15.0** (see `engines` in `package.json`).
Stock Ubuntu 24.04 ships **Node 22**, so a fresh VM cannot satisfy that from
`apt` alone — `install-devtools.sh` detects the version and installs Node into
`~/.local/opt/node` via `fnm` when the system one is too old. No sudo, and it
does not touch the distro's Node.

`pnpm` is pinned to `10.33.0` and installed through corepack if it is missing or
at a different version.

If you would rather manage Node yourself, install it first and re-run; the
script uses whatever meets the floor:

```sh
# any of these is fine
nvm install 24 && nvm use 24
fnm install 24 && fnm use 24
mise use node@24
```

#### Computer-use tools

`xdotool`, `wmctrl`, `x11-apps` (for `xwd`) and ImageMagick. ImageMagick's
`import` is the screenshot path, and its package name varies by release
(`imagemagick-7.q16` on Ubuntu 26.04), so the script resolves it rather than
hardcoding one.

The tools stay **off by default**. Enable them per shell:

```sh
export OMNICODE_EXPERIMENTAL_COMPUTER_USE=1
export PATH="$HOME/.local/opt/omnicode-computer-tools/bin:$PATH"
export LD_LIBRARY_PATH="$HOME/.local/opt/omnicode-computer-tools/lib/x86_64-linux-gnu:$LD_LIBRARY_PATH"
pnpm run omnicode
```

A test asserts the feature contributes zero tools when the flag is off, so a
machine without computer control is unchanged.

#### Disposable VM

`./install-devtools.sh --vm` creates a 40 GB sparse qcow2 disk and a launcher for an
Ubuntu 24.04 desktop VM with 4 vCPU, 8 GB RAM, port-forwarded SSH on 2222, and
a disposable profile for the browser.

Hardware acceleration needs `/dev/kvm`, which on most distributions requires
membership of the `kvm` group:

```sh
sudo usermod -aG kvm "$(id -un)"   # then log out and back in
```

Without it the VM still runs, under software emulation, and is slow. The script
detects this and says so rather than starting a VM that appears to hang.

#### Running inside a VirtualBox VM

`install-devtools.sh` is the full setup for a dedicated Ubuntu VM that the agent will
drive. Inside a guest desktop it also checks the things that only matter in a
guest:

```sh
./install-devtools.sh              # tools, toolchain, build
./install-devtools.sh --check-screen   # does screen capture actually work here?
```

`--check-screen` is the one to run after installing Ubuntu, before trusting
anything. It reports the session type and tests each capture path, then tells you
what to do if neither works:

| Symptom | Meaning | Fix |
|---|---|---|
| `gnome-shell  works` | GNOME returns frames over D-Bus | nothing to do |
| `imagemagick  works` | X11 capture works | nothing to do |
| both unavailable | capture is blocked | choose "Ubuntu on Xorg" at the login screen |

Run it from inside the graphical session. Over plain SSH there is no display to
capture, and the script says so rather than reporting a failure you cannot act
on.

**Why capture is the thing to check first.** Under Wayland — the Ubuntu default
— an X11 client cannot read the framebuffer at all. `import` and `xwd` both fail
on `X_GetImage`, and no amount of tool installation fixes that. GNOME Shell, as
the compositor, can hand out a frame of its own output, so `capture.ts` tries
GNOME's D-Bus API first and ImageMagick second. If both are blocked, switch the
session to X11; that is the one configuration where capture is guaranteed.

### Running from source

```sh
pnpm run omnicode              # the CLI from this checkout
pnpm run omnicode -- --version
```

`pnpm run omnicode` uses `scripts/omnicode-dev.mjs`, which runs against an isolated
`OMNICODE_HOME` so a development run never touches an installed `omnicode`'s
configuration.

For the **official, signed release**, use the installer:

```sh
curl -fsSL https://code.omnicode.com/omnicode/install.sh | bash
```

Requires Node.js ≥ 24.15.0 and pnpm 10.33.0.

### Install the CLI

The npm package installs an `omnicode` command. Its data home is `~/.omnicode`
(`OMNICODE_HOME` overrides it); on first run it copies your config, sessions, and history out of a
legacy data home and leaves that original home untouched.

`install.sh` is the one-shot alternative: it installs the published `@hilbras/omnicode` npm
package into an isolated prefix (default `~/.local/share/omnicode/lib`) and exposes the
same `omnicode` command. It needs only Node.js ≥ 24.15.0 and `npm` (or `pnpm`); no build
step or pnpm workspace.

```sh
npm install -g @hilbras/omnicode                # or:
./install.sh                                     # latest published version
./install.sh --version 3.0.0                     # pin a version
./install.sh --bin-dir "$HOME/.local/bin"        # where the launcher goes (default ~/.local/bin)
```

`OMNICODE_VERSION`, `OMNICODE_PREFIX`, `OMNICODE_BIN_DIR`, and `OMNICODE_NO_MODIFY_PATH` mirror the
flags. The script adds `~/.local/bin` to your shell rc when it is not already on `PATH`
(skipped when `OMNICODE_NO_MODIFY_PATH` is set) and verifies the launcher with `--version`.
Upgrade by re-running the script.

---

## Develop

```sh
pnpm omnicode          # run THIS checkout's CLI (not an installed binary)
pnpm dev:cli       # run the CLI in dev mode
pnpm test          # run tests
pnpm typecheck     # TypeScript check
pnpm lint          # oxlint (includes the no-comments guard)
pnpm build         # build all packages
```

`pnpm run omnicode -- provider list` and `pnpm run omnicode` (interactive) run the code in this
checkout. It sets `OMNICODE_HOME` to a repo-local `.omnicode-dev-home/`, so a dev run never reads
or writes an installed `omnicode`'s config at `~/.omnicode/`. Override it to share that config
instead:

```sh
OMNICODE_HOME="$HOME/.omnicode" pnpm run omnicode -- provider list
```

Run the provider tests specifically:

```sh
npx vitest run apps/omnicode/test/cli/provider.test.ts
npx vitest run packages/omnicode-core/test/app/kosongConfig/discovery.test.ts
```

Architecture, coding rules, and contribution guidance live in [AGENTS.md](AGENTS.md) and
[CONTRIBUTING.md](CONTRIBUTING.md).

---

## Project

- **Maintained by:** Hilbras · <https://github.com/hilbras/omnicode>
- **Branches:** `main` (canonical, full history) · `lite` (same content, squashed to a single
  commit, much smaller clone)
- **History and attribution:** Omnicode builds on prior work that remains under the MIT
  License. [CREDITS.md](CREDITS.md) records the upstream base commit and a per-file breakdown
  of what was added on top of it.

## Acknowledgements

- **Hilbras** for Omnicode CLI, the foundation of this project.
- [`pi-tui`](https://github.com/earendil-works/pi-mono/tree/main/packages/tui) — the TUI
  layer, used under its original license.

## License

MIT. Copyright (c) 2026 Hilbras. See [LICENSE](LICENSE).