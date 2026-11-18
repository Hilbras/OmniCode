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
  if (a === 0) return true;
  if (a === 10) return true;
  if (a === 172) return b >= 16 && b <= 31;
  if (a === 192) return b === 168;
  if (a === 169) return b === 254;
  if (a === 100) return b >= 64 && b <= 127;
  return false;
}

function ipv6Words(hostname: string): number[] | undefined {
  let value = hostname.toLowerCase();
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  const zone = value.indexOf('%');
  if (zone !== -1) value = value.slice(0, zone);
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    if (lastColon === -1) return undefined;
    const octets = value
      .slice(lastColon + 1)
      .split('.')
      .map((part) => Number.parseInt(part, 10));
    if (
      octets.length !== 4 ||
      octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
    ) {
      return undefined;
    }
    const high = ((octets[0]! << 8) | octets[1]!).toString(16);
    const low = ((octets[2]! << 8) | octets[3]!).toString(16);
    value = `${value.slice(0, lastColon + 1)}${high}:${low}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] === undefined || halves[0] === '' ? [] : halves[0].split(':');
  const tail =
    halves.length === 2 ? (halves[1] === undefined || halves[1] === '' ? [] : halves[1].split(':')) : [];
  if (halves.length === 2 && 8 - head.length - tail.length < 1) return undefined;
  if (halves.length === 1 && head.length !== 8) return undefined;
  const missing = Math.max(8 - head.length - tail.length, 0);
  const words = [...head, ...Array<string>(missing).fill('0'), ...tail].map((part) =>
    Number.parseInt(part, 16),
  );
  if (words.length !== 8) return undefined;
  if (words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffff)) return undefined;
  return words;
}

function isPrivateIpv6(hostname: string): boolean {
  const words = ipv6Words(hostname);
  if (words === undefined) return false;
  if (words.every((word) => word === 0)) return true;
  const isLoopback = words.slice(0, 7).every((word) => word === 0) && words[7] === 1;
  if (isLoopback) return false;
  const mapped =
    words[0] === 0 &&
    words[1] === 0 &&
    words[2] === 0 &&
    words[3] === 0 &&
    words[4] === 0 &&
    words[5] === 0xffff;
  if (mapped) {
    const a = (words[6]! >> 8) & 0xff;
    const b = words[6]! & 0xff;
    const c = (words[7]! >> 8) & 0xff;
    const d = words[7]! & 0xff;
    if (a === 127) return false;
    return isPrivateIpv4(`${String(a)}.${String(b)}.${String(c)}.${String(d)}`);
  }
  const first = words[0]!;
  if ((first & 0xfe00) === 0xfc00) return true;
  return (first & 0xffc0) === 0xfe80;
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
