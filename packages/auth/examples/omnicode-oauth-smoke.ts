import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applyManagedOmnicodeCodeConfig,
  OMNICODE_PROVIDER_NAME,
  OmnicodeOAuthToolkit,
  type DeviceAuthorization,
  type OmnicodeHostIdentity,
  type ManagedOmnicodeConfigShape,
} from '@hilbras/omnicode-auth';

async function main(): Promise<void> {
  const explicitHomeDir = process.env['OMNICODE_OAUTH_SMOKE_HOME'];
  const homeDir = explicitHomeDir ?? (await mkdtemp(join(tmpdir(), 'omnicode-oauth-smoke-')));
  const keepToken = shouldKeepToken(explicitHomeDir !== undefined);
  const forceLogin = process.env['OMNICODE_OAUTH_SMOKE_FORCE_LOGIN'] === '1';
  const config: ManagedOmnicodeConfigShape = { providers: {} };

  const toolkit = new OmnicodeOAuthToolkit<ManagedOmnicodeConfigShape>({
    homeDir,
    identity: smokeIdentityFromEnv(),
    configAdapter: {
      read: () => config,
      write: () => {},
      apply: applyManagedOmnicodeCodeConfig,
      configPath: '<memory>',
    },
  });

  process.stdout.write(`home: ${homeDir}\n`);

  try {
    if (forceLogin) {
      await toolkit.logout(OMNICODE_PROVIDER_NAME);
      process.stdout.write('cleared existing smoke token\n');
    }

    const login = await toolkit.login(OMNICODE_PROVIDER_NAME, {
      onDeviceCode: printDeviceCode,
    });
    const status = await toolkit.status(OMNICODE_PROVIDER_NAME);
    const accessToken = await toolkit.tokenProvider(OMNICODE_PROVIDER_NAME).getAccessToken();
    const usage = await toolkit.getManagedUsage(OMNICODE_PROVIDER_NAME);

    if (login.provision?.defaultModel === undefined) {
      throw new Error('login did not provision a default model');
    }
    if (status.providers[0]?.hasToken !== true) {
      throw new Error('status did not report a stored token after login');
    }
    if (accessToken.length === 0) {
      throw new Error('token provider returned an empty access token');
    }
    if (config.providers[OMNICODE_PROVIDER_NAME] === undefined) {
      throw new Error('managed provider was not written to config');
    }

    process.stdout.write(`provider: ${login.providerName}\n`);
    process.stdout.write(`default model: ${login.provision.defaultModel}\n`);
    process.stdout.write(`models: ${String(login.provision.models.length)}\n`);
    printUsage(usage);
    process.stdout.write('oauth smoke passed\n');
  } finally {
    if (!keepToken) {
      await toolkit.logout(OMNICODE_PROVIDER_NAME).catch(() => {});
    }
    if (explicitHomeDir === undefined && !keepToken) {
      await rm(homeDir, { recursive: true, force: true });
    }
  }
}

function smokeIdentityFromEnv(): OmnicodeHostIdentity {
  const version = process.env['OMNICODE_SMOKE_VERSION'];
  if (version === undefined || version.trim().length === 0) {
    throw new Error('OMNICODE_SMOKE_VERSION is required for Omnicode OAuth smoke.');
  }
  return {
    productName: "omnicode-cli",
    version,
    platform: "omnicode_code_cli",
  };
}

function printDeviceCode(auth: DeviceAuthorization): void {
  process.stdout.write(
    [
      'Complete Omnicode OAuth device login:',
      `  URL: ${auth.verificationUriComplete || auth.verificationUri}`,
      `  Code: ${auth.userCode}`,
      auth.expiresIn === null ? undefined : `  Expires in: ${String(auth.expiresIn)}s`,
      '',
    ]
      .filter((line): line is string => line !== undefined)
      .join('\n'),
  );
}

function printUsage(
  result: Awaited<ReturnType<OmnicodeOAuthToolkit<ManagedOmnicodeConfigShape>['getManagedUsage']>>,
): void {
  if (result.kind === 'error') {
    process.stderr.write(`quota request returned: ${result.message}\n`);
    return;
  }
  const { usages } = result.quota;
  const parts: string[] = [];
  for (const [key, entry] of Object.entries(usages)) {
    if (entry === undefined) continue;
    parts.push(`${key} ${String(Math.round(entry.usedRatio * 100))}%`);
  }
  process.stdout.write(`quota: ${parts.join(', ')}\n`);
}

function shouldKeepToken(hasExplicitHomeDir: boolean): boolean {
  const value = process.env['OMNICODE_OAUTH_SMOKE_KEEP_TOKEN'];
  if (value !== undefined) return value === '1' || value === 'true';
  return hasExplicitHomeDir;
}

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
