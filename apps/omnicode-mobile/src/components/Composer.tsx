import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { ArrowUp, CheckCircle2, FileText, Plus, Square, X } from 'lucide-react-native';
import React, { useState } from 'react';
import {
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { uid } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { Attachment } from '@/lib/types';
import { radii } from '@/theme/tokens';
import { fonts, textStyles } from '@/theme/typography';
import { useTheme } from '@/theme/ThemeProvider';
import { PressableScale } from './ui';

interface ComposerProps {
  running: boolean;
  onSend: (text: string, attachments: Attachment[]) => void;
  onStop: () => void;
}

export function Composer({ running, onSend, onStop }: ComposerProps) {
  const { colors } = useTheme();
  const { state } = useStore();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [focused, setFocused] = useState(false);

  const canSend = (text.trim().length > 0 || attachments.length > 0) && !running;

  const submit = () => {
    if (!canSend) return;
    if (state.settings.haptics) {
      Haptics.selectionAsync().catch(() => undefined);
    }
    onSend(text, attachments);
    setText('');
    setAttachments([]);
  };

  const pickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      setAttachments((prev) => [
        ...prev,
        { id: uid('att'), name: asset.name, size: asset.size ?? undefined },
      ]);
    } catch {
      // picker dismissed or unavailable; nothing to attach
    }
  };

  return (
    <View style={[styles.wrap, { backgroundColor: colors.glass, borderTopColor: colors.line }]}>
      {attachments.length > 0 ? (
        <View style={styles.chips}>
          {attachments.map((attachment) => (
            <View
              key={attachment.id}
              style={[styles.chip, { backgroundColor: colors.surface2, borderColor: colors.lineStrong }]}
            >
              <FileText size={12} color={colors.goldText} strokeWidth={1.4} />
              <Text style={[textStyles.caption, { color: colors.text, maxWidth: 160 }]} numberOfLines={1}>
                {attachment.name}
              </Text>
              <PressableScale
                onPress={() => setAttachments((prev) => prev.filter((a) => a.id !== attachment.id))}
                accessibilityLabel={`Remove ${attachment.name}`}
                hitSlop={8}
              >
                <X size={12} color={colors.muted} />
              </PressableScale>
            </View>
          ))}
        </View>
      ) : null}
      <View
        style={[
          styles.inputRow,
          {
            backgroundColor: colors.surface,
            borderColor: focused ? colors.goldBorder : colors.lineStrong,
          },
        ]}
      >
        <PressableScale
          onPress={pickDocument}
          accessibilityRole="button"
          accessibilityLabel="Attach a document"
          style={styles.attachButton}
          hitSlop={8}
        >
          <Plus size={20} color={colors.muted} strokeWidth={1.6} />
        </PressableScale>
        <TextInput
          value={text}
          onChangeText={setText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="Ask anything, or give the agent a task…"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={4000}
          style={[
            styles.input,
            { color: colors.text, fontFamily: fonts.regular },
          ]}
          onSubmitEditing={() => {
            if (Platform.OS !== 'web') Keyboard.dismiss();
          }}
          blurOnSubmit={false}
        />
        {running ? (
          <PressableScale
            onPress={onStop}
            accessibilityRole="button"
            accessibilityLabel="Stop the agent"
            style={[styles.sendButton, { backgroundColor: colors.surface2, borderColor: colors.lineStrong }]}
          >
            <Square size={14} color={colors.danger} fill={colors.danger} />
          </PressableScale>
        ) : (
          <PressableScale
            onPress={submit}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel="Send message"
            style={[
              styles.sendButton,
              {
                backgroundColor: canSend ? colors.gold : colors.surface2,
                borderColor: canSend ? colors.goldBorder : colors.line,
                opacity: canSend ? 1 : 0.6,
              },
            ]}
          >
            <ArrowUp size={18} color={canSend ? colors.goldInk : colors.muted} strokeWidth={2} />
          </PressableScale>
        )}
      </View>
      <View style={styles.assurance}>
        <CheckCircle2 size={11} color={colors.goldText} strokeWidth={1.6} />
        <Text style={[textStyles.monoLabel, { color: colors.muted, textTransform: 'uppercase' }]}>
          BYOK · on-device · nothing leaves without permission
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    gap: 8,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 6,
  },
  attachButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    fontSize: 15,
    lineHeight: 21,
    maxHeight: 120,
    minHeight: 34,
    paddingVertical: 6,
  },
  sendButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assurance: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
});
