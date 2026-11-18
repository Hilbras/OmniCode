import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  redactSecrets,
  redactToolOutput,
} from '#/tool/toolResultRedaction';

const PRIVATE_KEY = [
  '-----BEGIN OPENSSH PRIVATE KEY-----',
  'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW',
  'QyNTUxOQAAACDexampleexampleexampleexampleexampleexampleexample',
  '-----END OPENSSH PRIVATE KEY-----',
].join('\n');

const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const API_KEY = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345';
const GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
const SLACK_TOKEN = 'xoxb-1234567890-abcdefghij';
const GITLAB_TOKEN = 'glpat-abcdefghijklmnopqrst';
const JWT =
  'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const BEARER = 'Bearer abcdefghijklmnopqrstuvwxyz012345';

describe('redactSecrets', () => {
  it.each([
    ['private_key', PRIVATE_KEY],
    ['aws_access_key', AWS_KEY],
    ['api_key', API_KEY],
    ['github_token', GITHUB_TOKEN],
    ['slack_token', SLACK_TOKEN],
    ['gitlab_token', GITLAB_TOKEN],
    ['jwt', JWT],
    ['bearer_token', BEARER],
  ])('redacts a %s and keeps the surrounding text', (kind, secret) => {
    expect(redactSecrets(`before ${secret} after`)).toBe(
      `before [redacted:${kind}] after`,
    );
  });

  it('redacts every occurrence', () => {
    expect(redactSecrets(`${AWS_KEY} and ${AWS_KEY}`)).toBe(
      '[redacted:aws_access_key] and [redacted:aws_access_key]',
    );
  });

  it('leaves ordinary code, short keys and hashes alone', () => {
    const safe = [
      'sk-test',
      'const token = "abc"',
      'a'.repeat(64),
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
      'Bearer short',
      'AKIA',
      'xoxb-1',
    ].join('\n');
    expect(redactSecrets(safe)).toBe(safe);
  });

  it('is idempotent', () => {
    const once = redactSecrets(AWS_KEY);
    expect(redactSecrets(once)).toBe(once);
  });

  it('does not match ordinary production source', () => {
    const root = join(process.cwd(), 'src');
    const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.parentPath.split(/[\\/]/).includes('test'),
    );
    const matched = files
      .map((entry) => join(entry.parentPath, entry.name))
      .filter((path) => {
        const text = readFileSync(path, 'utf8');
        return redactSecrets(text) !== text;
      });
    expect(matched).toEqual([]);
  });
});

describe('redactToolOutput', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('redacts string output', () => {
    expect(redactToolOutput(`key=${API_KEY}`)).toBe('key=[redacted:api_key]');
  });

  it('redacts text content parts but leaves media untouched', () => {
    const out = redactToolOutput([
      { type: 'text', text: `token ${GITHUB_TOKEN}` },
      { type: 'image_url', imageUrl: { url: 'data:image/png;base64,AAAA' } },
    ]);
    expect(out).toEqual([
      { type: 'text', text: 'token [redacted:github_token]' },
      { type: 'image_url', imageUrl: { url: 'data:image/png;base64,AAAA' } },
    ]);
  });

  it('can be disabled with OMNICODE_TOOL_OUTPUT_REDACTION=0', () => {
    vi.stubEnv('OMNICODE_TOOL_OUTPUT_REDACTION', '0');
    expect(redactToolOutput(AWS_KEY)).toBe(AWS_KEY);
  });
});
