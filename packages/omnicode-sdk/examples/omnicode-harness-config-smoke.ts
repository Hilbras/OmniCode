import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createOmnicodeHarness } from '@hilbras/omnicode-sdk';

import { smokeIdentityFromEnv } from './runtime-smoke-helpers';

async function main(): Promise<void> {
  const homeDir = await mkdtemp(join(tmpdir(), 'omnicode-harness-config-home-'));
  const harness = createOmnicodeHarness({ homeDir, identity: smokeIdentityFromEnv() });

  const initial = await harness.getConfig();
  if (Object.keys(initial.providers).length > 0) {
    throw new Error('expected empty providers for a fresh config home');
  }

  await harness.setConfig({
    defaultModel: 'omnicode/omnicode-for-coding',
    thinking: { enabled: true },
    defaultPermissionMode: 'manual',
    defaultPlanMode: false,
    providers: {
      'managed:omnicode': {
        type: 'omnicode',
        baseUrl: 'https://api.omnicode.com/coding/v1',
        apiKey: '',
        oauth: { storage: 'file', key: 'oauth/omnicode' },
      },
    },
    models: {
      'omnicode/omnicode-for-coding': {
        provider: 'managed:omnicode',
        model: 'omnicode-for-coding',
        maxContextSize: 262144,
        capabilities: ['image_in', 'thinking', 'video_in'],
        displayName: 'Omnicode for Coding',
      },
    },
    loopControl: {
      maxRetriesPerStep: 3,
      maxRalphIterations: 0,
      reservedContextSize: 50000,
      compactionTriggerRatio: 0.85,
    },
    services: {
      hilbrasSearch: {
        baseUrl: 'https://api.omnicode.com/coding/v1/search',
        apiKey: '',
        oauth: { storage: 'file', key: 'oauth/omnicode' },
      },
      hilbrasFetch: {
        baseUrl: 'https://api.omnicode.com/coding/v1/fetch',
        apiKey: '',
        oauth: { storage: 'file', key: 'oauth/omnicode' },
      },
    },
  });

  const configPath = join(homeDir, 'config.toml');
  const text = await readFile(configPath, 'utf-8');
  for (const expected of [
    'default_model = "omnicode/omnicode-for-coding"',
    'default_permission_mode = "manual"',
    '[providers."managed:omnicode"]',
    '[providers."managed:omnicode".oauth]',
    '[models."omnicode/omnicode-for-coding"]',
    '[services.hilbras_search]',
  ]) {
    if (!text.includes(expected)) {
      throw new Error(`missing ${expected} in written config`);
    }
  }

  const reloaded = await harness.getConfig({ reload: true });
  if (reloaded.defaultModel !== 'omnicode/omnicode-for-coding') {
    throw new Error('reloaded config did not preserve defaultModel');
  }
  if (reloaded.providers['managed:omnicode']?.oauth?.key !== 'oauth/omnicode') {
    throw new Error('reloaded config did not preserve provider oauth');
  }

  process.stdout.write(`config: ${configPath}\n`);
  process.stdout.write('ok\n');
}

try {
  await main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
