import {
  MessageSquare,
  Monitor,
  Moon,
  Pencil,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  X,
} from 'lucide-react-native';
import React, { useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  PressableStateCallbackType,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { relativeTime } from '@/lib/format';
import { useStore } from '@/lib/store';
import type { Session } from '@/lib/types';
import { radii } from '@/theme/tokens';
import { fonts, textStyles } from '@/theme/typography';
import { useTheme } from '@/theme/ThemeProvider';
import { HilbrasMark, OmniCodeMark } from './BrandMark';
import { GoldButton } from './GoldButton';
import { Hairline } from './Hairline';
import { Entrance } from './motion';
import { PressableScale } from './ui';

interface SessionsPanelProps {
  inline?: boolean;
  onClose?: () => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onDeleted: (session: Session, index: number) => void;
}

export function SessionsPanel({
  inline = false,
  onClose,
  onNewChat,
  onOpenSettings,
  onDeleted,
}: SessionsPanelProps) {
  const { colors, mode, setMode } = useTheme();
  const { state, dispatch } = useStore();
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<Session | null>(null);
  const [renameText, setRenameText] = useState('');

  const sessions = useMemo(() => {
    const sorted = [...state.sessions].sort((a, b) => b.updatedAt - a.updatedAt);
    const q = query.trim().toLowerCase();
    if (q.length === 0) return sorted;
    return sorted.filter((session) => session.title.toLowerCase().includes(q));
  }, [state.sessions, query]);

  const cycleTheme = () => {
    const next = mode === 'dark' ? 'light' : mode === 'light' ? 'system' : 'dark';
    setMode(next);
  };

  const ThemeIcon = mode === 'dark' ? Moon : mode === 'light' ? Sun : Monitor;

  const confirmRename = () => {
    if (renaming && renameText.trim().length > 0) {
      dispatch({ type: 'renameSession', id: renaming.id, title: renameText.trim() });
    }
    setRenaming(null);
  };

  return (
    <View style={styles.panel}>
      {inline ? (
        <View style={styles.brandHeader}>
          <OmniCodeMark size={28} />
          <Text style={[textStyles.heading, { color: colors.text, fontSize: 16, flex: 1 }]}>
            OmniCode
          </Text>
        </View>
      ) : (
        <View style={styles.header}>
          <Text
            style={[textStyles.eyebrow, { color: colors.goldText, textTransform: 'uppercase', flex: 1 }]}
          >
            Sessions
          </Text>
          {onClose ? (
            <PressableScale onPress={onClose} accessibilityLabel="Close menu" hitSlop={8}>
              <X size={18} color={colors.muted} />
            </PressableScale>
          ) : null}
        </View>
      )}

      <GoldButton
        label="New chat"
        icon={<Plus size={15} color={colors.goldInk} strokeWidth={2} />}
        onPress={() => {
          onNewChat();
          onClose?.();
        }}
        style={{ marginHorizontal: 16, marginBottom: 12, alignSelf: 'stretch' }}
      />

      <View style={[styles.search, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <Search size={14} color={colors.muted} strokeWidth={1.6} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search sessions"
          placeholderTextColor={colors.muted}
          style={[styles.searchInput, { color: colors.text, fontFamily: fonts.regular }]}
        />
      </View>

      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        {sessions.length === 0 ? (
          <Text style={[textStyles.small, { color: colors.muted, padding: 16 }]}>
            {query.length > 0 ? 'No sessions match your search.' : 'No sessions yet. Start a new chat.'}
          </Text>
        ) : (
          sessions.map((session, index) => {
            const active = session.id === state.activeSessionId;
            return (
              <Entrance key={session.id} delay={Math.min(index * 50, 250)} distance={8} duration={300}>
                <Pressable
                  onPress={() => {
                    dispatch({ type: 'selectSession', id: session.id });
                    onClose?.();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Open session ${session.title}`}
                  style={({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
                    styles.row,
                    {
                      backgroundColor: active
                        ? colors.goldSoft
                        : hovered
                          ? colors.surface
                          : 'transparent',
                      borderLeftColor: active ? colors.gold : 'transparent',
                    },
                  ]}
                >
                  <MessageSquare
                    size={15}
                    color={active ? colors.goldText : colors.muted}
                    strokeWidth={1.4}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[textStyles.bodyMedium, { color: colors.text }]} numberOfLines={1}>
                      {session.title}
                    </Text>
                    <Text style={[textStyles.monoLabel, { color: colors.muted }]}>
                      {relativeTime(session.updatedAt)} · {session.messages.length} msg
                    </Text>
                  </View>
                  <PressableScale
                    onPress={() => {
                      setRenaming(session);
                      setRenameText(session.title);
                    }}
                    accessibilityLabel={`Rename ${session.title}`}
                    hitSlop={8}
                    style={styles.rowAction}
                  >
                    <Pencil size={13} color={colors.muted} strokeWidth={1.4} />
                  </PressableScale>
                  <PressableScale
                    onPress={() => {
                      const sessionIndex = state.sessions.findIndex((s) => s.id === session.id);
                      dispatch({ type: 'deleteSession', id: session.id });
                      onDeleted(session, sessionIndex);
                    }}
                    accessibilityLabel={`Delete ${session.title}`}
                    hitSlop={8}
                    style={styles.rowAction}
                  >
                    <Trash2 size={13} color={colors.muted} strokeWidth={1.4} />
                  </PressableScale>
                </Pressable>
              </Entrance>
            );
          })
        )}
      </ScrollView>

      <Hairline opacity={0.3} />
      <View style={styles.footer}>
        <PressableScale
          onPress={cycleTheme}
          accessibilityRole="button"
          accessibilityLabel={`Theme: ${mode}. Tap to change.`}
          style={[styles.footerButton, { borderColor: colors.lineStrong, backgroundColor: colors.surface }]}
        >
          <ThemeIcon size={15} color={colors.goldText} strokeWidth={1.5} />
          <Text style={[textStyles.caption, { color: colors.text }]}>
            {mode === 'dark' ? 'Dark' : mode === 'light' ? 'Light' : 'System'}
          </Text>
        </PressableScale>
        <PressableScale
          onPress={() => {
            onClose?.();
            onOpenSettings();
          }}
          accessibilityRole="button"
          accessibilityLabel="Open settings"
          style={[
            styles.footerButton,
            { borderColor: colors.lineStrong, backgroundColor: colors.surface, flex: 1 },
          ]}
        >
          <Settings size={15} color={colors.goldText} strokeWidth={1.5} />
          <Text style={[textStyles.caption, { color: colors.text }]}>Settings & keys</Text>
        </PressableScale>
      </View>
      <View style={styles.brandRow}>
        <HilbrasMark size={16} />
        <Text style={[textStyles.monoLabel, { color: colors.muted }]}>
          AN ECOSYSTEM, NOT A MONOLITH.
        </Text>
      </View>

      <Modal
        visible={renaming !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenaming(null)}
      >
        <View style={[styles.renameScrim, { backgroundColor: colors.scrim }]}>
          <View
            style={[styles.renameCard, { backgroundColor: colors.surface, borderColor: colors.lineStrong }]}
          >
            <Text style={[textStyles.heading, { color: colors.text }]}>Rename session</Text>
            <TextInput
              value={renameText}
              onChangeText={setRenameText}
              autoFocus
              maxLength={80}
              style={[
                styles.renameInput,
                {
                  color: colors.text,
                  borderColor: colors.lineStrong,
                  backgroundColor: colors.bgSoft,
                  fontFamily: fonts.regular,
                },
              ]}
              onSubmitEditing={confirmRename}
            />
            <View style={styles.renameActions}>
              <GoldButton label="Cancel" variant="ghost" small onPress={() => setRenaming(null)} />
              <GoldButton label="Save" small onPress={confirmRename} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1 },
  brandHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: radii.button,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 8,
  },
  list: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderLeftWidth: 2,
  },
  rowAction: {
    padding: 4,
  },
  footer: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  footerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: radii.button,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  renameScrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  renameCard: {
    alignSelf: 'stretch',
    maxWidth: 420,
    width: '100%',
    borderWidth: 1,
    borderRadius: radii.card,
    padding: 18,
    gap: 14,
  },
  renameInput: {
    borderWidth: 1,
    borderRadius: radii.button,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  renameActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
});
