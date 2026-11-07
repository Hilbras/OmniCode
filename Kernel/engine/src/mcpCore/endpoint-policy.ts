export type McpEndpointCheck =
  | { readonly ok: true; readonly url: URL }
  | { readonly ok: false; readonly reason: string };

const ALLOWED_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:']);

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function isIpv4Literal(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

function isPrivateIpv4(hostname: string): boolean {
  if (!isIpv4Literal(hostname)) return false;
  const parts = hostname.split('.').map((part) => Number.parseInt(part, 10));
  const a = parts[0];
  const b = parts[1];
  if (a === undefined || b === undefined) return false;
  if (a === 127) return false;
  if (a === 10) return true;
  if (a === 172) return b >= 16 && b <= 31;
  if (a === 192) return b === 168;
  if (a === 169) return b === 254;
  if (a === 100) return b >= 64 && b <= 127;
  return false;
}

function isPrivateIpv6(hostname: string): boolean {
  const host =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  const lower = host.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  const head = lower.split(':')[0] ?? '';
  if (head === '') return false;
  const group = Number.parseInt(head, 16);
  if (Number.isNaN(group)) return false;
  if ((group & 0xfe00) === 0xfc00) return true;
  return (group & 0xffc0) === 0xfe80;
}

export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (LOOPBACK_HOSTNAMES.has(host)) return true;
  return host.endsWith('.localhost');
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (isLoopbackHost(host)) return false;
  if (isPrivateIpv4(host)) return true;
  return isPrivateIpv6(host);
}

export interface McpEndpointOptions {
  readonly allowPrivateNetwork?: boolean;
}

export function checkMcpEndpoint(raw: string, options: McpEndpointOptions = {}): McpEndpointCheck {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: 'the endpoint URL cannot be empty.' };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'the endpoint URL is not a valid URL.' };
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    return {
      ok: false,
      reason: `the endpoint scheme "${parsed.protocol}" is not supported; use "https:" (or "http:" for a loopback server).`,
    };
  }

  const hostname = parsed.hostname;
  if (hostname.length === 0) {
    return { ok: false, reason: 'the endpoint URL has no host.' };
  }

  if (parsed.protocol === 'http:' && !isLoopbackHost(hostname)) {
    return {
      ok: false,
      reason:
        'plain "http:" is only allowed for a loopback server; use "https:" for remote servers.',
    };
  }

  if (options.allowPrivateNetwork !== true && isPrivateHost(hostname)) {
    return {
      ok: false,
      reason: `the endpoint host "${hostname}" is a private or link-local address; set "allowPrivateNetwork" on the server to allow it deliberately.`,
    };
  }

  return { ok: true, url: parsed };
}
