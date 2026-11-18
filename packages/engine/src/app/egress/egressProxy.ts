import { connect } from 'node:net';
import { createServer, request as httpRequest, type Server } from 'node:http';

import { z } from 'zod';

import { Disposable, toDisposable } from '@hilbras/omnicode-base/di/lifecycle';
import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { ILogService, type ILogger } from '@hilbras/omnicode-base/log/log';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { registerConfigSection } from '#/app/config/configSectionContributions';
import { IConfigService } from '#/app/config/config';
import { isLoopbackHost, isPrivateHost } from '#/mcpCore/endpoint-policy';

export const EGRESS_SECTION = 'egress';

export const EgressConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    /** Host or `host:port` entries; `*.example.com` matches subdomains. */
    allow: z.array(z.string().min(1)).optional(),
    /** Allow private/link-local destinations (default false). */
    allowPrivate: z.boolean().optional(),
  })
  .strict();

export type EgressConfig = z.infer<typeof EgressConfigSchema>;

registerConfigSection(EGRESS_SECTION, EgressConfigSchema);

export interface EgressRule {
  readonly host: string;
  readonly port?: number;
  readonly wildcard: boolean;
}

export function parseEgressRule(entry: string): EgressRule | undefined {
  const trimmed = entry.trim().toLowerCase();
  if (trimmed.length === 0) return undefined;
  const wildcard = trimmed.startsWith('*.');
  const body = wildcard ? trimmed.slice(2) : trimmed;
  const [host, portText] = splitHostPort(body);
  if (host.length === 0) return undefined;
  const port = portText === undefined ? undefined : Number.parseInt(portText, 10);
  if (
    portText !== undefined &&
    (port === undefined || !Number.isInteger(port) || port <= 0 || port > 65535)
  ) {
    return undefined;
  }
  return { host, port, wildcard };
}

function splitHostPort(value: string): [string, string | undefined] {
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end !== -1) {
      const host = value.slice(1, end);
      const rest = value.slice(end + 1);
      return [host, rest.startsWith(':') ? rest.slice(1) : undefined];
    }
  }
  const index = value.lastIndexOf(':');
  if (index === -1) return [value, undefined];
  const host = value.slice(0, index);
  const port = value.slice(index + 1);
  return [host, port];
}

export function isEgressAllowed(
  host: string,
  port: number,
  rules: readonly EgressRule[],
  allowPrivate: boolean,
): boolean {
  const bare = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (!allowPrivate && (isPrivateHost(bare) || isLoopbackHost(bare))) return false;
  return rules.some((rule) => {
    if (rule.port !== undefined && rule.port !== port) return false;
    if (rule.wildcard) return bare === rule.host || bare.endsWith(`.${rule.host}`);
    return bare === rule.host;
  });
}

let proxyUrl: string | undefined;

export function egressProxyEnv(): Record<string, string> {
  if (proxyUrl === undefined) return {};
  return {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    NO_PROXY: 'localhost,127.0.0.1,::1',
  };
}

export interface IEgressProxyService {
  readonly _serviceBrand: undefined;
  readonly url: string | undefined;
}

export const IEgressProxyService = createDecorator<IEgressProxyService>('egressProxyService');

export class EgressProxyService extends Disposable implements IEgressProxyService {
  declare readonly _serviceBrand: undefined;
  private readonly log: ILogger;
  private readonly rules: readonly EgressRule[];
  private readonly allowPrivate: boolean;
  private server: Server | undefined;
  private listening: string | undefined;
  private listeningPromise: Promise<void> | undefined;

  constructor(
    @IConfigService config: IConfigService,
    @ILogService log: ILogService,
  ) {
    super();
    this.log = log.child({ egress: 'proxy' });
    const section = config.get<EgressConfig | undefined>(EGRESS_SECTION);
    this.rules = (section?.allow ?? []).map(parseEgressRule).filter((rule): rule is EgressRule => rule !== undefined);
    this.allowPrivate = section?.allowPrivate === true;
    if (section?.enabled === true) this.listeningPromise = this.start();
  }

  get url(): string | undefined {
    return this.listening;
  }

  async ready(): Promise<void> {
    await this.listeningPromise;
  }

  private async start(): Promise<void> {
    if (this.rules.length === 0) {
      this.log.info('egress proxy not started', { reason: 'the allow list is empty' });
      return;
    }
    const server = createServer((req, res) => this.forward(req, res));
    server.on('connect', (req, socket, head) => this.tunnel(req.url ?? '', socket, head));
    this._register({ dispose: () => server.close() });
    this._register(
      toDisposable(() => {
        if (proxyUrl === this.listening) proxyUrl = undefined;
      }),
    );
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (address === null || typeof address === 'string') {
      server.close();
      return;
    }
    this.server = server;
    this.listening = `http://127.0.0.1:${String(address.port)}`;
    proxyUrl = this.listening;
    server.unref();
    this.log.info('egress proxy listening', { port: address.port, rules: this.rules.length });
  }

  private forward(req: { url?: string; method?: string; headers: Record<string, unknown> }, res: import('node:http').ServerResponse): void {
    let target: URL;
    try {
      target = new URL(req.url ?? '', 'http://proxy.invalid');
    } catch {
      res.writeHead(400).end();
      return;
    }
    const port = target.port === '' ? (target.protocol === 'https:' ? 443 : 80) : Number(target.port);
    if (!this.allowed(target.hostname, port)) {
      this.log.info('egress denied', { host: target.hostname });
      res.writeHead(403).end();
      return;
    }
    const upstream = httpRequest(
      {
        host: target.hostname,
        port,
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers: req.headers as import('node:http').OutgoingHttpHeaders,
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => res.writeHead(502).end());
    upstream.end();
  }

  private tunnel(target: string, socket: import('node:stream').Duplex, head: Buffer): void {
    const [host, portText] = splitHostPort(target.toLowerCase());
    const port = portText === undefined ? 443 : Number.parseInt(portText, 10);
    if (!this.allowed(host, port)) {
      this.log.info('egress denied', { host });
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    const upstream = connect(port, host, () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
  }

  private allowed(host: string, port: number): boolean {
    return isEgressAllowed(host, port, this.rules, this.allowPrivate);
  }
}

registerScopedService(
  LifecycleScope.App,
  IEgressProxyService,
  EgressProxyService,
  ScopeActivation.OnScopeCreated,
  'egressProxy',
);
