import * as Clipboard from 'expo-clipboard';
import {
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Cpu,
  Download,
  Eye,
  EyeOff,
  Gem,
  KeyRound,
  Monitor,
  Moon,
  Server,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Linking,
  Modal,
  ScrollView,
  Share,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuroraGlow } from '@/components/AuroraGlow';
import { HilbrasMark, OmniCodeMark } from '@/components/BrandMark';
import { GoldButton } from '@/components/GoldButton';
import { Hairline } from '@/components/Hairline';
import { ModelSheet } from '@/components/ModelSheet';
import { Entrance } from '@/components/motion';
import { StatusPill } from '@/components/StatusPill';
import { PressableScale } from '@/components/ui';
import { providerInfo, providers, defaultModel } from '@/lib/providers';
import { deleteApiKey, loadApiKey, saveApiKey } from '@/lib/secure';
import { useStore } from '@/lib/store';
import type { ProviderId } from '@/lib/types';
import { radii } from '@/theme/tokens';
import { fonts, textStyles } from '@/theme/typography';
import { ThemeMode, useTheme } from '@/theme/ThemeProvider';

const providerIcons: Record<ProviderId, typeof Sparkles> = {
  openai: Sparkles,
  anthropic: Bot,
  google: Gem,
  custom: Server,
};

function Section({
  title,
  children,
  delay = 0,
}: {
  title: string;
  children: React.ReactNode;
  delay?: number;
}) {
  const { colors } = useTheme();
  return (
    <Entrance delay={delay} distance={12} duration={380}>
      <View style={styles.section}>
        <Text style={[textStyles.eyebrow, { color: colors.goldText, textTransform: 'uppercase' }]}>
          {title}
        </Text>
        {children}
      </View>
    </Entrance>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      {children}
    </View>
  );
}

function SwitchRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.switchRow}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[textStyles.bodyMedium, { color: colors.text }]}>{label}</Text>
        <Text style={[textStyles.caption, { color: colors.muted }]}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.lineStrong, true: colors.gold }}
        thumbColor={colors.surface}
        ios_backgroundColor={colors.lineStrong}
        accessibilityLabel={label}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const { colors, mode, setMode } = useTheme();
  const { state, dispatch } = useStore();
  const router = useRouter();
  const info = providerInfo(state.settings.providerId);

  const [apiKey, setApiKey] = useState('');
  const [savedKey, setSavedKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [keyStatus, setKeyStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [modelsOpen, setModelsOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [baseUrl, setBaseUrl] = useState(state.settings.customBaseUrl);

  useEffect(() => {
    let cancelled = false;
    loadApiKey(state.settings.providerId)
      .then((key) => {
        if (cancelled) return;
        setApiKey(key);
        setSavedKey(key);
        setKeyStatus('idle');
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [state.settings.providerId]);

  const selectProvider = (id: ProviderId) => {
    dispatch({
      type: 'updateSettings',
      patch: { providerId: id, model: defaultModel(id) },
    });
  };

  const persistKey = async () => {
    setKeyStatus('saving');
    try {
      if (apiKey.trim().length === 0) {
        await deleteApiKey(state.settings.providerId);
        setSavedKey('');
      } else {
        await saveApiKey(state.settings.providerId, apiKey.trim());
        setSavedKey(apiKey.trim());
      }
      setKeyStatus('saved');
    } catch {
      setKeyStatus('idle');
    }
  };

  const pasteKey = async () => {
    try {
      const text = await Clipboard.getStringAsync();
      if (text) setApiKey(text.trim());
    } catch {
      // clipboard unavailable
    }
  };

  const exportSessions = useCallback(async () => {
    try {
      await Share.share({
        title: 'OmniCode sessions',
        message: JSON.stringify(state.sessions, null, 2),
      });
    } catch {
      // share dismissed
    }
  }, [state.sessions]);

  const clearAll = () => {
    dispatch({ type: 'clearAll' });
    setConfirmClear(false);
    router.back();
  };

  const themeOptions: { value: ThemeMode; label: string; icon: typeof Moon }[] = [
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  const keyDirty = apiKey.trim() !== savedKey;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: colors.bg }]} edges={['top', 'left', 'right', 'bottom']}>
      <AuroraGlow height={220} />
      <View style={[styles.header, { borderBottomColor: colors.line }]}>
        <PressableScale
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to chat"
          style={styles.backButton}
          hitSlop={8}
        >
          <ChevronLeft size={22} color={colors.text} strokeWidth={1.6} />
        </PressableScale>
        <Text style={[textStyles.heading, { color: colors.text, flex: 1 }]}>Settings</Text>
        <OmniCodeMark size={26} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Section title="Model provider">
          <View style={styles.providerGrid}>
            {providers.map((provider) => {
              const Icon = providerIcons[provider.id];
              const selected = provider.id === state.settings.providerId;
              return (
                <PressableScale
                  key={provider.id}
                  onPress={() => selectProvider(provider.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${provider.label}`}
                  style={[
                    styles.providerCard,
                    {
                      backgroundColor: selected ? colors.goldSoft : colors.surface,
                      borderColor: selected ? colors.goldBorder : colors.line,
                    },
                  ]}
                >
                  <View style={[styles.providerIcon, { backgroundColor: colors.goldSoft }]}>
                    <Icon size={17} color={colors.goldText} strokeWidth={1.4} />
                  </View>
                  <Text style={[textStyles.bodyMedium, { color: colors.text }]}>{provider.label}</Text>
                  <Text style={[textStyles.monoLabel, { color: colors.muted }]}>
                    {provider.tagline.toUpperCase()}
                  </Text>
                  {selected ? (
                    <View style={[styles.checkBadge, { backgroundColor: colors.gold }]}>
                      <Check size={10} color={colors.goldInk} strokeWidth={3} />
                    </View>
                  ) : null}
                </PressableScale>
              );
            })}
          </View>
        </Section>

        <Section title="API key">
          <Card>
            <View style={styles.keyHeader}>
              <KeyRound size={15} color={colors.goldText} strokeWidth={1.4} />
              <Text style={[textStyles.bodyMedium, { color: colors.text, flex: 1 }]}>
                {info.label} key
              </Text>
              {savedKey.length > 0 ? (
                <StatusPill label="stored on device" tone="success" />
              ) : (
                <StatusPill label="not set" tone="muted" />
              )}
            </View>
            <View style={[styles.keyInputRow, { borderColor: colors.lineStrong, backgroundColor: colors.bgSoft }]}>
              <TextInput
                value={apiKey}
                onChangeText={setApiKey}
                placeholder={info.keyPlaceholder}
                placeholderTextColor={colors.muted}
                secureTextEntry={!showKey}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.keyInput, { color: colors.text, fontFamily: fonts.mono }]}
                accessibilityLabel={`${info.label} API key`}
              />
              <PressableScale
                onPress={() => setShowKey((value) => !value)}
                accessibilityLabel={showKey ? 'Hide key' : 'Show key'}
                hitSlop={8}
                style={styles.keyAction}
              >
                {showKey ? <EyeOff size={16} color={colors.muted} /> : <Eye size={16} color={colors.muted} />}
              </PressableScale>
              <PressableScale
                onPress={pasteKey}
                accessibilityLabel="Paste key from clipboard"
                hitSlop={8}
                style={styles.keyAction}
              >
                <ClipboardPaste size={16} color={colors.muted} />
              </PressableScale>
            </View>
            {state.settings.providerId === 'custom' ? (
              <TextInput
                value={baseUrl}
                onChangeText={(text) => {
                  setBaseUrl(text);
                  dispatch({ type: 'updateSettings', patch: { customBaseUrl: text } });
                }}
                placeholder="https://your-endpoint.example/v1"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={[
                  styles.baseUrlInput,
                  { color: colors.text, borderColor: colors.lineStrong, backgroundColor: colors.bgSoft, fontFamily: fonts.mono },
                ]}
                accessibilityLabel="Custom base URL"
              />
            ) : null}
            <View style={styles.keyActions}>
              <GoldButton
                label={keyStatus === 'saved' && !keyDirty ? 'Saved' : 'Save key'}
                onPress={persistKey}
                loading={keyStatus === 'saving'}
                disabled={!keyDirty}
                small
                icon={
                  keyStatus === 'saved' && !keyDirty ? (
                    <Check size={13} color={colors.goldInk} strokeWidth={2.5} />
                  ) : undefined
                }
              />
              {info.docsUrl.length > 0 ? (
                <GoldButton
                  label="Get a key"
                  variant="quiet"
                  small
                  onPress={() => Linking.openURL(info.docsUrl).catch(() => undefined)}
                />
              ) : null}
            </View>
            <Text style={[textStyles.caption, { color: colors.muted }]}>
              Stored in the device secure enclave. Sent only to {info.label} when the agent runs — never to us.
            </Text>
          </Card>
        </Section>

        <Section title="Model">
          <Card>
            <PressableScale
              onPress={() => setModelsOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Current model ${state.settings.model}. Tap to change.`}
              style={styles.modelRow}
            >
              <Cpu size={15} color={colors.goldText} strokeWidth={1.4} />
              <Text style={[textStyles.mono, { color: colors.text, flex: 1 }]}>
                {state.settings.model}
              </Text>
              <ChevronRight size={15} color={colors.muted} />
            </PressableScale>
          </Card>
        </Section>

        <Section title="Appearance">
          <Card>
            <View style={styles.segmentRow}>
              {themeOptions.map((option) => {
                const Icon = option.icon;
                const selected = mode === option.value;
                return (
                  <PressableScale
                    key={option.value}
                    onPress={() => setMode(option.value)}
                    accessibilityRole="button"
                    accessibilityLabel={`${option.label} theme`}
                    style={[
                      styles.segment,
                      {
                        backgroundColor: selected ? colors.goldSoft : 'transparent',
                        borderColor: selected ? colors.goldBorder : 'transparent',
                      },
                    ]}
                  >
                    <Icon size={14} color={selected ? colors.goldText : colors.muted} strokeWidth={1.5} />
                    <Text
                      style={[textStyles.caption, { color: selected ? colors.goldText : colors.muted }]}
                    >
                      {option.label}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
          </Card>
        </Section>

        <Section title="Behavior">
          <Card>
            <SwitchRow
              label="Stream responses"
              hint="Show tokens as they arrive"
              value={state.settings.streaming}
              onChange={(value) => dispatch({ type: 'updateSettings', patch: { streaming: value } })}
            />
            <Hairline opacity={0.2} />
            <SwitchRow
              label="Haptics"
              hint="Subtle feedback on send, approve, done"
              value={state.settings.haptics}
              onChange={(value) => dispatch({ type: 'updateSettings', patch: { haptics: value } })}
            />
            <Hairline opacity={0.2} />
            <SwitchRow
              label="Ambient background"
              hint="Gold particle constellation"
              value={state.settings.ambient}
              onChange={(value) => dispatch({ type: 'updateSettings', patch: { ambient: value } })}
            />
          </Card>
        </Section>

        <Section title="Data">
          <Card>
            <PressableScale
              onPress={exportSessions}
              accessibilityRole="button"
              accessibilityLabel="Export all sessions as JSON"
              style={styles.dataRow}
            >
              <Download size={15} color={colors.goldText} strokeWidth={1.4} />
              <View style={{ flex: 1 }}>
                <Text style={[textStyles.bodyMedium, { color: colors.text }]}>Export sessions</Text>
                <Text style={[textStyles.caption, { color: colors.muted }]}>
                  {state.sessions.length} sessions · JSON via share sheet
                </Text>
              </View>
            </PressableScale>
            <Hairline opacity={0.2} />
            <PressableScale
              onPress={() => setConfirmClear(true)}
              accessibilityRole="button"
              accessibilityLabel="Clear all sessions"
              style={styles.dataRow}
            >
              <Trash2 size={15} color={colors.danger} strokeWidth={1.4} />
              <View style={{ flex: 1 }}>
                <Text style={[textStyles.bodyMedium, { color: colors.danger }]}>Clear all sessions</Text>
                <Text style={[textStyles.caption, { color: colors.muted }]}>
                  Keys and settings are kept
                </Text>
              </View>
            </PressableScale>
          </Card>
        </Section>

        <View style={styles.about}>
          <OmniCodeMark size={44} />
          <Text style={[textStyles.heading, { color: colors.text }]}>OmniCode</Text>
          <Text style={[textStyles.monoLabel, { color: colors.muted }]}>V0.1.0 · ON-DEVICE AGENT · PREVIEW</Text>
          <Hairline opacity={0.3} />
          <View style={styles.aboutBrand}>
            <HilbrasMark size={16} />
            <Text style={[textStyles.monoLabel, { color: colors.muted }]}>
              AN ECOSYSTEM, NOT A MONOLITH.
            </Text>
          </View>
        </View>
      </ScrollView>

      <ModelSheet visible={modelsOpen} onClose={() => setModelsOpen(false)} />

      <Modal visible={confirmClear} transparent animationType="fade" onRequestClose={() => setConfirmClear(false)}>
        <View style={[styles.confirmScrim, { backgroundColor: colors.scrim }]}>
          <View style={[styles.confirmCard, { backgroundColor: colors.surface, borderColor: colors.lineStrong }]}>
            <Text style={[textStyles.heading, { color: colors.text }]}>Clear all sessions?</Text>
            <Text style={[textStyles.small, { color: colors.muted }]}>
              This deletes every conversation on this device. Your API keys and settings stay. This cannot be undone.
            </Text>
            <View style={styles.confirmActions}>
              <GoldButton label="Keep" variant="ghost" small onPress={() => setConfirmClear(false)} />
              <GoldButton label="Clear all" variant="danger" small onPress={clearAll} />
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  backButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    padding: 16,
    gap: 22,
    paddingBottom: 48,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
  section: { gap: 10 },
  card: {
    borderWidth: 1,
    borderRadius: radii.card,
    padding: 14,
    gap: 12,
  },
  providerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  providerCard: {
    width: '48%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: radii.card,
    padding: 14,
    gap: 6,
  },
  providerIcon: {
    width: 34,
    height: 34,
    borderRadius: radii.panel,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  checkBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  keyInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radii.button,
    paddingHorizontal: 10,
  },
  keyInput: {
    flex: 1,
    fontSize: 13,
    paddingVertical: 10,
  },
  keyAction: { padding: 6 },
  baseUrlInput: {
    borderWidth: 1,
    borderRadius: radii.button,
    paddingHorizontal: 10,
    paddingVertical: 10,
    fontSize: 13,
  },
  keyActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modelRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  segmentRow: { flexDirection: 'row', gap: 6 },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radii.button,
    paddingVertical: 9,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 4,
  },
  about: {
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
  },
  aboutBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 4,
  },
  confirmScrim: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  confirmCard: {
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: radii.card,
    padding: 18,
    gap: 12,
  },
  confirmActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
});
