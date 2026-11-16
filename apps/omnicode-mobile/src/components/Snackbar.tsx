import { RotateCcw } from 'lucide-react-native';
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { radii } from '@/theme/tokens';
import { textStyles } from '@/theme/typography';
import { useTheme } from '@/theme/ThemeProvider';
import { PressableScale, USE_NATIVE_DRIVER, useAnimatedValue } from './ui';

export interface SnackbarData {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface SnackbarProps {
  data: SnackbarData | null;
  onDismiss: () => void;
  bottomOffset?: number;
}

export function Snackbar({ data, onDismiss, bottomOffset = 120 }: SnackbarProps) {
  const { colors } = useTheme();
  const opacity = useAnimatedValue(0);
  const translateY = useAnimatedValue(16);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (data) {
      translateY.setValue(16);
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: USE_NATIVE_DRIVER }),
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: USE_NATIVE_DRIVER,
          speed: 18,
          bounciness: 4,
        }),
      ]).start();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: USE_NATIVE_DRIVER }).start(() =>
          onDismiss(),
        );
      }, 5000);
    } else {
      opacity.setValue(0);
    }
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [data, opacity, translateY, onDismiss]);

  if (!data) return null;

  return (
    <Animated.View
      style={[styles.wrap, { bottom: bottomOffset, opacity, transform: [{ translateY }] }]}
      pointerEvents="box-none"
    >
      <View
        style={[
          styles.bar,
          {
            backgroundColor: colors.surface2,
            borderColor: colors.lineStrong,
            shadowColor: colors.shadow,
            shadowOpacity: 0.5,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: 8 },
            elevation: 8,
          },
        ]}
      >
        <Text style={[textStyles.small, { color: colors.text, flex: 1 }]} numberOfLines={2}>
          {data.message}
        </Text>
        {data.actionLabel && data.onAction ? (
          <PressableScale
            onPress={() => {
              data.onAction?.();
              onDismiss();
            }}
            accessibilityRole="button"
            accessibilityLabel={data.actionLabel}
            style={[styles.action, { backgroundColor: colors.goldSoft, borderColor: colors.goldBorder }]}
          >
            <RotateCcw size={12} color={colors.goldText} strokeWidth={1.6} />
            <Text style={[textStyles.caption, { color: colors.goldText, fontFamily: undefined }]}>
              {data.actionLabel}
            </Text>
          </PressableScale>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: radii.panel,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: 420,
    width: '100%',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radii.quiet,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
});
