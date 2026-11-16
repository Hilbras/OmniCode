import type { ImportedMcpServer, ImportedSettingValue, ImportedSettings } from './schema.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringifyValue(value: unknown): string | undefined {
  try {
    const json = JSON.stringify(value);
    return typeof json === 'string' ? json : undefined;
  } catch {
    return undefined;
  }
}

function scalarValue(value: unknown): ImportedSettingValue | undefined {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value) || isRecord(value)) return stringifyValue(value);
  return undefined;
}

export function normalizeSettings(
  input: unknown,
  excludedKeys: readonly string[] = ['mcpServers', 'mcp_servers'],
): ImportedSettings {
  const excluded = new Set(excludedKeys);
  const settings: ImportedSettings = {};

  const walk = (prefix: string, value: unknown): void => {
    if (isRecord(value)) {
      for (const key of Object.keys(value).sort()) {
        if (prefix === '' && excluded.has(key)) continue;
        const childKey = prefix === '' ? key : `${prefix}.${key}`;
        walk(childKey, value[key]);
      }
      return;
    }
    if (prefix === '') return;
    const scalar = scalarValue(value);
    if (scalar !== undefined) settings[prefix] = scalar;
  };

  walk('', input);
  return settings;
}

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map((item) => asString(item))
    .filter((item): item is string => item !== undefined);
  return items.length === value.length ? items : undefined;
}

export interface NormalizedMcpServers {
  readonly servers: Record<string, ImportedMcpServer>;
  readonly skipped: readonly string[];
}

export function normalizeMcpServers(input: unknown, sourcePath: string): NormalizedMcpServers {
  const servers: Record<string, ImportedMcpServer> = {};
  const skipped: string[] = [];
  if (!isRecord(input)) return { servers, skipped };

  for (const name of Object.keys(input).sort()) {
    const raw = input[name];
    if (!isRecord(raw)) {
      skipped.push(name);
      continue;
    }

    const server: ImportedMcpServer = { sourcePath };
    const command = asString(raw['command']);
    if (command !== undefined) server.command = command;
    const args = asStringArray(raw['args']);
    if (args !== undefined) server.args = args;
    const url = asString(raw['url']);
    if (url !== undefined) server.url = url;

    const env = raw['env'];
    if (isRecord(env)) {
      const entries: Record<string, string> = {};
      for (const key of Object.keys(env).sort()) {
        const value = asString(env[key]);
        if (value !== undefined) entries[key] = value;
      }
      if (Object.keys(entries).length > 0) server.env = entries;
    }

    servers[name] = server;
  }

  return { servers, skipped };
}
