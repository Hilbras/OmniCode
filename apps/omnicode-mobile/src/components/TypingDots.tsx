import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme/ThemeProvider';
import { USE_NATIVE_DRIVER } from './ui';

export function TypingDots() {
  const { colors } = useTheme();
  const [dots] = useState(() => [0, 1, 2].map(() => new Animated.Value(0.3)));

  useEffect(() => {
    const loops = dots.map((dot, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(index * 180),
          Animated.timing(dot, { toValue: 1, duration: 420, useNativeDriver: USE_NATIVE_DRIVER }),
          Animated.timing(dot, { toValue: 0.3, duration: 420, useNativeDriver: USE_NATIVE_DRIVER }),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [dots]);

  return (
    <View style={styles.row} accessibilityLabel="Agent is thinking">
      {dots.map((dot, index) => (
        <Animated.View
          key={index}
          style={[styles.dot, { backgroundColor: colors.gold, opacity: dot }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 5, paddingVertical: 8 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
