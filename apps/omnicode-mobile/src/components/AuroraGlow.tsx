import React, { useId } from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeProvider';

export function AuroraGlow({ height = 300 }: { height?: number }) {
  const { colors } = useTheme();
  const id = `aurora_${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg style={StyleSheet.absoluteFill} height={height} pointerEvents="none">
      <Defs>
        <RadialGradient id={id} cx="50%" cy="-15%" r="90%" fx="50%" fy="-15%">
          <Stop offset="0" stopColor={colors.gold} stopOpacity="0.16" />
          <Stop offset="0.7" stopColor={colors.gold} stopOpacity="0" />
        </RadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height={height} fill={`url(#${id})`} />
    </Svg>
  );
}
