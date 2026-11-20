/**
 * Theme resolution for the Omnicode web app.
 *
 * Pure helpers so the behavior is testable without a DOM. The index.html
 * pre-paint script mirrors `resolveInitialTheme` inline — keep the two in
 * sync (storage key and default).
 */
export type Theme = 'dark' | 'light';

export const THEME_STORAGE_KEY = 'omnicode-theme';

export function isTheme(value: string | null | undefined): value is Theme {
  return value === 'dark' || value === 'light';
}

/** Stored choice wins; otherwise follow the OS preference; default dark. */
export function resolveInitialTheme(stored: string | null, prefersLight: boolean): Theme {
  if (isTheme(stored)) return stored;
  return prefersLight ? 'light' : 'dark';
}

export function nextTheme(theme: Theme): Theme {
  return theme === 'dark' ? 'light' : 'dark';
}
