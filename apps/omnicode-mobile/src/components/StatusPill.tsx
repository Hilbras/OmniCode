import React, { useEffect } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { radii } from '@/theme/tokens';
import { textStyles } from '@/theme/typography';
import { useTheme } from '@/theme/ThemeProvider';
import { USE_NATIVE_DRIVER, useAnimatedValue } from './ui';

export type PillTone = 'success' | 'gold' | 'muted' | 'danger' | 'dashed';

interface StatusPillProps {
  label: string;
  tone: PillTone;
  pulse?: boolean;
}

export function StatusPill({ label, tone, pulse = false }: StatusPillProps) {
  const { colors } = useTheme();
  const opacity = useAnimatedValue(1);

  useEffect(() => {
    if (!pulse) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.5, duration: 1300, useNativeDriver: USE_NATIVE_DRIVER }),
        Animated.timing(opacity, { toValue: 1, duration: 1300, useNativeDriver: USE_NATIVE_DRIVER }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, opacity]);

  const toneColor =
    tone === 'success'
      ? colors.success
      : tone === 'danger'
        ? colors.danger
        : tone === 'muted'
          ? colors.muted
          : colors.goldText;

  const background =
    tone === 'success'
      ? colors.successSoft
      : tone === 'danger'
        ? colors.dangerSoft
        : tone === 'muted'
          ? colors.surface2
          : colors.goldSoft;

  return (
    <Animated.View
      style={[
        styles.pill,
        {
          backgroundColor: tone === 'dashed' ? 'transparent' : background,
          borderColor: tone === 'muted' ? colors.lineStrong : toneColor,
          borderStyle: tone === 'dashed' ? 'dashed' : 'solid',
          opacity: pulse ? opacity : 1,
        },
      ]}
    >
      <View style={[styles.dot, { backgroundColor: toneColor }]} />
      <Animated.Text style={[textStyles.monoLabel, { color: toneColor, textTransform: 'uppercase' }]}>
        {label}
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
});
