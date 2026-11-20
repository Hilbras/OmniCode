import { describe, expect, it } from 'vitest';

import {
  isTheme,
  nextTheme,
  resolveInitialTheme,
  THEME_STORAGE_KEY,
} from '../src/design/theme';

describe('theme resolution', () => {
  it('uses the storage key the index.html pre-paint script writes', () => {
    expect(THEME_STORAGE_KEY).toBe('omnicode-theme');
  });

  it('accepts only dark and light as stored themes', () => {
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('light')).toBe(true);
    expect(isTheme('midnight')).toBe(false);
    expect(isTheme(null)).toBe(false);
  });

  it('prefers a valid stored choice over the OS preference', () => {
    expect(resolveInitialTheme('light', false)).toBe('light');
    expect(resolveInitialTheme('dark', true)).toBe('dark');
  });

  it('follows the OS preference when nothing is stored', () => {
    expect(resolveInitialTheme(null, true)).toBe('light');
    expect(resolveInitialTheme(null, false)).toBe('dark');
  });

  it('falls back to dark for garbage storage', () => {
    expect(resolveInitialTheme('bogus', true)).toBe('light');
    expect(resolveInitialTheme('bogus', false)).toBe('dark');
  });

  it('toggles between the two themes', () => {
    expect(nextTheme('dark')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
  });
});
