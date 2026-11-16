import { useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuroraGlow } from '@/components/AuroraGlow';
import { ChatHeader } from '@/components/ChatHeader';
import { Composer } from '@/components/Composer';
import { EmptyState } from '@/components/EmptyState';
import { MessageItem } from '@/components/MessageItem';
import { ModelSheet } from '@/components/ModelSheet';
import { ParticleField } from '@/components/ParticleField';
import { SessionsDrawer } from '@/components/SessionsDrawer';
import { SessionsPanel } from '@/components/SessionsPanel';
import { Snackbar, SnackbarData } from '@/components/Snackbar';
import { useAgentRunner } from '@/hooks/useAgentRunner';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { activeSession, createSession } from '@/lib/state';
import { useStore } from '@/lib/store';
import type { Session } from '@/lib/types';
import { useTheme } from '@/theme/ThemeProvider';

export default function ChatScreen() {
  const { colors } = useTheme();
  const { state, dispatch } = useStore();
  const { isDesktop } = useBreakpoint();
  const router = useRouter();
  const runner = useAgentRunner();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<SnackbarData | null>(null);

  const session = activeSession(state);
  const messages = useMemo(() => session?.messages ?? [], [session]);
  const inverted = useMemo(() => [...messages].reverse(), [messages]);

  const newChat = useCallback(() => {
    const fresh = createSession(state.settings.providerId, state.settings.model);
    dispatch({ type: 'newSession', session: fresh });
  }, [dispatch, state.settings.providerId, state.settings.model]);

  const handleDeleted = useCallback(
    (deleted: Session, index: number) => {
      setSnackbar({
        message: `Deleted “${deleted.title}”`,
        actionLabel: 'Undo',
        onAction: () => dispatch({ type: 'restoreSession', session: deleted, index }),
      });
    },
    [dispatch],
  );

  const openSettings = useCallback(() => router.push('/settings'), [router]);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['left', 'right', 'bottom']}>
      <ParticleField />
      <AuroraGlow height={280} />
      <View style={styles.shell}>
        {isDesktop ? (
          <View
            style={[
              styles.sidebar,
              { backgroundColor: colors.bgSoft, borderRightColor: colors.line },
            ]}
          >
            <SafeAreaView edges={['top']} style={{ flex: 1 }}>
              <SessionsPanel
                inline
                onNewChat={newChat}
                onOpenSettings={openSettings}
                onDeleted={handleDeleted}
              />
            </SafeAreaView>
          </View>
        ) : null}
        <View style={styles.main}>
          <ChatHeader
            showMenu={!isDesktop}
            onOpenDrawer={() => setDrawerOpen(true)}
            onNewChat={newChat}
            onOpenModels={() => setModelsOpen(true)}
          />
          <KeyboardAvoidingView
            style={styles.body}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={0}
          >
            {messages.length === 0 ? (
              <EmptyState onPrompt={(prompt) => runner.send(prompt)} />
            ) : (
              <FlatList
                key={session?.id ?? 'none'}
                data={inverted}
                inverted
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <MessageItem message={item} onResolveApproval={runner.resolveApproval} />
                )}
                contentContainerStyle={styles.listContent}
                style={styles.list}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
              />
            )}
            <View style={styles.composerWidth}>
              <Composer running={runner.running} onSend={runner.send} onStop={runner.stop} />
            </View>
          </KeyboardAvoidingView>
        </View>
      </View>
      {!isDesktop ? (
        <SessionsDrawer
          visible={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          onNewChat={newChat}
          onOpenSettings={openSettings}
          onDeleted={handleDeleted}
        />
      ) : null}
      <ModelSheet visible={modelsOpen} onClose={() => setModelsOpen(false)} />
      <Snackbar data={snackbar} onDismiss={() => setSnackbar(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  shell: { flex: 1, flexDirection: 'row' },
  sidebar: {
    width: 300,
    borderRightWidth: 1,
    paddingTop: 16,
    paddingBottom: 12,
  },
  main: { flex: 1, minWidth: 0 },
  body: { flex: 1 },
  list: {
    width: '100%',
    maxWidth: 820,
    alignSelf: 'center',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 20,
    gap: 24,
  },
  composerWidth: {
    width: '100%',
    maxWidth: 820,
    alignSelf: 'center',
  },
});
