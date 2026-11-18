import { connect, isIP } from 'node:net';
import { createServer as createHttpServer, request as httpRequest, type Server } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { TLSSocket, createSecureContext, rootCertificates } from 'node:tls';

import { z } from 'zod';

import { Disposable, toDisposable } from '@hilbras/omnicode-base/di/lifecycle';
import { createDecorator } from '@hilbras/omnicode-base/di/instantiation';
import { ILogService, type ILogger } from '@hilbras/omnicode-base/log/log';
import { LifecycleScope } from '#/app/scopes';
import { ScopeActivation, registerScopedService } from '@hilbras/omnicode-base/di/scope';
import { registerConfigSection } from '#/app/config/configSectionContributions';
import { IConfigService } from '#/app/config/config';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { isLoopbackHost, isPrivateHost } from '#/mcpCore/endpoint-policy';

import { ensureCertAuthority, issueLeaf, type CertAuthority } from './certAuthority';

export const EGRESS_SECTION = 'egress';

const credentialSchema = z
  .object({
    host: z.string().min(1),
    header: z.string().min(1).optional(),
    valueEnv: z.string().min(1).optional(),
    value: z.string().optional(),
    placeholder: z.string().min(1).optional(),
  })
  .strict();

export const EgressConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    allow: z.array(z.string().min(1)).optional(),
    allowPrivate: z.boolean().optional(),
    /** Terminate TLS for hosts with credentials and substitute the header. */
    mitm: z.boolean().optional(),
    credentials: z.record(z.string(), credentialSchema).optional(),
  })
  .strict();

export type EgressConfig = z.infer<typeof EgressConfigSchema>;

registerConfigSection(EGRESS_SECTION, EgressConfigSchema);

export interface EgressRule {
  readonly host: string;
  readonly port?: number;
  readonly wildcard: boolean;
}

interface ResolvedCredential {
  readonly header: string;
  readonly valueEnv?: string;
  readonly value?: string;
  readonly placeholder: string;
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
  return [value.slice(0, index), value.slice(index + 1)];
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

let proxyEnv: Record<string, string> = {};

export function egressProxyEnv(): Record<string, string> {
  return { ...proxyEnv };
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
  private readonly mitm: boolean;
  private readonly credentials: ReadonlyMap<string, ResolvedCredential>;
  private readonly bootstrap: IBootstrapService;
  private server: Server | undefined;
  private mitmServer: Server | undefined;
  private listening: string | undefined;
  private ca: CertAuthority | undefined;
  private readonly leaves = new Map<string, { key: string; cert: string }>();
  private readonly hosts = new WeakMap<import('node:stream').Duplex, { host: string; port: number }>();
  private readonly starting: Promise<void>;

  constructor(
    @IConfigService config: IConfigService,
    @ILogService log: ILogService,
    @IBootstrapService bootstrap: IBootstrapService,
  ) {
    super();
    this.log = log.child({ egress: 'proxy' });
    this.bootstrap = bootstrap;
    const section = config.get<EgressConfig | undefined>(EGRESS_SECTION);
    this.rules = (section?.allow ?? [])
      .map(parseEgressRule)
      .filter((rule): rule is EgressRule => rule !== undefined);
    this.allowPrivate = section?.allowPrivate === true;
    this.mitm = section?.mitm === true;
    this.credentials = new Map(
      Object.values(section?.credentials ?? {}).map((credential) => [
        credential.host.toLowerCase(),
        {
          header: (credential.header ?? 'authorization').toLowerCase(),
          valueEnv: credential.valueEnv,
          value: credential.value,
          placeholder: credential.placeholder ?? 'omnicode-broker',
        },
      ]),
    );
    this.starting = section?.enabled === true ? this.start() : Promise.resolve();
  }

  get url(): string | undefined {
    return this.listening;
  }

  async ready(): Promise<void> {
    await this.starting;
  }

  private async start(): Promise<void> {
    if (this.rules.length === 0) {
      this.log.info('egress proxy not started', { reason: 'the allow list is empty' });
      return;
    }
    if (this.mitm && this.credentials.size > 0) {
      this.ca = await ensureCertAuthority(this.bootstrap.homeDir);
      this.mitmServer = createHttpServer((req, res) => this.forwardMitm(req, res));
    }
    const server = createHttpServer((req, res) => this.forward(req, res));
    server.on('connect', (req, socket, head) => this.tunnel(req.url ?? '', socket, head));
    this._register({ dispose: () => server.close() });
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
    proxyEnv = this.environment();
    this._register(
      toDisposable(() => {
        proxyEnv = {};
      }),
    );
    server.unref();
    this.log.info('egress proxy listening', {
      port: address.port,
      rules: this.rules.length,
      mitm: this.ca !== undefined,
    });
  }

  private environment(): Record<string, string> {
    const environment: Record<string, string> = {
      HTTP_PROXY: this.listening as string,
      HTTPS_PROXY: this.listening as string,
      ALL_PROXY: this.listening as string,
      NO_PROXY: 'localhost,127.0.0.1,::1',
    };
    if (this.ca !== undefined) {
      environment['NODE_EXTRA_CA_CERTS'] = this.ca.certPath;
      environment['SSL_CERT_FILE'] = this.ca.certPath;
      environment['CURL_CA_BUNDLE'] = this.ca.certPath;
      environment['GIT_SSL_CAINFO'] = this.ca.certPath;
      environment['REQUESTS_CA_BUNDLE'] = this.ca.certPath;
    }
    for (const credential of this.credentials.values()) {
      if (credential.valueEnv !== undefined) {
        environment[credential.valueEnv] = credential.placeholder;
      }
    }
    return environment;
  }

  private forward(
    req: { url?: string; method?: string; headers: Record<string, unknown> },
    res: import('node:http').ServerResponse,
  ): void {
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
    const credential = this.credentials.get(target.hostname.toLowerCase());
    const headers = { ...req.headers } as import('node:http').OutgoingHttpHeaders;
    if (credential !== undefined) this.inject(headers, credential);
    const upstream = httpRequest(
      {
        host: target.hostname,
        port,
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers,
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
    if (this.mitmServer !== undefined && this.credentials.has(host)) {
      this.intercept(host, port, socket, head);
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

  private intercept(host: string, port: number, socket: import('node:stream').Duplex, head: Buffer): void {
    const leaf = this.leafFor(host);
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    if (head.length > 0) socket.unshift(head);
    const tls = new TLSSocket(socket, {
      isServer: true,
      secureContext: createSecureContext({ key: leaf.key, cert: leaf.cert }),
    });
    this.hosts.set(tls, { host, port });
    tls.on('error', () => socket.destroy());
    this.mitmServer?.emit('connection', tls);
  }

  private forwardMitm(
    req: import('node:http').IncomingMessage,
    res: import('node:http').ServerResponse,
  ): void {
    const target = this.hosts.get(req.socket);
    if (target === undefined) {
      res.writeHead(502).end();
      return;
    }
    const credential = this.credentials.get(target.host);
    if (credential === undefined) {
      res.writeHead(502).end();
      return;
    }
    const headers = { ...req.headers } as import('node:http').OutgoingHttpHeaders;
    this.inject(headers, credential);
    const upstream = httpsRequest(
      {
        host: target.host,
        port: target.port,
        method: req.method,
        path: req.url,
        headers,
        servername: isIP(target.host) === 0 ? target.host : undefined,
        ca: this.ca === undefined ? undefined : [...rootCertificates, this.ca.certPem],
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.on('error', () => res.writeHead(502).end());
    req.pipe(upstream);
  }

  private allowed(host: string, port: number): boolean {
    return isEgressAllowed(host, port, this.rules, this.allowPrivate);
  }

  private inject(headers: import('node:http').OutgoingHttpHeaders, credential: ResolvedCredential): void {
    const real =
      credential.valueEnv === undefined ? credential.value : process.env[credential.valueEnv];
    if (real === undefined || real.length === 0) return;
    headers[credential.header] = real;
  }

  private leafFor(host: string): { key: string; cert: string } {
    const cached = this.leaves.get(host);
    if (cached !== undefined) return cached;
    if (this.ca === undefined) throw new Error('egress CA is not initialised');
    const leaf = issueLeaf(this.ca, host);
    const value = { key: leaf.keyPem, cert: leaf.certPem };
    this.leaves.set(host, value);
    return value;
  }
}

registerScopedService(
  LifecycleScope.App,
  IEgressProxyService,
  EgressProxyService,
  ScopeActivation.OnScopeCreated,
  'egressProxy',
);
