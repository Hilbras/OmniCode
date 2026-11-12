export interface ProviderValidation {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface ProviderDescriptor {
  readonly id: string;
  readonly name: string;
  readonly ownsModel: (modelId: string) => boolean;
  readonly validateKey?: (apiKey: string) => ProviderValidation;
  readonly baseUrls?: readonly string[];
  readonly supportsDiscovery?: boolean;
}

export class ProviderDescriptorRegistry {
  private readonly descriptors = new Map<string, ProviderDescriptor>();

  register(descriptor: ProviderDescriptor): void {
    if (this.descriptors.has(descriptor.id)) {
      throw new Error(`provider descriptor already registered: ${descriptor.id}`);
    }
    this.descriptors.set(descriptor.id, descriptor);
  }

  list(): readonly ProviderDescriptor[] {
    return [...this.descriptors.values()];
  }

  get(id: string): ProviderDescriptor | undefined {
    return this.descriptors.get(id);
  }

  resolve(modelId: string): ProviderDescriptor | undefined {
    const matches = this.list().filter((descriptor) => descriptor.ownsModel(modelId));
    if (matches.length > 1) {
      throw new Error(`model ${modelId} is claimed by multiple providers: ${matches.map((entry) => entry.id).join(', ')}`);
    }
    return matches[0];
  }

  assertNoOverlaps(modelIds: readonly string[]): void {
    for (const modelId of modelIds) this.resolve(modelId);
  }
}

export function prefixMatcher(...prefixes: string[]): (modelId: string) => boolean {
  const normalized = prefixes.map((prefix) => prefix.toLowerCase());
  return (modelId) => normalized.some((prefix) => modelId.toLowerCase().startsWith(prefix));
}

export function patternMatcher(...patterns: readonly RegExp[]): (modelId: string) => boolean {
  return (modelId) => patterns.some((pattern) => pattern.test(modelId));
}

export function validateNonEmptyKey(apiKey: string): ProviderValidation {
  return apiKey.trim().length === 0
    ? { ok: false, reason: 'API key must not be empty' }
    : { ok: true };
}

export function validateKeyPrefix(prefix: string): (apiKey: string) => ProviderValidation {
  return (apiKey) =>
    apiKey.trim().startsWith(prefix)
      ? { ok: true }
      : { ok: false, reason: `API key must start with ${prefix}` };
}
