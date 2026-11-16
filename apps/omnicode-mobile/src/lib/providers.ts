import type { ProviderId } from './types';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  tagline: string;
  keyPrefix: string;
  keyPlaceholder: string;
  models: string[];
  docsUrl: string;
}

export const providers: ProviderInfo[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    tagline: 'GPT · o-series',
    keyPrefix: 'sk-',
    keyPlaceholder: 'sk-…',
    models: ['gpt-5.2', 'gpt-5-mini', 'o4', 'gpt-4.1'],
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    tagline: 'Claude',
    keyPrefix: 'sk-ant-',
    keyPlaceholder: 'sk-ant-…',
    models: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5'],
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'google',
    label: 'Google',
    tagline: 'Gemini',
    keyPrefix: 'AIza',
    keyPlaceholder: 'AIza…',
    models: ['gemini-3-pro', 'gemini-3-flash', 'gemini-2.5-pro'],
    docsUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'custom',
    label: 'Custom',
    tagline: 'OpenAI-compatible',
    keyPrefix: '',
    keyPlaceholder: 'API key',
    models: ['custom-model'],
    docsUrl: '',
  },
];

export function providerInfo(id: ProviderId): ProviderInfo {
  return providers.find((p) => p.id === id) ?? providers[0]!;
}

export function defaultModel(id: ProviderId): string {
  return providerInfo(id).models[0] ?? 'custom-model';
}
