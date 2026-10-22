import type { Terminal } from '@hilbras/omnicode-tui';
import { describe, expect, it, vi } from 'vitest';

import {
  CatalogBrowserApp,
  type CatalogBrowserProps,
} from '#/tui/components/dialogs/catalog-browser';

const ANSI = /\u001B\[[0-9;]*m/g;
const strip = (text: string): string => text.replaceAll(ANSI, '');
const ESC = String.fromCodePoint(27);
const ENTER = '\r';
const UP = `${ESC}[A`;
const DOWN = `${ESC}[B`;

/** Minimal Terminal stub — only `rows` is read by the component. */
function fakeTerminal(rows: number, columns = 120): Terminal {
  return {
    start: () => {},
    stop: () => {},
    drainInput: () => Promise.resolve(),
    write: () => {},
    get columns() {
      return columns;
    },
    get rows() {
      return rows;
    },
    get kittyProtocolActive() {
      return false;
    },
    moveBy: () => {},
    hideCursor: () => {},
    showCursor: () => {},
    clearLine: () => {},
    clearFromCursor: () => {},
    clearScreen: () => {},
    setTitle: () => {},
    setProgress: () => {},
  };
}

function makeProps(overrides: Partial<CatalogBrowserProps> = {}): CatalogBrowserProps {
  return {
    title: 'Available Skills',
    entries: [
      { name: 'review', detail: 'Review code' },
      { name: 'test', detail: 'Run tests' },
    ],
    error: undefined,
    emptyMessage: 'No skills available.',
    onCancel: vi.fn(),
    ...overrides,
  };
}

function makeApp(overrides: Partial<CatalogBrowserProps> = {}, rows = 20): CatalogBrowserApp {
  return new CatalogBrowserApp(makeProps(overrides), fakeTerminal(rows));
}

function text(app: CatalogBrowserApp, width = 80): string {
  return app.render(width).map(strip).join('\n');
}

/** The entry name currently carrying the selection pointer. */
function selectedName(app: CatalogBrowserApp, width = 80): string | undefined {
  for (const line of app.render(width).map(strip)) {
    if (!line.includes('❯')) continue;
    return line.replace('❯', '').trim();
  }
  return undefined;
}

describe('CatalogBrowserApp', () => {
  it('fills exactly terminal.rows lines', () => {
    expect(makeApp({}, 24).render(80)).toHaveLength(24);
    expect(makeApp({}, 12).render(80)).toHaveLength(12);
  });

  it('renders the title, entry names, and detail lines', () => {
    const out = text(makeApp());
    expect(out).toContain('Available Skills');
    expect(out).toContain('review');
    expect(out).toContain('Review code');
    expect(out).toContain('test');
    expect(out).toContain('Run tests');
  });

  it('marks the selected entry with the shared select pointer', () => {
    const app = makeApp();
    expect(selectedName(app)).toBe('review');
    app.handleInput(DOWN);
    expect(selectedName(app)).toBe('test');
    app.handleInput(UP);
    expect(selectedName(app)).toBe('review');
  });

  it('navigates with the printable j/k keys too', () => {
    const app = makeApp();
    app.handleInput('j');
    expect(selectedName(app)).toBe('test');
    app.handleInput('k');
    expect(selectedName(app)).toBe('review');
  });

  it('keeps the selection inside the catalog bounds', () => {
    const app = makeApp();
    app.handleInput(UP);
    expect(selectedName(app)).toBe('review');
    app.handleInput(DOWN);
    app.handleInput(DOWN);
    expect(selectedName(app)).toBe('test');
  });

  it('cancels with Escape and with q', () => {
    const onCancel = vi.fn();
    const app = makeApp({ onCancel });
    app.handleInput(ESC);
    expect(onCancel).toHaveBeenCalledTimes(1);
    app.handleInput('q');
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('shows the empty message when the catalog has no entries', () => {
    const out = text(makeApp({ entries: [], emptyMessage: 'No subagent profiles available.' }));
    expect(out).toContain('No subagent profiles available.');
    expect(out).not.toContain('❯');
  });

  it('shows the load error instead of the list', () => {
    const out = text(makeApp({ error: 'Failed to load skills: boom' }));
    expect(out).toContain('Failed to load skills: boom');
    expect(out).not.toContain('review');
  });

  it('reports how many entries are still below the window', () => {
    const entries = Array.from({ length: 30 }, (_, index) => ({
      name: `skill-${String(index)}`,
      detail: 'Detail',
    }));
    const app = makeApp({ entries }, 20);
    expect(text(app)).toContain('▼');
    expect(text(app)).toMatch(/▼ \d+ more/);
  });

  it('truncates long names and details to the screen width', () => {
    const app = makeApp({
      entries: [{ name: 'a'.repeat(200), detail: 'b'.repeat(200) }],
    });
    for (const line of app.render(24)) {
      expect(strip(line).length).toBeLessThanOrEqual(24);
    }
  });

  it('falls back to a notice on a terminal that is too small', () => {
    const out = text(makeApp({}, 4));
    expect(out).toContain('Terminal too small');
  });

  it('hints the select key only for a selectable catalog', () => {
    expect(text(makeApp())).not.toContain('Enter select');
    expect(text(makeApp({ onSelect: vi.fn() }))).toContain('Enter select');
  });

  it('selects the highlighted entry with Enter', () => {
    const onSelect = vi.fn();
    const app = makeApp({ onSelect });

    app.handleInput(ENTER);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'review', detail: 'Review code' }),
    );
  });

  it('selects the entry the pointer moved to', () => {
    const onSelect = vi.fn();
    const app = makeApp({ onSelect });

    app.handleInput(DOWN);
    app.handleInput(ENTER);

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'test' }));
  });

  it('ignores Enter in a read-only catalog', () => {
    const onCancel = vi.fn();
    const app = makeApp({ onCancel });

    app.handleInput(ENTER);

    expect(onCancel).not.toHaveBeenCalled();
  });

  it('ignores Enter when the catalog is empty', () => {
    const onSelect = vi.fn();
    const app = makeApp({ onSelect, entries: [] });

    app.handleInput(ENTER);

    expect(onSelect).not.toHaveBeenCalled();
  });
});
