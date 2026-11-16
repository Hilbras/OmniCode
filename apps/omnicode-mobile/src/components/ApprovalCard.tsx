import { ShieldCheck } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { Approval } from '@/lib/types';
import { radii } from '@/theme/tokens';
import { textStyles } from '@/theme/typography';
import { useTheme } from '@/theme/ThemeProvider';
import { GoldButton } from './GoldButton';
import { Entrance } from './motion';

interface ApprovalCardProps {
  approval: Approval;
  onResolve: (allowed: boolean) => void;
}

export function ApprovalCard({ approval, onResolve }: ApprovalCardProps) {
  const { colors } = useTheme();
  if (approval.status !== 'pending') return null;

  return (
    <Entrance distance={10} duration={300}>
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.goldBorder,
          shadowColor: colors.gold,
          shadowOpacity: 0.18,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 4 },
          elevation: 4,
        },
      ]}
      accessibilityRole="alert"
    >
      <View style={styles.header}>
        <View style={[styles.iconTile, { backgroundColor: colors.goldSoft }]}>
          <ShieldCheck size={16} color={colors.goldText} strokeWidth={1.4} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[textStyles.eyebrow, { color: colors.goldText, textTransform: 'uppercase' }]}>
            Permission required
          </Text>
          <Text style={[textStyles.mono, { color: colors.text, marginTop: 2 }]}>
            {approval.tool}
          </Text>
        </View>
      </View>
      <View style={[styles.args, { backgroundColor: colors.bgSoft, borderColor: colors.line }]}>
        {Object.entries(approval.args).map(([key, value]) => (
          <View key={key} style={styles.argRow}>
            <Text style={[textStyles.monoSmall, { color: colors.muted }]}>{key}</Text>
            <Text style={[textStyles.monoSmall, { color: colors.text, flex: 1 }]} numberOfLines={2}>
              {value}
            </Text>
          </View>
        ))}
      </View>
      <Text style={[textStyles.caption, { color: colors.muted }]}>
        The agent wants to use a tool on your behalf. Nothing runs without your say-so.
      </Text>
      <View style={styles.actions}>
        <GoldButton label="Allow" onPress={() => onResolve(true)} small />
        <GoldButton label="Deny" variant="ghost" onPress={() => onResolve(false)} small />
      </View>
    </View>
    </Entrance>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radii.card,
    padding: 14,
    gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: radii.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  args: {
    borderWidth: 1,
    borderRadius: radii.quiet,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  argRow: { flexDirection: 'row', gap: 10 },
  actions: { flexDirection: 'row', gap: 8 },
});
