const MEMORY_AUTHORITY_BRAND: unique symbol = Symbol('omnicode.memory.authority');

export interface MemoryAuthority {
  readonly [MEMORY_AUTHORITY_BRAND]: true;
  readonly label: string;
  readonly issuedAt: number;
}

const issued = new WeakMap<object, MemoryAuthority>();

export function issueMemoryAuthority(label: string, now: number): MemoryAuthority {
  const authority: MemoryAuthority = {
    [MEMORY_AUTHORITY_BRAND]: true,
    label,
    issuedAt: now,
  };
  issued.set(authority, authority);
  return authority;
}

export function resolveMemoryAuthority(value: unknown): MemoryAuthority | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  return issued.get(value);
}