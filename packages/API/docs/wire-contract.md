# Wire contract reference

Every service method and event registered on the client boundary of
`@hilbras/omnicode-api`. Generated from the zod contract tables in
`packages/client-contract/src/contract/` by
`pnpm --filter @hilbras/omnicode-api gen:api-reference` — do not edit by hand.

The type summaries below are shallow on purpose; the full JSON Schema for each
entry is in `packages/API/docs/wire-contract.json`. `no value` marks a
procedure that resolves with nothing (`z.void()`), which JSON Schema cannot
express.

## Procedures

### agentCommandService

| method | kind | input | output |
| --- | --- | --- | --- |
| `list` | unary | () | object{name, description?, source}[] |
| `run` | unary | (string, string) | no value |

### agentContextMemoryService

| method | kind | input | output |
| --- | --- | --- | --- |
| `get` | unary | () | unknown[] |

### agentFullCompactionService

| method | kind | input | output |
| --- | --- | --- | --- |
| `begin` | unary | (object{source, instruction?}) | boolean |

### agentLoopService

| method | kind | input | output |
| --- | --- | --- | --- |
| `cancelFromUser` | unary | (number) | no value |

### agentMcpService

| method | kind | input | output |
| --- | --- | --- | --- |
| `list` | unary | () | object{name, transport, status, toolCount, error?}[] |

### agentPermissionModeService

| method | kind | input | output |
| --- | --- | --- | --- |
| `setModeAndBroadcast` | unary | ("manual" \| "yolo" \| "auto") | no value |

### agentPlanService

| method | kind | input | output |
| --- | --- | --- | --- |
| `cancel` | unary | (string) | no value |
| `clear` | unary | () | no value |
| `enter` | unary | () | no value |
| `status` | unary | () | null \| object{id, content, path} |

### agentProfileService

| method | kind | input | output |
| --- | --- | --- | --- |
| `getEffectiveThinkingLevel` | unary | () | string |
| `getModel` | unary | () | string |
| `setModel` | unary | (string) | object{model, providerName?} |
| `setThinking` | unary | (string) | no value |

### agentPromptService

| method | kind | input | output |
| --- | --- | --- | --- |
| `submit` | unary | (object{input, promptId?}) | no value |
| `submitSteer` | unary | (object{input}) | no value |

### agentRuntimeBindingService

| method | kind | input | output |
| --- | --- | --- | --- |
| `get` | unary | () | object{workspaceId, runtimeId} |
| `set` | unary | (object{workspaceId, runtimeId}) | object{workspaceId, runtimeId} |
| `switch` | unary | (string) | object{workspaceId, runtimeId} |

### agentShellCommandService

| method | kind | input | output |
| --- | --- | --- | --- |
| `cancel` | unary | (string) | no value |
| `run` | unary | (object{command, commandId?}) | object{stdout, stderr, isError?, backgrounded?} |

### agentSkillService

| method | kind | input | output |
| --- | --- | --- | --- |
| `activate` | unary | (object{name, args?}) | object{turn_id} |
| `promptWithSkills` | unary | (object{input, promptId?, skills}) | object{turn_id?, prompt_id, created_at, state} |

### agentTaskService

| method | kind | input | output |
| --- | --- | --- | --- |
| `list` | unary | (boolean, number) | object{kind, command, pid, exitCode, taskId, description, …7 more} \| object{kind, agentId?, subagentType?, model?, thinkingEffort?, taskId, …8 more} \| object{kind, questionCount, toolCallId?, taskId, description, status, …6 more}[] |
| `readOutput` | unary | (string, number) | string |
| `stop` | unary | (string, string) | no value |
| `stopByUser` | unary | (string) | no value |

### agentTokenCountingService

| method | kind | input | output |
| --- | --- | --- | --- |
| `statusSize` | unary | () | number |

### agentUsageService

| method | kind | input | output |
| --- | --- | --- | --- |
| `status` | unary | () | object{byModel?, currentTurn?, total?} |

### authSummaryService

| method | kind | input | output |
| --- | --- | --- | --- |
| `ensureReady` | unary | (string) | no value |
| `summarize` | unary | () | object{loggedIn, provider?}[] |

### bootstrapService

| method | kind | input | output |
| --- | --- | --- | --- |
| `arch` | unary | () | string |
| `blobsDir` | unary | () | string |
| `cacheDir` | unary | () | string |
| `clientIdentity` | unary | () | object{productName, version, platform, userAgentSuffix?} |
| `configPath` | unary | () | string |
| `cwd` | unary | () | string |
| `homeDir` | unary | () | string |
| `logsDir` | unary | () | string |
| `osHomeDir` | unary | () | string |
| `platform` | unary | () | string |
| `sessionsDir` | unary | () | string |
| `storeDir` | unary | () | string |

### capabilityService

| method | kind | input | output |
| --- | --- | --- | --- |
| `getCapability` | unary | (string) | object{id, pluginId?, displayName, description, supported, state, …3 more} |
| `installCapability` | unary | (string) | object{id, pluginId?, displayName, description, supported, state, …3 more} |
| `listCapabilities` | unary | () | object{id, pluginId?, displayName, description, supported, state, …3 more}[] |

### configService

| method | kind | input | output |
| --- | --- | --- | --- |
| `diagnostics` | unary | () | object{domain?, severity, message}[] |
| `get` | unary | (string) | unknown |
| `getAll` | unary | () | object |
| `inspect` | unary | (string) | object{value?, defaultValue?, userValue?, memoryValue?} |
| `reload` | unary | () | no value |
| `replace` | unary | (string, unknown, "user" \| "memory") | no value |
| `replaceSections` | unary | (object, "user" \| "memory") | no value |
| `set` | unary | (string, unknown, "user" \| "memory") | no value |

### connectorCatalogService

| method | kind | input | output |
| --- | --- | --- | --- |
| `listConnectors` | unary | (object{cwd?, workspaceTrusted?}) | object{id, kind, name, description?, scope, status, …2 more}[] |

### fileService

| method | kind | input | output |
| --- | --- | --- | --- |
| `delete` | unary | (string) | no value |
| `get` | unary | (string) | object{meta, data} |
| `save` | unary | (string, string, object{name?, mimeType?, expiresInSec?}) | object{id, name, media_type, size, created_at, expires_at?} |

### flagService

| method | kind | input | output |
| --- | --- | --- | --- |
| `enabled` | unary | (string) | boolean |
| `enabledIds` | unary | () | string[] |
| `explain` | unary | (string) | no value |
| `explainAll` | unary | () | object{id, title, description, surface, env, defaultEnabled, …3 more}[] |
| `snapshot` | unary | () | object |

### githubService

| method | kind | input | output |
| --- | --- | --- | --- |
| `disconnect` | unary | () | object{disconnected, providerRevoked, message} |
| `pollDeviceFlow` | unary | (string) | object{kind} \| object{kind, status} |
| `startDeviceFlow` | unary | () | object{flowId, userCode, verificationUri, verificationUriComplete?, expiresInSeconds, intervalSeconds, …1 more} |
| `status` | unary | () | object{configured, connected, accountLogin?, scopes, expiresAt?, expired, …2 more} |

### hostFolderBrowser

| method | kind | input | output |
| --- | --- | --- | --- |
| `browse` | unary | (string) | object{path, parent, entries} |
| `home` | unary | () | object{home, recent_roots} |

### mcpManagementService

| method | kind | input | output |
| --- | --- | --- | --- |
| `addServer` | unary | (object{transport, runtime_id?, command, args?, env?, inheritEnv?, …9 more} \| object{transport, url, headers?, auth?, bearerTokenEnvVar?, allowPrivateNetwork?, …7 more}, object{cwd?}) | object{name, config, source, origin, mutable, plugin?}[] |
| `beginServerAuth` | unary | (object{source, name} \| object{source, pluginId, serverName}, object{cwd?}) | object{status, flowId, authorizationUrl} \| object{status} |
| `cancelServerAuth` | unary | (object{flowId}) | no value |
| `completeServerAuth` | unary | (object{flowId, timeoutMs?}) | no value |
| `getServer` | unary | (string, object{cwd?}) | object{name, config, source, origin, mutable, plugin?} |
| `inspectServers` | unary | (object{source, name} \| object{source, pluginId, serverName}[], object{cwd?}) | object{serverId, locator, runtimeName, canonicalUrl?, origin, config, …5 more}[] |
| `listAuthStatuses` | unary | (object{cwd?, verify?}) | object{name, authStatus}[] |
| `listServers` | unary | (object{cwd?}) | object{name, config, source, origin, mutable, plugin?}[] |
| `removeServer` | unary | (string, object{cwd?}) | object{name, config, source, origin, mutable, plugin?}[] |
| `resetServerAuth` | unary | (object{source, name} \| object{source, pluginId, serverName}, object{cwd?}) | no value |
| `resolveServerByName` | unary | (string, object{cwd?}) | object{source, name} \| object{source, pluginId, serverName} |
| `testServer` | unary | (object{name?, server?, cwd?}) | object{success, output} |
| `updateServer` | unary | (object{transport, runtime_id?, command, args?, env?, inheritEnv?, …9 more} \| object{transport, url, headers?, auth?, bearerTokenEnvVar?, allowPrivateNetwork?, …7 more}, object{cwd?}) | object{name, config, source, origin, mutable, plugin?}[] |

### modelResolver

| method | kind | input | output |
| --- | --- | --- | --- |
| `generate` | streaming | (string, object{systemPrompt, messages, tools?, responseFormat?}, object{cacheKey?, temperature?, topP?, thinkingEffort?, maxCompletionTokens?}) | chunk: object{type} |
| `getProvider` | unary | (string) | object{id, type, base_url?, default_model?, api_key_env?, has_api_key, …2 more} |
| `listModels` | unary | () | object{provider, model, display_name?, max_context_size, capabilities?, support_efforts?, …1 more}[] |
| `listProviders` | unary | () | object{id, type, base_url?, default_model?, api_key_env?, has_api_key, …2 more}[] |
| `setDefaultModel` | unary | (string) | object{default_model, model} |

### modelService

| method | kind | input | output |
| --- | --- | --- | --- |
| `delete` | unary | (string) | no value |
| `get` | unary | (string) | no value |
| `list` | unary | () | object |
| `set` | unary | (string, object{providerId?, baseUrl?, apiKey?, oauth?, protocol?, name?, …14 more}) | no value |

### modelsDevImport

| method | kind | input | output |
| --- | --- | --- | --- |
| `importCustomRegistry` | unary | (object{url, apiKey?, setDefaultWhenUnset?}) | object{providers, modelsImported, credentialEnv} |

### oauthService

| method | kind | input | output |
| --- | --- | --- | --- |
| `cancelLogin` | unary | (string) | object{cancelled, status} |
| `getFlow` | unary | (string) | no value |
| `logout` | unary | (string) | object{logged_out, provider} |
| `refreshOAuthProviderModels` | unary | () | object{changed, unchanged, failed} |
| `startLogin` | unary | (string, object{region?}) | object{flow_id, provider, status, verification_uri, verification_uri_complete, user_code, …3 more} \| object{flow_id, provider, status} |
| `status` | unary | (string) | object{loggedIn, provider?} |

### pluginService

| method | kind | input | output |
| --- | --- | --- | --- |
| `checkUpdates` | unary | () | object{id, source, current?, latest, displayVersion, updateAvailable}[] |
| `getPluginInfo` | unary | (object{id}) | object{id, displayName, version?, enabled, state, skillCount, …17 more} |
| `installPlugin` | unary | (object{source}) | object{id, displayName, version?, enabled, state, skillCount, …8 more} |
| `listPluginCommands` | unary | () | object{pluginId, name, description, body, path}[] |
| `listPlugins` | unary | () | object{id, displayName, version?, enabled, state, skillCount, …8 more}[] |
| `reloadPlugins` | unary | () | object{added, removed, errors} |
| `removePlugin` | unary | (object{id}) | no value |
| `setPluginEnabled` | unary | (object{id, enabled}) | no value |
| `setPluginMcpServerEnabled` | unary | (object{id, server, enabled}) | no value |

### providerDiscovery

| method | kind | input | output |
| --- | --- | --- | --- |
| `refreshProviderModels` | unary | (object{scope?, providerId?}) | object{changed, unchanged, failed} |

### providerService

| method | kind | input | output |
| --- | --- | --- | --- |
| `delete` | unary | (string) | no value |
| `get` | unary | (string) | no value |
| `list` | unary | () | object |
| `set` | unary | (string, object{modelSource?, baseUrl?, customHeaders?, defaultModel?, type?, apiKey?, …5 more}) | no value |

### sessionActivityView

| method | kind | input | output |
| --- | --- | --- | --- |
| `state` | unary | () | object{busy, mainTurnActive, pendingInteraction, lastTurnReason?} |

### sessionApprovalService

| method | kind | input | output |
| --- | --- | --- | --- |
| `decide` | unary | (string, object{decision, scope?, feedback?, selectedLabel?}) | no value |
| `listPending` | unary | () | object{id?, sessionId?, agentId?, turnId?, toolCallId?, toolName, …2 more}[] |

### sessionIndex

| method | kind | input | output |
| --- | --- | --- | --- |
| `count` | unary | (object{workspaceIds?, includeArchived?}) | number |
| `get` | unary | (string) | no value |
| `listRecent` | unary | (object{workspaceIds?, sessionId?, includeArchived?, limit?, childOf?, before?, …1 more}) | object{items, nextCursor?} |

### sessionInteractionService

| method | kind | input | output |
| --- | --- | --- | --- |
| `isRecentlyResolved` | unary | (string) | boolean |
| `listPending` | unary | ("approval" \| "question" \| "user_tool") | object{id, kind, payload, tags, createdAt}[] |
| `respond` | unary | (string, unknown) | no value |

### sessionManager

| method | kind | input | output |
| --- | --- | --- | --- |
| `archive` | unary | (string) | no value |
| `close` | unary | (string) | no value |
| `create` | unary | (object{sessionId?, workDir, additionalDirs?, mcpServers?}) | object{id, kind} |
| `createChild` | unary | (object{sourceSessionId, newSessionId?, title?, metadata?}) | object{id, version?, title?, titleKind?, lastPrompt?, createdAt, …8 more} |
| `delete` | unary | (string) | no value |
| `fork` | unary | (object{sourceSessionId, newSessionId?, title?, metadata?, turnIndex?}) | object{id, version?, title?, titleKind?, lastPrompt?, createdAt, …8 more} |
| `restore` | unary | (string, object{additionalDirs?, mcpServers?}) | no value |
| `resume` | unary | (string, object{additionalDirs?, mcpServers?}) | no value |

### sessionMetadata

| method | kind | input | output |
| --- | --- | --- | --- |
| `read` | unary | () | object{id, version?, title?, titleKind?, lastPrompt?, createdAt, …8 more} |
| `registerAgent` | unary | (string, object{homedir?, type?, parentAgentId?, forkedFrom?, labels?, swarmItem?}) | no value |
| `setArchived` | unary | (boolean) | no value |
| `setTitle` | unary | (string) | no value |
| `update` | unary | (object{version?, title?, titleKind?, lastPrompt?, updatedAt?, archived?, …6 more}) | no value |

### sessionQuestionService

| method | kind | input | output |
| --- | --- | --- | --- |
| `answer` | unary | (string, null \| object \| object{answers, method?}) | no value |
| `dismiss` | unary | (string) | no value |
| `listPending` | unary | () | object{id?, turnId?, toolCallId?, questions}[] |

### sessionSkillCatalog

| method | kind | input | output |
| --- | --- | --- | --- |
| `list` | unary | () | object{name, description, path, source, type?, disableModelInvocation?, …2 more}[] |

### sessionTitleService

| method | kind | input | output |
| --- | --- | --- | --- |
| `generateTitle` | unary | (object{force?, source?}) | no value |

### vercelService

| method | kind | input | output |
| --- | --- | --- | --- |
| `connect` | unary | (string) | object{connected, status, message} |
| `disconnect` | unary | () | object{disconnected, message} |
| `status` | unary | () | object{configured, connected, accountId?, accountType?, accountSlug?, accountName?, …4 more} |

### workspaceService

| method | kind | input | output |
| --- | --- | --- | --- |
| `createOrTouch` | unary | (string, string) | object{id, root, name, createdAt, lastOpenedAt} |
| `delete` | unary | (string) | no value |
| `get` | unary | (string) | no value |
| `list` | unary | () | object{id, root, name, createdAt, lastOpenedAt}[] |
| `update` | unary | (string, object{name?}) | no value |

## Events

### global

| event | kind | source | payload |
| --- | --- | --- | --- |
| `config.changed` | emitter | service `configService` | object{domain, source, value, previousValue} |
| `config.sectionChanged` | emitter | service `configService` | object{domain, source, value, previousValue} |
| `kosong.changed` | bus | type `event.model_catalog.changed` | object{changed, unchanged, failed} |
| `kosong.models.changed` | emitter | service `modelService` | object{added, removed, changed} |
| `kosong.providers.changed` | emitter | service `providerService` | object{added, removed, changed} |
| `plugins.reloaded` | emitter | service `pluginService` | object{added, removed, errors} |
| `session.archived` | bus | type `event.session.archived` | object{sessionId} |
| `session.metaUpdated` | bus | type `session.meta.updated` | object{agentId, sessionId, title?, patch} |

### session

| event | kind | source | payload |
| --- | --- | --- | --- |
| `interactions.changed` | stream | name `interactions` | object{id, kind, payload, tags, createdAt}[] |
| `interactions.resolved` | stream | name `interactions:resolved` | object{id, response} |
| `metadata.changed` | emitter | service `sessionMetadata` | object{changed} |
| `skills.changed` | emitter | service `sessionSkillCatalog` | string |

### agent

| event | kind | source | payload |
| --- | --- | --- | --- |
| `agent.status.updated` | stream | type `agent.status.updated` | object{time?, phase?} |
| `assistant.delta` | stream | type `assistant.delta` | object{type, time?, turnId, delta} |
| `compaction.blocked` | stream | type `compaction.blocked` | object{type, time?, turnId?} |
| `compaction.cancelled` | stream | type `compaction.cancelled` | object{type, time?} |
| `compaction.completed` | stream | type `compaction.completed` | object{type, time?, result} |
| `compaction.started` | stream | type `compaction.started` | object{type, time?, trigger, instruction?} |
| `error` | stream | type `error` | object{time?, message} |
| `permission.approval.requested` | stream | type `permission.approval.requested` | object{time?, turnId, toolCallId, toolName, action} |
| `permission.approval.resolved` | stream | type `permission.approval.resolved` | object{time?, turnId, toolCallId} |
| `prompt.aborted` | stream | type `prompt.aborted` | object{type, time?, promptId, abortedAt} |
| `prompt.completed` | stream | type `prompt.completed` | object{type, time?, promptId, finishedAt, reason?} |
| `thinking.delta` | stream | type `thinking.delta` | object{type, time?, turnId, delta} |
| `tool.call.delta` | stream | type `tool.call.delta` | object{type, time?, turnId, toolCallId, name?, argumentsPart?} |
| `tool.call.started` | stream | type `tool.call.started` | object{type, time?, turnId, toolCallId, name, args, …2 more} |
| `tool.progress` | stream | type `tool.progress` | object{type, time?, turnId, toolCallId, update} |
| `tool.result` | stream | type `tool.result` | object{type, time?, turnId, toolCallId, output, isError?, …1 more} |
| `turn.ended` | stream | type `turn.ended` | object{type, time?, turnId, reason, error?, durationMs?, …2 more} |
| `turn.started` | stream | type `turn.started` | object{type, time?, turnId, origin, prompt?, promptId?} |
| `warning` | stream | type `warning` | object{type, time?, message, code?} |
