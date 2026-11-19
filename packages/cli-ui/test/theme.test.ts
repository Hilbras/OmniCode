import { afterEach, describe, expect, it } from 'vitest';

import { darkColors, lightColors, type ColorPalette } from '../src/theme/colors.js';
import { currentTheme, Theme } from '../src/theme/theme.js';

const originalPalette = currentTheme.palette;
afterEach(() => currentTheme.setPalette(originalPalette));

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

describe('color palettes', () => {
  it('expose the same token set in dark and light themes with valid hex values', () => {
    expect(Object.keys(lightColors).sort()).toEqual(Object.keys(darkColors).sort());
    for (const [token, value] of Object.entries(lightColors) as [keyof ColorPalette, string][]) {
      expect(value, token).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('meets WCAG AA for light-theme text tokens against white', () => {
    for (const token of ['text', 'textStrong', 'textDim', 'textMuted'] as const) {
      expect(contrast(lightColors[token], '#FFFFFF'), token).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps light-theme chrome tokens at or above the 3:1 large-text floor', () => {
    for (const token of ['primary', 'border', 'borderFocus'] as const) {
      expect(contrast(lightColors[token], '#FFFFFF'), token).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('Theme', () => {
  it('reads the active palette and swaps it in place', () => {
    const theme = new Theme(darkColors);
    expect(theme.color('primary')).toBe(darkColors.primary);
    theme.setPalette(lightColors);
    expect(theme.color('primary')).toBe(lightColors.primary);
    expect(theme.palette).toBe(lightColors);
  });

  it('lets a custom palette be installed on the shared singleton', () => {
    const custom: ColorPalette = { ...darkColors, primary: '#123456' };
    currentTheme.setPalette(custom);
    expect(currentTheme.color('primary')).toBe('#123456');
    expect(currentTheme.fg('primary', 'x')).toContain('x');
  });
});
