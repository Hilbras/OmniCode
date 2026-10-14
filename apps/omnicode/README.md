# @hilbras/omnicode

> The Starting Point for Next-Gen Agents

[![npm](https://img.shields.io/npm/v/@hilbras/omnicode)](https://www.npmjs.com/package/@hilbras/omnicode) [![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)  [![Docs](https://img.shields.io/badge/docs-online-blue)](https://hilbras.github.io/omnicode/en/)

> Omnicode is maintained by Hilbras. Source: [Hilbras/OmniCode](https://github.com/Hilbras/OmniCode).
> Published as [`@hilbras/omnicode`](https://www.npmjs.com/package/@hilbras/omnicode).
>
> Upgrade with `npm install -g @hilbras/omnicode@latest`.

## What is Omnicode CLI

Omnicode CLI is an AI coding agent that runs in your terminal. It can read and edit code, run shell commands, search files, fetch web pages, and choose the next step based on the feedback it receives. It works out of the box with Hilbras's Omnicode models and can also be configured to use other compatible providers.

## Install

```sh
npm install -g @hilbras/omnicode
```

Or with pnpm:

```sh
pnpm add -g @hilbras/omnicode
```

Requires Node.js 22.19.0 or later.

On Windows, install [Git for Windows](https://gitforwindows.org/) before first launch because Omnicode CLI uses the bundled Git Bash as its shell environment. If Git Bash is installed in a custom location, set `OMNICODE_SHELL_PATH` to the absolute path of `bash.exe`.

Then run it with a new Terminal session:

```sh
omnicode --version
```

> Official install scripts: macOS / Linux
> `curl -fsSL https://code.omnicode.com/omnicode/install.sh | bash`, Windows
> `irm https://code.omnicode.com/omnicode/install.ps1 | iex`.

For upgrade and uninstall instructions, see the [Getting Started guide](https://hilbras.github.io/omnicode/en/guides/getting-started).

## Quick Start

Open a project and start the interactive UI:

```sh
cd your-project
omnicode
```

On first launch, run `/login` inside Omnicode CLI and choose either Omnicode OAuth or a Omnicode Platform API key. After login, try a first task:

```
Take a look at this project and explain the main directories.
```

## Key Features

- **Single-binary distribution.** Install with one command — no Node.js setup, no PATH gymnastics, no global module conflicts.
- **Blazing-fast startup.** The TUI is ready in milliseconds, so opening a session never feels heavy.
- **Polished TUI.** A carefully tuned interface designed for long, focused agent sessions.
- **Video input.** Drop a screen recording or demo clip into the chat — let the agent watch instead of typing out what's hard to describe in words.
- **AI-native MCP configuration.** Add, edit, and authenticate Model Context Protocol servers conversationally via `/mcp-config` — no hand-editing JSON.
- **Subagents for focused, parallel work.** Dispatch built-in `coder`, `explore`, and `plan` subagents in isolated context windows; the main conversation stays clean.
- **Lifecycle hooks.** Run local commands at key points — gate risky tool calls, audit decisions, fire desktop notifications, wire into your own automation.

## Documentation

- Full docs: https://hilbras.github.io/omnicode/en/
- 中文文档: https://hilbras.github.io/omnicode/zh/
- Getting Started: https://hilbras.github.io/omnicode/en/guides/getting-started

## Repository & Issues

- Source: https://github.com/Hilbras/OmniCode
- Issues: https://github.com/Hilbras/OmniCode/issues
- Security: see SECURITY.md in the main repository

## License

MIT
