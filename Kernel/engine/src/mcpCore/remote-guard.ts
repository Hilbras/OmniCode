import { ErrorCodes, Error2 } from '#/errors';

import { checkMcpEndpoint, type McpEndpointOptions } from './endpoint-policy';

export function assertMcpEndpointAllowed(raw: string, options: McpEndpointOptions = {}): URL {
  const check = checkMcpEndpoint(raw, options);
  if (!check.ok) {
    throw new Error2(ErrorCodes.CONFIG_INVALID, `MCP endpoint rejected: ${check.reason}`);
  }
  return check.url;
}

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([301, 302, 303, 307, 308]);

export function createMcpRedirectGuardFetch(
  baseUrl: URL,
  fetchFn: typeof fetch | undefined,
): typeof fetch {
  const base = fetchFn ?? ((input, init) => globalThis.fetch(input, init));
  return async (input, init) => {
    const response = await base(input, { ...init, redirect: 'manual' });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get('location');
    if (location === null) return response;
    let target: URL;
    try {
      target = new URL(location, baseUrl);
    } catch {
      throw new Error2(
        ErrorCodes.CONFIG_INVALID,
        'The MCP server returned a redirect to an invalid URL.',
      );
    }
    if (target.origin !== baseUrl.origin) {
      throw new Error2(
        ErrorCodes.CONFIG_INVALID,
        `The MCP server redirected to a different origin ("${target.origin}"); refusing to send credentials there.`,
      );
    }
    return base(target, { ...init, redirect: 'manual' });
  };
}
