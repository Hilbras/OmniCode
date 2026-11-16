import {
  ChevronDown,
  Database,
  FileText,
  Globe,
  Link2,
  Terminal,
} from 'lucide-react-native';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDuration } from '@/lib/format';
import type { ToolCall, ToolName } from '@/lib/types';
import { radii } from '@/theme/tokens';
import { textStyles } from '@/theme/typography';
import { useTheme } from '@/theme/ThemeProvider';
import { Entrance } from './motion';
import { StatusPill } from './StatusPill';

const toolMeta: Record<ToolName, { label: string; icon: typeof Globe }> = {
  web_search: { label: 'web_search', icon: Globe },
  read_url: { label: 'read_url', icon: Link2 },
  read_file: { label: 'read_file', icon: FileText },
  run_code: { label: 'run_code', icon: Terminal },
  memory_save: { label: 'memory_save', icon: Database },
};

export function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const meta = toolMeta[toolCall.tool];
  const Icon = meta.icon;

  const pill =
    toolCall.status === 'running' ? (
      <StatusPill label="running" tone="dashed" pulse />
    ) : toolCall.status === 'done' ? (
      <StatusPill label="done" tone="success" />
    ) : toolCall.status === 'denied' ? (
      <StatusPill label="denied" tone="danger" />
    ) : (
      <StatusPill label="stopped" tone="muted" />
    );

  return (
    <Pressable
      onPress={() => setExpanded((value) => !value)}
      accessibilityRole="button"
      accessibilityLabel={`${meta.label} ${toolCall.status}. Tap to ${expanded ? 'collapse' : 'expand'}.`}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }]}
    >
      <View style={styles.header}>
        <View style={[styles.iconTile, { backgroundColor: colors.goldSoft }]}>
          {toolCall.status === 'running' ? (
            <ActivityIndicator size="small" color={colors.goldText} />
          ) : (
            <Icon size={15} color={colors.goldText} strokeWidth={1.4} />
          )}
        </View>
        <View style={styles.headerText}>
          <Text style={[textStyles.mono, { color: colors.text }]}>{meta.label}</Text>
          {toolCall.durationMs !== undefined && toolCall.status === 'done' ? (
            <Text style={[textStyles.monoLabel, { color: colors.muted }]}>
              {formatDuration(toolCall.durationMs)}
            </Text>
          ) : null}
        </View>
        {pill}
        <ChevronDown
          size={14}
          color={colors.muted}
          style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
        />
      </View>
      {expanded ? (
        <Entrance distance={6} duration={220}>
          <View style={[styles.detail, { borderTopColor: colors.line }]}>
            {Object.entries(toolCall.args).map(([key, value]) => (
              <View key={key} style={styles.argRow}>
                <Text style={[textStyles.monoSmall, { color: colors.muted }]}>{key}</Text>
                <Text style={[textStyles.monoSmall, { color: colors.text, flex: 1 }]} numberOfLines={3}>
                  {value}
                </Text>
              </View>
            ))}
            {toolCall.result ? (
              <Text style={[textStyles.monoSmall, { color: colors.goldText, marginTop: 4 }]}>
                {toolCall.result}
              </Text>
            ) : null}
          </View>
        </Entrance>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: radii.panel,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  iconTile: {
    width: 28,
    height: 28,
    borderRadius: radii.quiet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 2 },
  detail: {
    borderTopWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
  },
  argRow: { flexDirection: 'row', gap: 10 },
});
