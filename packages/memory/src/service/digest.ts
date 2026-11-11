export function normalizeDigestContent(value: string): string {
  return value
    .normalize('NFKC')
    .replaceAll(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function bigrams(value: string): Set<string> {
  const normalized = normalizeDigestContent(value);
  const out = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    out.add(normalized.slice(index, index + 2));
  }
  return out;
}

export function diceSimilarity(left: string, right: string): number {
  if (normalizeDigestContent(left) === normalizeDigestContent(right)) return 1;
  const a = bigrams(left);
  const b = bigrams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const gram of a) {
    if (b.has(gram)) overlap += 1;
  }
  return (2 * overlap) / (a.size + b.size);
}

export function quantitySignature(value: string): readonly string[] {
  return normalizeDigestContent(value).match(/\d+/g) ?? [];
}

export function isFuzzyDigestDuplicate(left: string, right: string): boolean {
  const leftQuantity = quantitySignature(left);
  const rightQuantity = quantitySignature(right);
  if (
    leftQuantity.length > 0 &&
    rightQuantity.length > 0 &&
    leftQuantity.join(',') !== rightQuantity.join(',')
  ) {
    return false;
  }
  return diceSimilarity(left, right) >= 0.9;
}

export function isSupersetContent(previous: string, next: string): boolean {
  const oldTokens = new Set(normalizeDigestContent(previous).split(' ').filter(Boolean));
  const newTokens = new Set(normalizeDigestContent(next).split(' ').filter(Boolean));
  if (newTokens.size <= oldTokens.size) return false;
  for (const token of oldTokens) {
    if (!newTokens.has(token)) return false;
  }
  return true;
}
