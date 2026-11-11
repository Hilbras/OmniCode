const CODE_PLACEHOLDER = '\u0000OMNICODE_CODE_';
const INLINE_PLACEHOLDER = '\u0000OMNICODE_INLINE_';
const TABLE_PLACEHOLDER = '\u0000OMNICODE_TABLE_';

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value: string): string {
  return value.replaceAll('"', '&quot;');
}

/**
 * Convert the assistant's Markdown into the HTML subset Telegram accepts.
 *
 * Telegram's MarkdownV2 parser rejects a message on a single unescaped
 * character, so HTML is the safer target: we escape the text first and only
 * emit the handful of tags Telegram documents (`b`, `i`, `s`, `code`, `pre`,
 * `a`, `blockquote`). Anything Telegram does not support stays as plain text.
 */
export function markdownToTelegramHtml(markdown: string): string {
  const codeBlocks: string[] = [];
  const inlineCode: string[] = [];
  const tables: string[] = [];
  let text = markdown.replaceAll('\r\n', '\n');

  text = text.replace(/(?:^\|.*\|[ \t]*\n?){2,}/gm, (block: string) => {
    const index = tables.length;
    tables.push(`<pre>${escapeHtml(formatTable(block))}</pre>`);
    return `${TABLE_PLACEHOLDER}${String(index)}\u0000`;
  });

  text = text.replace(/```[^\n`]*\n?([\s\S]*?)```/g, (_match, code: string) => {
    const index = codeBlocks.length;
    codeBlocks.push(`<pre>${escapeHtml(code.replace(/\n$/, ''))}</pre>`);
    return `${CODE_PLACEHOLDER}${String(index)}\u0000`;
  });

  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const index = inlineCode.length;
    inlineCode.push(`<code>${escapeHtml(code)}</code>`);
    return `${INLINE_PLACEHOLDER}${String(index)}\u0000`;
  });

  text = escapeHtml(text);

  text = text.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label: string, url: string) => {
    return `<a href="${escapeAttribute(url)}">${label}</a>`;
  });
  text = text.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  text = text.replace(/__([^_\n]+)__/g, '<b>$1</b>');
  text = text.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  text = text.replace(/^\s*[-*+]\s+/gm, '• ');
  text = text.replace(/(?<![\w*])\*([^*\n]+)\*(?![\w*])/g, '<i>$1</i>');
  text = text.replace(/(?<![\w])_([^_\n]+)_(?![\w])/g, '<i>$1</i>');
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');
  text = text.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>');
  text = text.replace(/^\s*([-*_]){3,}\s*$/gm, '────────');

  text = text.replace(
    new RegExp(`${INLINE_PLACEHOLDER}(\\d+)\\u0000`, 'g'),
    (_match, index: string) => inlineCode[Number(index)] ?? '',
  );
  text = text.replace(
    new RegExp(`${CODE_PLACEHOLDER}(\\d+)\\u0000`, 'g'),
    (_match, index: string) => codeBlocks[Number(index)] ?? '',
  );
  text = text.replace(
    new RegExp(`${TABLE_PLACEHOLDER}(\\d+)\\u0000`, 'g'),
    (_match, index: string) => tables[Number(index)] ?? '',
  );
  return text;
}

function formatTable(block: string): string {
  const rows = block
    .trimEnd()
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim()),
    );
  if (rows.length === 0) return block;
  const columns = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columns }, (_value, index) =>
    Math.max(...rows.map((row) => (row[index] ?? '').length)),
  );
  return rows
    .map((row) =>
      Array.from({ length: columns }, (_value, index) => (row[index] ?? '').padEnd(widths[index]!))
        .join(' | ')
        .trimEnd(),
    )
    .join('\n');
}

/**
 * Split Markdown into source chunks that stay under Telegram's message limit.
 * Code fences are closed at a chunk boundary and reopened in the next chunk so
 * each chunk can be converted independently.
 */
export function splitMarkdownChunks(markdown: string, limit = 3_000): readonly string[] {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const chunks: string[] = [];
  let current: string[] = [];
  let size = 0;
  let fenceOpening: string | undefined;

  const flush = (): void => {
    if (current.length === 0) return;
    let body = current.join('\n');
    if (fenceOpening !== undefined) body += '\n```';
    chunks.push(body);
    current = fenceOpening === undefined ? [] : [fenceOpening];
    size = fenceOpening === undefined ? 0 : fenceOpening.length + 1;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const closingFence = fenceOpening !== undefined && trimmed === '```';
    const lineSize = line.length + 1;
    if (!closingFence && size + lineSize > limit && current.length > 0) flush();
    if (line.length + 1 > limit && !closingFence) {
      let rest = line;
      while (rest.length > limit) {
        chunks.push(rest.slice(0, limit));
        rest = rest.slice(limit);
      }
      current.push(rest);
      size = rest.length + 1;
    } else {
      current.push(line);
      size += lineSize;
    }
    if (trimmed.startsWith('```')) {
      fenceOpening = fenceOpening === undefined ? trimmed : undefined;
    }
  }
  flush();
  return chunks.length > 0 ? chunks : [''];
}

export function telegramHtmlBody(
  text: string,
  markdown: boolean,
): { readonly text: string; readonly parse_mode?: 'HTML' } {
  if (!markdown) return { text };
  const html = markdownToTelegramHtml(text);
  return html.length <= 4_000 ? { text: html, parse_mode: 'HTML' } : { text };
}
