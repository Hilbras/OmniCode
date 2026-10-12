---
name: check-omnicode-docs
description: Answer questions about the Omnicode product using the official documentation — CLI usage, configuration, slash commands, features, membership and quota, API onboarding, third-party tool setup, and error codes. Use when the user asks how Omnicode works, how to set something up, or what a Omnicode error message means.
---

# Check Omnicode docs (check-omnicode-docs)

Answer Omnicode **product** questions from the official documentation site, not from memory. This skill covers product usage ("how do I configure a provider", "what does this error mean", "how does membership quota work"); it is not for developing the Omnicode repository itself.

## The single source of truth

Official documentation (English):

```
https://www.omnicode.com/code/docs/en/
```

Fetch pages with **FetchURL** before answering. All page links below are relative to this base.

## Which page to read for which question

| Question topic | Page (relative to the base URL) |
| --- | --- |
| What Omnicode is; Base URL / API Key; standard vs high-speed model; platform comparison | `./` (home overview) |
| Membership plans, quota and rate limits, fuel packs | `omnicode/membership.html` |
| Install / login / usage FAQ | `omnicode/faq.html` |
| Error codes and their meaning (e.g. 401 for high-speed model access) | `omnicode/error-reference.html` |
| Product news and recent changes | `omnicode/whats-new.html` |
| Community guidelines; contact and feedback | `omnicode/community-guidelines.html`, `omnicode/contact-and-feedback.html` |
| `config.toml` fields, providers/models, environment variables, data locations, config overrides | `omnicode-cli/configuration/` — `config-files.html`, `providers.html`, `env-vars.html`, `data-locations.html`, `overrides.html` |
| Skills, MCP, hooks, plugins, themes, agents/sub-agents, Omnicode Datasource | `omnicode-cli/customization/` — `skills.html`, `mcp.html`, `hooks.html`, `plugins.html`, `themes.html`, `agents.html`; Omnicode Datasource lives at `plugins.html#omnicode-datasource` |
| Getting started, sessions and context, goals, interaction and input, IDEs, migration, use cases | `omnicode-cli/guides/` — `getting-started.html`, `sessions.html`, `goals.html`, `interaction.html`, `ides.html`, `migration.html`, `use-cases.html` |
| Slash commands, keyboard shortcuts, builtin tools, `omnicode` command flags, ACP | `omnicode-cli/reference/` — `slash-commands.html`, `keyboard.html`, `tools.html`, `omnicode-command.html`, `omnicode-acp.html` |
| CLI changelog | `omnicode-cli/release-notes/changelog.html` |
| Using Omnicode in Claude Code and other third-party agents | `third-party-tools/other-coding-agents.html` |

If no row fits the question, fetch the docs home page and follow its navigation links.

## How to answer

1. Pick the page from the table above.
2. **FetchURL the page before answering** — answer strictly from the fetched content, never from memory.
3. Cite the page link(s) you used at the end of the answer.
4. If the fetch fails or the docs do not cover the question, say so plainly: answer from what you already know, attach the docs entry link (`https://www.omnicode.com/code/docs/en/`), and mark which parts you could not verify. **Never invent config keys, command names, model IDs, or product behaviors.**
