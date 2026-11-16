import { FileText, Square } from 'lucide-react-native';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { clockTime, formatBytes } from '@/lib/format';
import type { Message } from '@/lib/types';
import { radii } from '@/theme/tokens';
import { textStyles } from '@/theme/typography';
import { useTheme } from '@/theme/ThemeProvider';
import { ApprovalCard } from './ApprovalCard';
import { OmniCodeMark } from './BrandMark';
import { Markdown } from './Markdown';
import { BlinkingCaret, Entrance } from './motion';
import { ToolCallCard } from './ToolCallCard';
import { TypingDots } from './TypingDots';

interface MessageItemProps {
  message: Message;
  onResolveApproval: (messageId: string, approvalId: string, allowed: boolean) => void;
}

export function MessageItem({ message, onResolveApproval }: MessageItemProps) {
  const { colors } = useTheme();
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <Entrance distance={10} duration={300}>
        <View style={styles.userWrap}>
          {message.attachments && message.attachments.length > 0 ? (
            <View style={styles.attachments}>
              {message.attachments.map((attachment) => (
                <View
                  key={attachment.id}
                  style={[styles.attachment, { backgroundColor: colors.surface2, borderColor: colors.line }]}
                >
                  <FileText size={13} color={colors.goldText} strokeWidth={1.4} />
                  <Text style={[textStyles.caption, { color: colors.text }]} numberOfLines={1}>
                    {attachment.name}
                  </Text>
                  {attachment.size !== undefined ? (
                    <Text style={[textStyles.monoLabel, { color: colors.muted }]}>
                      {formatBytes(attachment.size)}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
          {message.text.length > 0 ? (
            <View
              style={[
                styles.userBubble,
                { backgroundColor: colors.goldSoft, borderColor: colors.goldBorder },
              ]}
            >
              <Text style={[textStyles.body, { color: colors.text }]}>{message.text}</Text>
            </View>
          ) : null}
          <Text style={[textStyles.monoLabel, { color: colors.muted, textAlign: 'right' }]}>
            {clockTime(message.createdAt)}
          </Text>
        </View>
      </Entrance>
    );
  }

  const thinking = message.streaming && message.text.length === 0 && message.toolCalls.length === 0;

  return (
    <Entrance distance={12} duration={340}>
      <View style={styles.agentWrap}>
        <View style={styles.agentHeader}>
          <OmniCodeMark size={22} />
          <Text style={[textStyles.eyebrow, { color: colors.goldText, textTransform: 'uppercase' }]}>
            OmniCode
          </Text>
          <Text style={[textStyles.monoLabel, { color: colors.muted }]}>
            {clockTime(message.createdAt)}
          </Text>
        </View>
        {message.toolCalls.length > 0 ? (
          <View style={styles.tools}>
            {message.toolCalls.map((toolCall) => (
              <ToolCallCard key={toolCall.id} toolCall={toolCall} />
            ))}
          </View>
        ) : null}
        {message.approval ? (
          <ApprovalCard
            approval={message.approval}
            onResolve={(allowed) => onResolveApproval(message.id, message.approval!.id, allowed)}
          />
        ) : null}
        {thinking ? <TypingDots /> : null}
        {message.text.length > 0 ? (
          <View>
            <Markdown text={message.text} />
            {message.streaming ? <BlinkingCaret color={colors.gold} /> : null}
          </View>
        ) : null}
        {message.stopped ? (
          <View style={styles.stoppedRow}>
            <Square size={10} color={colors.muted} fill={colors.muted} />
            <Text style={[textStyles.monoLabel, { color: colors.muted }]}>STOPPED</Text>
          </View>
        ) : null}
      </View>
    </Entrance>
  );
}

const styles = StyleSheet.create({
  userWrap: {
    alignItems: 'flex-end',
    gap: 6,
    paddingLeft: 48,
  },
  userBubble: {
    borderWidth: 1,
    borderRadius: radii.card,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: 560,
  },
  attachments: { gap: 6, alignItems: 'flex-end' },
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: radii.quiet,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: 260,
  },
  agentWrap: {
    gap: 10,
    paddingRight: 12,
  },
  agentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tools: { gap: 8 },
  stoppedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
