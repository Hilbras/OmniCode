import React, { useEffect, useState } from 'react';
import { Animated, Easing, ViewStyle } from 'react-native';
import { easeOut } from '@/theme/tokens';
import { USE_NATIVE_DRIVER } from './ui';

const EASE = Easing.bezier(...easeOut);

export function useEntrance(delay = 0, distance = 14, duration = 380) {
  const [opacity] = useState(() => new Animated.Value(0));
  const [translateY] = useState(() => new Animated.Value(distance));

  useEffect(() => {
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        delay,
        easing: EASE,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration,
        delay,
        easing: EASE,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [opacity, translateY, delay, duration]);

  return { opacity, transform: [{ translateY }] };
}

interface EntranceProps {
  children: React.ReactNode;
  delay?: number;
  distance?: number;
  duration?: number;
  style?: ViewStyle;
}

export function Entrance({ children, delay, distance, duration, style }: EntranceProps) {
  const animated = useEntrance(delay, distance, duration);
  return <Animated.View style={[animated, style]}>{children}</Animated.View>;
}

export function BlinkingCaret({ color }: { color: string }) {
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.15, duration: 520, easing: EASE, useNativeDriver: USE_NATIVE_DRIVER }),
        Animated.timing(opacity, { toValue: 1, duration: 520, easing: EASE, useNativeDriver: USE_NATIVE_DRIVER }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={{
        width: 8,
        height: 16,
        borderRadius: 2,
        marginTop: 4,
        backgroundColor: color,
        opacity,
      }}
    />
  );
}
