import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { ActivityIndicator, PressableStateCallbackType, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { radii } from '@/theme/tokens';
import { textStyles } from '@/theme/typography';
import { useTheme } from '@/theme/ThemeProvider';
import { PressableScale } from './ui';

type Variant = 'gold' | 'ghost' | 'quiet' | 'danger';

interface GoldButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  icon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  style?: ViewStyle;
}

export function GoldButton({
  label,
  onPress,
  variant = 'gold',
  icon,
  trailingIcon,
  disabled = false,
  loading = false,
  small = false,
  style,
}: GoldButtonProps) {
  const { colors } = useTheme();
  const isGold = variant === 'gold';
  const textColor = isGold
    ? colors.goldInk
    : variant === 'danger'
      ? colors.danger
      : variant === 'quiet'
        ? colors.muted
        : colors.text;

  const body = (
    <View
      style={[
        styles.row,
        small && styles.rowSmall,
        variant === 'quiet' && styles.rowQuiet,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={textColor} />
      ) : (
        icon
      )}
      <Text style={[textStyles.button, { color: textColor }]} numberOfLines={1}>
        {label}
      </Text>
      {trailingIcon}
    </View>
  );

  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
        styles.base,
        small && styles.baseSmall,
        {
          borderColor: isGold
            ? colors.goldBorder
            : variant === 'danger'
              ? colors.danger
              : variant === 'quiet'
                ? 'transparent'
                : hovered
                  ? colors.goldBorder
                  : colors.lineStrong,
          backgroundColor:
            variant === 'ghost'
              ? hovered
                ? colors.goldSoft
                : colors.surface
              : variant === 'danger'
                ? colors.dangerSoft
                : 'transparent',
          opacity: disabled ? 0.45 : 1,
          transform: [{ translateY: hovered && !disabled ? -1 : 0 }],
        },
        isGold && {
          shadowColor: colors.gold,
          shadowOpacity: hovered ? 0.35 : 0.25,
          shadowRadius: hovered ? 16 : 12,
          shadowOffset: { width: 0, height: hovered ? 10 : 6 },
          elevation: hovered ? 8 : 6,
        },
        style,
      ]}
    >
      {isGold ? (
        <LinearGradient
          colors={[colors.gold, colors.goldBright, colors.gold]}
          locations={[0, 0.55, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
      {body}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    borderWidth: 1,
    borderRadius: radii.button,
    overflow: 'hidden',
    alignSelf: 'flex-start',
  },
  baseSmall: {
    borderRadius: radii.quiet,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 17,
    paddingVertical: 10,
  },
  rowSmall: {
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  rowQuiet: {
    paddingHorizontal: 10,
  },
});
