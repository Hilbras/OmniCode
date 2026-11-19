/**
 * Terminal visual regression lane (WS4.7).
 *
 * pty output is normalized into a stable, snapshot-friendly signature: ANSI
 * colour/style runs become named tokens, whitespace is made explicit at the
 * edges, and dynamic ids/timestamps are collapsed. A regression is a change in
 * this signature; the screenshot renderer can consume the same normalised
 * frame when visual inspection is needed.
 */
export interface VisualFrame {
  readonly rows: readonly string[];
  readonly cols: number;
}

const ANSI = /\x1b\[([0-9;]*)m/g;
const STYLE_CODES: Readonly<Record<string, string>> = {
  '1': 'bold', '2': 'dim', '3': 'italic', '4': 'underline',
  '31': 'red', '32': 'green', '33': 'yellow', '34': 'blue', '35': 'magenta', '36': 'cyan',
  '90': 'gray',
};

export function normalizeTerminalRow(row: string): string {
  let active = '';
  let out = '';
  let lastIndex = 0;
  for (const match of row.matchAll(ANSI)) {
    out += row.slice(lastIndex, match.index);
    lastIndex = match.index + match[0].length;
    const codes = (match[1] ?? '').split(';').filter((code) => code.length > 0);
    if (codes.length === 0 || codes[0] === '0') active = '';
    else active = codes.map((code) => STYLE_CODES[code] ?? `s${code}`).join('+');
    out += active === '' ? '|' : `|${active}:`;
  }
  out += row.slice(lastIndex);
  out = out.replace(/\|$/, "");
  return out
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>')
    .replace(/\b\d{4}-\d{2}-\d{2}T[\d:.]+Z?\b/g, '<time>')
    .replace(/ +$/, '·')
    .trimEnd();
}

export function frameSignature(frame: VisualFrame): string {
  const width = Math.max(1, Math.min(Math.trunc(frame.cols), 500));
  return frame.rows
    .slice(0, 200)
    .map((row) => normalizeTerminalRow(row).slice(0, width))
    .join('\n');
}
