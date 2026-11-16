import React, { useState } from 'react';
import { Animated, Platform, Pressable, PressableProps, PressableStateCallbackType } from 'react-native';

export const USE_NATIVE_DRIVER = Platform.OS !== 'web';

export function useAnimatedValue(initial: number): Animated.Value {
  const [value] = useState(() => new Animated.Value(initial));
  return value;
}

export function isHovered(state: PressableStateCallbackType): boolean {
  return (state as PressableStateCallbackType & { hovered?: boolean }).hovered === true;
}

export function PressableScale({
  children,
  scaleTo = 0.97,
  ...props
}: Omit<PressableProps, 'children'> & { scaleTo?: number; children?: React.ReactNode }) {
  const scale = useAnimatedValue(1);
  const animate = (to: number) => {
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: USE_NATIVE_DRIVER,
      speed: 40,
      bounciness: 4,
    }).start();
  };
  return (
    <Pressable
      {...props}
      onPressIn={(event) => {
        animate(scaleTo);
        props.onPressIn?.(event);
      }}
      onPressOut={(event) => {
        animate(1);
        props.onPressOut?.(event);
      }}
    >
      <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
    </Pressable>
  );
}
