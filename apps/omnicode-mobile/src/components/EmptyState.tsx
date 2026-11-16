import { ArrowUpRight, FileText, Globe, Terminal } from 'lucide-react-native';
import React from 'react';
import { PressableStateCallbackType, StyleSheet, Text, View } from 'react-native';
import { radii } from '@/theme/tokens';
import { textStyles } from '@/theme/typography';
import { useTheme } from '@/theme/ThemeProvider';
import { OmniCodeMark } from './BrandMark';
import { Hairline } from './Hairline';
import { Entrance } from './motion';
import { PressableScale } from './ui';

const suggestions = [
  { icon: Globe, label: 'Research something live', prompt: 'Research the best on-device vector databases for a mobile app' },
  { icon: Terminal, label: 'Run code in the sandbox', prompt: 'Write and run a function that finds two numbers summing to a target' },
  { icon: FileText, label: 'Summarize a document', prompt: 'Read my quarterly report and give me the honest summary' },
];

export function EmptyState({ onPrompt }: { onPrompt: (prompt: string) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.wrap}>
      <Entrance delay={0} distance={16} duration={500}>
        <OmniCodeMark size={72} />
      </Entrance>
      <Entrance delay={120} distance={18} duration={520} style={styles.titleWrap}>
        <Text style={[textStyles.display, { color: colors.text, textAlign: 'center' }]}>
          What shall we{'\n'}
          <Text style={{ color: colors.goldText }}>build?</Text>
        </Text>
        <Text style={[textStyles.body, { color: colors.muted, textAlign: 'center' }]}>
          Your agent, your keys, your device. Ask anything — tools run only with your permission.
        </Text>
      </Entrance>
      <Entrance delay={240} distance={10} duration={420} style={{ width: 120 }}>
        <Hairline />
      </Entrance>
      <View style={styles.cards}>
        {suggestions.map((suggestion, index) => {
          const Icon = suggestion.icon;
          return (
            <Entrance key={suggestion.label} delay={320 + index * 90} distance={14} duration={420}>
              <PressableScale
                onPress={() => onPrompt(suggestion.prompt)}
                accessibilityRole="button"
                accessibilityLabel={suggestion.label}
                style={({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
                  styles.card,
                  {
                    backgroundColor: colors.surface,
                    borderColor: hovered ? colors.goldBorder : colors.line,
                    transform: [{ translateY: hovered ? -1 : 0 }],
                  },
                ]}
              >
                <View style={[styles.iconTile, { backgroundColor: colors.goldSoft }]}>
                  <Icon size={16} color={colors.goldText} strokeWidth={1.4} />
                </View>
                <Text style={[textStyles.bodyMedium, { color: colors.text, flex: 1 }]}>
                  {suggestion.label}
                </Text>
                <ArrowUpRight size={15} color={colors.muted} strokeWidth={1.6} />
              </PressableScale>
            </Entrance>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
    paddingHorizontal: 28,
    paddingBottom: 40,
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  },
  titleWrap: { gap: 12, alignItems: 'center' },
  cards: { alignSelf: 'stretch', gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: radii.card,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  iconTile: {
    width: 34,
    height: 34,
    borderRadius: radii.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
