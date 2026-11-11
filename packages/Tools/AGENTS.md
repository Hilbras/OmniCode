# Tools — built-in agent tools

## Role and non-goals

`@hilbras/omnicode-tools` ships the built-in tools the model can call:
filesystem (`Read`, `Write`, `Edit`, `Glob`, `Grep`), shell (`Bash`), document
extraction, `WebSearch`, `FetchURL`, `AskUserQuestion`, `SelectTools`,
`RestoreFile`, and feature tools for plan, goal, cron, swarm, todo, notify, and
skill.

Not here: the tool contract and registry (`packages/engine/src/tool` and
`agent/toolRegistry/`), permission policy, profile allowlists, MCP transports,
or UI. Tools are implementations; the engine owns admission and execution.

## Entry points and ownership

- `src/index.ts` is the single barrel and activation point. It exports tool
  contracts and side-effect-imports every tool module so
  `registerAgentToolService` runs.
- `src/os/<tool>/` owns shell, read, write, glob, grep, and search tools.
- `src/edit/`, `src/fetch-url/`, `src/web-search/`,
  `src/ask-user-question/`, `src/select-tools/`, and `src/restore-file/` own
  their named tools.
- `src/features/<feature>/tools/` owns feature-specific tools such as plan,
  goal, cron, swarm, todo, notify, and skill. The feature service itself stays
  in `packages/engine/src/features/`.
- Each tool normally has a pure contract/schema file (`<tool>.ts`), a tool class
  (`<tool>Tool.ts`), and a prompt template (`<tool>.md`) imported as raw text.

## Registration and visibility rules

- A tool class is registered with:

```ts
registerAgentToolService(ITool, ToolClass, { name: TOOL_NAME, domain: '...' });
```

  from `@hilbras/omnicode-engine/agent/toolRegistry/toolContribution`.
- Registration alone does not make the tool visible. The active profile allowlist
  in `packages/engine/src/session/agentLifecycle/profile/profiles.ts` must list
  the tool name. Add it there when adding a built-in tool.
- Approval is separate. Add only genuinely read-only/safe tools to
  `packages/engine/src/agent/permissionPolicy/policies/default-tool-approve.ts`;
  mutating tools need an explicit safety argument.
- `src/index.ts` must import the tool module for its side effect. A new file that
  nobody imports is dead code.
- Tool names are part of the model contract. Keep them stable unless the change
  is intentionally breaking.

## Import boundaries

- Tools sit above the engine. Import engine contracts through public subpaths
  such as `@hilbras/omnicode-engine/tool/toolContract` and
  `@hilbras/omnicode-engine/agent/toolRegistry/toolContribution`; import base
  utilities from `@hilbras/omnicode-base`.
- Tools must not import `human/` implementation, `llm-adapter/` internals,
  `packages/Addons`, `packages/memory`, or an app package.
- The engine must never import `packages/Tools` from `src/`; engine tests may
  import it through `packages/engine/test/setup.ts`.
- Do not add a new package-level dependency without checking the workspace
  graph and `pnpm check:architecture`.

## Generated manifests

`packages/Tools` owns no generated manifest. `src/os/read/configSection.ts`
registers the `read` config section through the engine; the engine config
manifest generator scans engine `src` ownership, so that section does not get a
manifest row. Changes to a config schema still require the engine owner to run
`pnpm --filter @hilbras/omnicode-engine gen:config-manifest` when the schema is
wired into an engine-owned section. There are no wire/state manifests here.

## Tests

Only `packages/Tools/test/extract.test.ts` exists today. It covers document
format detection and RTF extraction; there are no per-tool tests for Bash, Edit,
Read, Grep, Glob, Write, WebSearch, FetchURL, or the feature tools. The package
Vitest config uses `passWithNoTests`, so a missing or unmatched test file does
not fail the run.

```bash
pnpm --filter @hilbras/omnicode-tools typecheck
pnpm --filter @hilbras/omnicode-tools test
pnpm --filter @hilbras/omnicode-tools exec vitest run test/extract.test.ts
```

When adding a test, mirror `src/` under `test/` and drive the real tool class
through `resolveExecution`, not only the schema.

## Local traps and where new logic belongs

- Add the tool implementation, prompt, and schema here; add the profile
  allowlist and approval policy in the engine.
- Use `ToolAccesses` and `approvalRule`/`matchesRule` so approval and path rules
  stay meaningful.
- Path-taking tools must resolve through `resolvePathAccessPath` and the runtime
  workspace view; do not join raw input paths.
- Shell execution uses argument arrays and the host process/runtime seam, never
  shell strings.
- Respect result truncation and redaction contracts from
  `packages/engine/src/tool/toolContract.ts`; do not bypass them.
- A feature tool belongs in `src/features/<feature>/tools/`; its service and
  state belong in `packages/engine/src/features/<feature>/`.

## Do not add here

Do not add engine services, permission policy, profile definitions, MCP
transports, agent loop logic, UI code, or tests that only read source text.
