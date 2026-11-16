import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { useTheme } from '@/theme/ThemeProvider';

export function Hairline({ opacity = 0.55 }: { opacity?: number }) {
  const { colors } = useTheme();
  return (
    <LinearGradient
      colors={['transparent', colors.gold, 'transparent']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={{ height: 1, opacity }}
    />
  );
}
