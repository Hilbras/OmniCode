export interface Palette {
  bg: string;
  bgSoft: string;
  surface: string;
  surface2: string;
  text: string;
  muted: string;
  line: string;
  lineStrong: string;
  gold: string;
  goldBright: string;
  goldText: string;
  goldMid: string;
  goldInk: string;
  goldSoft: string;
  glow: string;
  goldBorder: string;
  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;
  scrim: string;
  glass: string;
  shadow: string;
}

export const darkPalette: Palette = {
  bg: '#0c0b09',
  bgSoft: '#12100c',
  surface: '#15130e',
  surface2: '#1b1812',
  text: '#f2efe6',
  muted: '#9c9584',
  line: '#262117',
  lineStrong: '#353021',
  gold: '#e2bd52',
  goldBright: '#f3d789',
  goldText: '#e6c768',
  goldMid: '#f3d789',
  goldInk: '#1a1503',
  goldSoft: 'rgba(226, 189, 82, 0.12)',
  glow: 'rgba(226, 189, 82, 0.25)',
  goldBorder: '#9e843a',
  success: '#6fdb9b',
  successSoft: 'rgba(111, 219, 155, 0.10)',
  danger: '#ff8a80',
  dangerSoft: 'rgba(255, 138, 128, 0.10)',
  scrim: 'rgba(0, 0, 0, 0.55)',
  glass: 'rgba(12, 11, 9, 0.74)',
  shadow: 'rgba(0, 0, 0, 0.5)',
};

export const lightPalette: Palette = {
  bg: '#faf9f5',
  bgSoft: '#f3f0e7',
  surface: '#ffffff',
  surface2: '#f7f4ec',
  text: '#17150f',
  muted: '#6f6857',
  line: '#e7e1d1',
  lineStrong: '#d8d0bb',
  gold: '#d4af37',
  goldBright: '#e9c963',
  goldText: '#7d620f',
  goldMid: '#a8820f',
  goldInk: '#1c1704',
  goldSoft: 'rgba(212, 175, 55, 0.14)',
  glow: 'rgba(212, 175, 55, 0.35)',
  goldBorder: '#947a27',
  success: '#0f5c38',
  successSoft: 'rgba(15, 92, 56, 0.08)',
  danger: '#c23b31',
  dangerSoft: 'rgba(194, 59, 49, 0.08)',
  scrim: 'rgba(23, 21, 15, 0.35)',
  glass: 'rgba(250, 249, 245, 0.74)',
  shadow: 'rgba(30, 25, 5, 0.07)',
};

export const radii = {
  button: 10,
  quiet: 8,
  node: 10,
  panel: 12,
  card: 16,
  pill: 999,
} as const;

export const fontSize = {
  micro: 9,
  label: 11,
  small: 13,
  body: 15,
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  title: 30,
  display: 36,
} as const;

export const tracking = {
  card: -0.02,
  feature: -0.03,
  label: 0.08,
  claim: 0.12,
  eyebrow: 0.11,
  display: -0.055,
  title: -0.035,
  tight: -0.025,
} as const;

export const easeOut = [0.22, 1, 0.36, 1] as const;
