import React, { useEffect } from 'react';
import { Animated, Dimensions, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Session } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';
import { SessionsPanel } from './SessionsPanel';
import { USE_NATIVE_DRIVER, useAnimatedValue } from './ui';

interface SessionsDrawerProps {
  visible: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onDeleted: (session: Session, index: number) => void;
}

export function SessionsDrawer({
  visible,
  onClose,
  onNewChat,
  onOpenSettings,
  onDeleted,
}: SessionsDrawerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const translateX = useAnimatedValue(-400);
  const scrim = useAnimatedValue(0);
  const width = Math.min(Dimensions.get('window').width * 0.85, 340);

  useEffect(() => {
    if (visible) {
      translateX.setValue(-width);
      Animated.parallel([
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: USE_NATIVE_DRIVER,
          speed: 16,
          bounciness: 2,
        }),
        Animated.timing(scrim, { toValue: 1, duration: 240, useNativeDriver: USE_NATIVE_DRIVER }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateX, { toValue: -width, duration: 220, useNativeDriver: USE_NATIVE_DRIVER }),
        Animated.timing(scrim, { toValue: 0, duration: 220, useNativeDriver: USE_NATIVE_DRIVER }),
      ]).start();
    }
  }, [visible, translateX, scrim, width]);

  const swipeClose = Gesture.Pan()
    .activeOffsetX(-12)
    .onEnd((event) => {
      if (event.translationX < -60 || event.velocityX < -500) {
        onClose();
      }
    })
    .runOnJS(true);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={StyleSheet.absoluteFill}>
        <Animated.View
          style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim, opacity: scrim }]}
        >
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
        </Animated.View>
        <GestureDetector gesture={swipeClose}>
          <Animated.View
            style={[
              styles.drawer,
              {
                width,
                backgroundColor: colors.bgSoft,
                borderRightColor: colors.line,
                paddingTop: insets.top + 12,
                paddingBottom: insets.bottom + 12,
                transform: [{ translateX }],
              },
            ]}
          >
            <SessionsPanel
              onClose={onClose}
              onNewChat={onNewChat}
              onOpenSettings={onOpenSettings}
              onDeleted={onDeleted}
            />
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  drawer: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRightWidth: 1,
  },
});
