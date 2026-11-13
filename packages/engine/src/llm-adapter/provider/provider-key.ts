import { Error2 } from '@hilbras/omnicode-base/errors/errors';

import { CONFIG_INVALID_ERROR_CODE } from '../contract/errors';

/**
 * Provider key format validation at client composition.
 *
 * This is intentionally not a "does the key work" probe: only the provider can
 * answer that, and a probe would cost a request. It catches the two failure
 * modes that are locally decidable and otherwise surface as a confusing 401
 * hours later: keys that are not safe to put in an HTTP header (empty,
 * whitespace padded, or carrying control characters), and keys whose shape
 * belongs to a different first-party provider.
 *
 * Plain `sk-...` keys are deliberately not treated as an OpenAI signature.
 * Anthropic-compatible gateways commonly issue `sk-...` keys, and rejecting
 * them would break a working configuration. Only signatures that no other wire
 * accepts are treated as proof of a mismatch.
 */

export type ProviderKeyCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

export type ProviderKeyFamily = 'anthropic' | 'google';

const ANTHROPIC_KEY_PREFIX = 'sk-ant-';
const GOOGLE_KEY_PREFIX = 'AIza';

const STRICT_PROVIDER_TYPES: ReadonlySet<string> = new Set([
  'anthropic',
  'openai',
  'openai_responses',
  'google-genai',
]);

const KEY_FAMILY_PROVIDER_TYPES: Readonly<Record<ProviderKeyFamily, readonly string[]>> = {
  anthropic: ['anthropic'],
  google: ['google-genai'],
};

const FAMILY_LABELS: Readonly<Record<ProviderKeyFamily, string>> = {
  anthropic: 'Anthropic',
  google: 'Google',
};

const CONTROL_OR_SPACE = /[\s\u0000-\u001f\u007f]/;

export function providerKeyFamily(apiKey: string): ProviderKeyFamily | undefined {
  if (apiKey.startsWith(ANTHROPIC_KEY_PREFIX)) return 'anthropic';
  if (apiKey.startsWith(GOOGLE_KEY_PREFIX)) return 'google';
  return undefined;
}

export function checkProviderApiKey(
  providerType: string | undefined,
  apiKey: string,
): ProviderKeyCheck {
  if (apiKey.trim().length === 0) {
    return { ok: false, reason: 'must not be empty.' };
  }
  if (apiKey !== apiKey.trim()) {
    return { ok: false, reason: 'must not have leading or trailing whitespace.' };
  }
  if (CONTROL_OR_SPACE.test(apiKey)) {
    return { ok: false, reason: 'must not contain whitespace or control characters.' };
  }
  if (providerType === undefined || !STRICT_PROVIDER_TYPES.has(providerType)) {
    return { ok: true };
  }
  const family = providerKeyFamily(apiKey);
  if (family === undefined) return { ok: true };
  if (KEY_FAMILY_PROVIDER_TYPES[family].includes(providerType)) return { ok: true };
  return {
    ok: false,
    reason:
      `looks like a ${FAMILY_LABELS[family]} API key; ` +
      `provider type "${providerType}" expects a different key.`,
  };
}

export function assertProviderApiKey(
  providerType: string | undefined,
  apiKey: string,
  field: string,
): string {
  const check = checkProviderApiKey(providerType, apiKey);
  if (!check.ok) {
    throw new Error2(CONFIG_INVALID_ERROR_CODE, `${field} ${check.reason}`);
  }
  return apiKey;
}