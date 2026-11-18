# Migrating from V3 to V4

Omnicode V4 introduces a composable provider architecture. In V3, a provider was a single opaque unit: one API protocol, one authentication method, and one model list. In V4, a provider is composed from three independent parts — an API adapter, an auth strategy, and a model definition — which can be mixed and matched freely.

This page explains how existing V3 provider configurations keep working in V4, what changes you may see, and how to update deprecated settings.

## What changes in V4

- **Authentication is separate from the API protocol.** A provider can use any API adapter with any auth strategy, including combinations that were not possible before.
- **Credentials are stored separately from provider definitions.** Raw secrets are no longer written inline into provider configuration files.
- **Model discovery is provider-independent.** Discovery runs through a shared pipeline that normalizes and validates results from any API adapter.
- **A new `omnicode auth` command** manages authentication state for providers that support it.

Existing V3 providers continue to work without any action from you. Your configuration is read, converted to the V4 format automatically, and saved on next startup.

## Automatic migration

When you first run V4, the CLI detects any V3 provider configuration and migrates it in place. You will see a notice like this:

```text
Warning:
This configuration uses the V3 authentication format.
It will be migrated to the V4 authentication system.
```

Migration is automatic and safe. It never deletes your old configuration; it writes a new V4 configuration alongside it. You can inspect the result with `omnicode provider list` and roll back by restoring the previous file if needed.

## What gets migrated

| V3 setting | V4 equivalent |
| --- | --- |
| `providers.<id>.api_key` | `providers.<id>.auth.type = "api-key"` with a credential reference |
| `providers.<id>.base_url` | `providers.<id>.api.baseUrl` |
| `providers.<id>.protocol` | `providers.<id>.api.adapter` |
| `providers.<id>.models` | `providers.<id>.models.override` |
| `providers.<id>.env` | `providers.<id>.auth.credential` (environment variable) |

## Manual providers

`omnicode provider add-manual` continues to work in V4. The interactive questions now cover the new architecture:

```text
Provider ID: my-gateway
Name: My Gateway
Base URL: https://example.com/v1
Protocol: OpenAI
Authentication: API Key
Credential: Environment Variable
Model Discovery: Enabled
```

## Deprecated fields

The following V3 fields are deprecated in V4 and will be removed in a future major release. They still work, but new configurations should use the V4 equivalents.

- `providers.<id>.api_key` — use `providers.<id>.auth` instead
- `providers.<id>.api_key_env` — use `providers.<id>.auth.credential` instead
- `providers.<id>.protocol` — use `providers.<id>.api.adapter` instead

## Backward compatibility

All existing commands continue to work:

```sh
omnicode provider list
omnicode provider add
omnicode provider add-manual
omnicode provider add-builtin
omnicode provider edit
omnicode provider remove
```

New commands extend the existing ones rather than replacing them:

```sh
omnicode auth list
omnicode auth status
omnicode auth login <provider>
omnicode auth logout <provider>
omnicode auth refresh <provider>
omnicode provider auth <id>
omnicode provider models <id>
omnicode provider test <id>
```

## Troubleshooting

**A provider that worked in V3 fails to authenticate in V4.**
Check that your credential source is still configured. In V3 the API key was stored inline; in V4 it is resolved through environment variables, the credential store, or interactive authentication. Run `omnicode auth status <provider>` to see the current state.

**Model discovery returns no models.**
V4 discovery is best-effort. If it fails, the provider is still saved and you can configure models manually with `omnicode provider models <id>`.

**A custom header is not sent.**
Custom headers now live under `providers.<id>.api.defaultHeaders` rather than the top-level provider config.

## Next steps

- [Providers](../configuration/providers.md) — configure API adapters and auth strategies
- [Authentication](../configuration/authentication.md) — manage credentials securely
- [Configuration files](../configuration/config-files.md) — full reference for `config.toml`