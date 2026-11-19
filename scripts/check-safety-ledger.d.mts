export interface SafetyPin {
  readonly file: string;
  readonly pattern: string;
  readonly value: string;
  readonly reason: string;
}

export interface SafetyLedger {
  readonly pins: Readonly<Record<string, SafetyPin>>;
}

export interface SafetyViolation {
  readonly id: string;
  readonly file: string;
  readonly kind: 'value-drift' | 'missing-declaration';
  readonly expected: string;
  readonly actual?: string;
}

export function checkSafetyLedger(
  ledger: SafetyLedger,
  readFile: (path: string) => string | undefined,
): SafetyViolation[];
