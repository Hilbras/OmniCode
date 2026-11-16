import { BlurView } from 'expo-blur';
import { ChevronDown, Menu, Plus } from 'lucide-react-native';
import React from 'react';
import { Platform, PressableStateCallbackType, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useStore } from '@/lib/store';
import { radii } from '@/theme/tokens';
import { textStyles } from '@/theme/typography';
import { useTheme } from '@/theme/ThemeProvider';
import { OmniCodeMark } from './BrandMark';
import { PressableScale } from './ui';

interface ChatHeaderProps {
  showMenu?: boolean;
  onOpenDrawer: () => void;
  onNewChat: () => void;
  onOpenModels: () => void;
}

export function ChatHeader({ showMenu = true, onOpenDrawer, onNewChat, onOpenModels }: ChatHeaderProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { state } = useStore();
  const model = state.settings.model;

  return (
    <View style={{ paddingTop: insets.top }}>
      <BlurView
        intensity={Platform.OS === 'web' ? 0 : 40}
        tint={isDark ? 'dark' : 'light'}
        style={[styles.blur, { backgroundColor: colors.glass, borderBottomColor: colors.line }]}
      >
        <View style={styles.inner}>
          {showMenu ? (
            <PressableScale
              onPress={onOpenDrawer}
              accessibilityRole="button"
              accessibilityLabel="Open sessions menu"
              style={styles.iconButton}
              hitSlop={8}
            >
              <Menu size={20} color={colors.text} strokeWidth={1.6} />
            </PressableScale>
          ) : (
            <View style={styles.iconButton} />
          )}
          <View style={styles.center}>
            {!showMenu ? <OmniCodeMark size={24} /> : null}
            <Text style={[textStyles.heading, { color: colors.text, fontSize: 15 }]}>OmniCode</Text>
            <PressableScale
              onPress={onOpenModels}
              accessibilityRole="button"
              accessibilityLabel={`Model: ${model}. Tap to change.`}
              style={({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
                styles.modelChip,
                {
                  backgroundColor: colors.goldSoft,
                  borderColor: hovered ? colors.gold : colors.goldBorder,
                },
              ]}
            >
              <Text style={[textStyles.monoLabel, { color: colors.goldText }]} numberOfLines={1}>
                {model}
              </Text>
              <ChevronDown size={11} color={colors.goldText} />
            </PressableScale>
          </View>
          <PressableScale
            onPress={onNewChat}
            accessibilityRole="button"
            accessibilityLabel="Start a new chat"
            style={styles.iconButton}
            hitSlop={8}
          >
            <Plus size={20} color={colors.text} strokeWidth={1.6} />
          </PressableScale>
        </View>
      </BlurView>
    </View>
  );
}

const styles = StyleSheet.create({
  blur: {
    height: 56,
    borderBottomWidth: 1,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    maxWidth: 820,
    alignSelf: 'center',
    paddingHorizontal: 10,
  },
  iconButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  modelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 150,
  },
});
