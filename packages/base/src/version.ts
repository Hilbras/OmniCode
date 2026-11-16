import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export function getCoreVersion(): string {
  try {
    const manifest = require('../package.json') as { version?: unknown };
    return typeof manifest.version === 'string' && manifest.version.length > 0
      ? manifest.version
      : '0.0.0';
  } catch {
    return '0.0.0';
  }
}
