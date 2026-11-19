export interface BareSpecifier {
  specifier: string;
  line: number;
}

export interface PhantomViolation {
  dir: string;
  name: string;
  kind: 'phantom' | 'stale-allowlist';
  file: string;
  line: number;
}

export interface PhantomAnalysis {
  violations: PhantomViolation[];
  scannedFiles: number;
  packages: number;
}

export function extractBareSpecifiers(text: string): BareSpecifier[];
export function packageNameOf(specifier: string): string | undefined;
export function analyzeWorkspace(
  root: string,
  allowlist?: Record<string, string>,
): PhantomAnalysis;
