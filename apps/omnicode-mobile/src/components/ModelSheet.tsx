import { Check, Cpu } from 'lucide-react-native';
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { providerInfo } from '@/lib/providers';
import { useStore } from '@/lib/store';
import { radii } from '@/theme/tokens';
import { fonts, textStyles } from '@/theme/typography';
import { useTheme } from '@/theme/ThemeProvider';
import { GoldButton } from './GoldButton';
import { Hairline } from './Hairline';
import { PressableScale } from './ui';

interface ModelSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function ModelSheet({ visible, onClose }: ModelSheetProps) {
  const { colors } = useTheme();
  const { state, dispatch } = useStore();
  const insets = useSafeAreaInsets();
  const info = providerInfo(state.settings.providerId);
  const [customModel, setCustomModel] = useState('');

  const select = (model: string) => {
    dispatch({ type: 'updateSettings', patch: { model } });
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.wrap}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: colors.scrim }]} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.bgSoft,
              borderColor: colors.line,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          <View style={[styles.grabber, { backgroundColor: colors.lineStrong }]} />
          <View style={styles.header}>
            <View style={[styles.iconTile, { backgroundColor: colors.goldSoft }]}>
              <Cpu size={16} color={colors.goldText} strokeWidth={1.4} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[textStyles.heading, { color: colors.text }]}>Model</Text>
              <Text style={[textStyles.monoLabel, { color: colors.muted, textTransform: 'uppercase' }]}>
                {info.label} · BYOK
              </Text>
            </View>
          </View>
          <Hairline opacity={0.3} />
          <ScrollView style={{ maxHeight: 320 }}>
            {info.models.map((model) => {
              const selected = model === state.settings.model;
              return (
                <PressableScale
                  key={model}
                  onPress={() => select(model)}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${model}`}
                  style={[
                    styles.row,
                    {
                      backgroundColor: selected ? colors.goldSoft : 'transparent',
                      borderColor: selected ? colors.goldBorder : 'transparent',
                    },
                  ]}
                >
                  <Text style={[textStyles.mono, { color: colors.text, flex: 1 }]}>{model}</Text>
                  {selected ? <Check size={15} color={colors.goldText} strokeWidth={2} /> : null}
                </PressableScale>
              );
            })}
          </ScrollView>
          {state.settings.providerId === 'custom' ? (
            <View style={styles.customRow}>
              <TextInput
                value={customModel}
                onChangeText={setCustomModel}
                placeholder="model-name"
                placeholderTextColor={colors.muted}
                style={[
                  styles.customInput,
                  { color: colors.text, borderColor: colors.lineStrong, backgroundColor: colors.surface, fontFamily: fonts.mono },
                ]}
              />
              <GoldButton
                label="Use"
                small
                disabled={customModel.trim().length === 0}
                onPress={() => select(customModel.trim())}
              />
            </View>
          ) : null}
          <Text style={[textStyles.caption, { color: colors.muted, paddingHorizontal: 20 }]}>
            Requests go straight from this device to {info.label} with your key. No middle server.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopWidth: 1,
    borderTopLeftRadius: radii.card,
    borderTopRightRadius: radii.card,
    paddingTop: 10,
    gap: 12,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: radii.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 12,
    marginVertical: 2,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: radii.button,
    borderWidth: 1,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
  },
  customInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: radii.button,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
});
