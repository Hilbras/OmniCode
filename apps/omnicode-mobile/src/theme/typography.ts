import { TextStyle } from 'react-native';
import { fontSize, tracking } from './tokens';

export const fonts = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  extrabold: 'Geist_800ExtraBold',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
} as const;

export type FontWeight = keyof typeof fonts;

export function type(
  weight: FontWeight,
  size: number,
  letterSpacingEm = 0,
): TextStyle {
  return {
    fontFamily: fonts[weight],
    fontSize: size,
    letterSpacing: Math.round(size * letterSpacingEm * 100) / 100,
  };
}

export const textStyles = {
  display: { ...type('extrabold', fontSize.display, tracking.display), lineHeight: 38 },
  title: { ...type('bold', fontSize.title, tracking.title), lineHeight: 34 },
  heading: { ...type('semibold', fontSize.lg, tracking.card), lineHeight: 24 },
  body: { ...type('regular', fontSize.body), lineHeight: 24 },
  bodyMedium: { ...type('medium', fontSize.body), lineHeight: 24 },
  small: { ...type('regular', fontSize.small), lineHeight: 20 },
  caption: { ...type('regular', fontSize.xs), lineHeight: 17 },
  eyebrow: { ...type('bold', fontSize.label, tracking.eyebrow), lineHeight: 14 },
  monoLabel: { ...type('monoMedium', 10, tracking.claim), lineHeight: 13 },
  mono: { ...type('mono', fontSize.xs), lineHeight: 18 },
  monoSmall: { ...type('mono', fontSize.label), lineHeight: 16 },
  button: { ...type('semibold', fontSize.sm), lineHeight: 18 },
} as const;
