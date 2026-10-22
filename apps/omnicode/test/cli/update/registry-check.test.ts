import { checkRegistryForUpdate, isUpdateAvailable } from '#/cli/update/registry-check';
import { describe, expect, it } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as unknown as Response;
}

describe('isUpdateAvailable', () => {
  it('returns true for a strictly newer stable version', () => {
    expect(isUpdateAvailable('1.2.0', '1.2.1')).toBe(true);
    expect(isUpdateAvailable('1.2.0', '1.3.0')).toBe(true);
  });

  it('returns false for equal or older versions', () => {
    expect(isUpdateAvailable('1.2.1', '1.2.1')).toBe(false);
    expect(isUpdateAvailable('1.3.0', '1.2.1')).toBe(false);
  });

  it('never treats a prerelease target as available', () => {
    expect(isUpdateAvailable('1.2.0', '1.3.0-beta.1')).toBe(false);
  });

  it('returns false for malformed input', () => {
    expect(isUpdateAvailable('garbage', '1.2.1')).toBe(false);
    expect(isUpdateAvailable('1.2.0', 'garbage')).toBe(false);
  });
});

describe('checkRegistryForUpdate', () => {
  it('reports an available update when the registry latest is newer', async () => {
    const fetchImpl = async (): Promise<Response> => jsonResponse({ latest: '99.0.0' });
    await expect(checkRegistryForUpdate('1.2.1', fetchImpl)).resolves.toEqual({
      status: 'available',
      latest: '99.0.0',
    });
  });

  it('reports current when the registry latest equals the running version', async () => {
    const fetchImpl = async (): Promise<Response> => jsonResponse({ latest: '1.2.1' });
    await expect(checkRegistryForUpdate('1.2.1', fetchImpl)).resolves.toEqual({
      status: 'current',
    });
  });

  it('returns an explicit error result on non-2xx responses', async () => {
    const fetchImpl = async (): Promise<Response> => jsonResponse({}, 404);
    const result = await checkRegistryForUpdate('1.2.1', fetchImpl);
    expect(result.status).toBe('error');
  });

  it('returns an explicit error result on malformed JSON bodies', async () => {
    const fetchImpl = async (): Promise<Response> => jsonResponse({ noLatest: true });
    const result = await checkRegistryForUpdate('1.2.1', fetchImpl);
    expect(result.status).toBe('error');
  });

  it('returns an explicit error result when fetch rejects', async () => {
    const fetchImpl = async (): Promise<Response> => {
      throw new Error('network down');
    };
    const result = await checkRegistryForUpdate('1.2.1', fetchImpl);
    expect(result.status).toBe('error');
  });

  it('treats a non-semver latest tag as an error, not "current"', async () => {
    const fetchImpl = async (): Promise<Response> => jsonResponse({ latest: 'not-semver' });
    const result = await checkRegistryForUpdate('1.2.1', fetchImpl);
    expect(result.status).toBe('error');
  });
});
