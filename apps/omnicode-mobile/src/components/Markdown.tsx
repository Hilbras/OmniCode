import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radii } from '@/theme/tokens';
import { fonts, textStyles, type } from '@/theme/typography';
import { useTheme } from '@/theme/ThemeProvider';

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'quote'; text: string };

function parseBlocks(source: string): Block[] {
  const lines = source.split('\n');
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim().length === 0) {
      index++;
      continue;
    }
    const fence = /^```(\w*)/.exec(line);
    if (fence) {
      const lang = fence[1] ?? '';
      const body: string[] = [];
      index++;
      while (index < lines.length && !/^```/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index++;
      }
      index++;
      blocks.push({ kind: 'code', lang, text: body.join('\n') });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length, text: heading[2] ?? '' });
      index++;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        body.push((lines[index] ?? '').replace(/^>\s?/, ''));
        index++;
      }
      blocks.push({ kind: 'quote', text: body.join(' ') });
      continue;
    }
    if (/^\s*(?:[-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (index < lines.length && /^\s*(?:[-*]|\d+\.)\s+/.test(lines[index] ?? '')) {
        items.push((lines[index] ?? '').replace(/^\s*(?:[-*]|\d+\.)\s+/, ''));
        index++;
      }
      blocks.push({ kind: 'list', ordered, items });
      continue;
    }
    const body: string[] = [line];
    index++;
    while (
      index < lines.length &&
      (lines[index] ?? '').trim().length > 0 &&
      !/^(#{1,3}\s|```|>|\s*(?:[-*]|\d+\.)\s)/.test(lines[index] ?? '')
    ) {
      body.push(lines[index] ?? '');
      index++;
    }
    blocks.push({ kind: 'paragraph', text: body.join(' ') });
  }
  return blocks;
}

function Inline({ text, color }: { text: string; color: string }) {
  const { colors } = useTheme();
  const parts = useMemo(() => text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g), [text]);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <Text key={index} style={{ fontFamily: fonts.semibold, color }}>
              {part.slice(2, -2)}
            </Text>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <Text
              key={index}
              style={{
                fontFamily: fonts.mono,
                fontSize: 13,
                color: colors.goldText,
                backgroundColor: colors.goldSoft,
              }}
            >
              {part.slice(1, -1)}
            </Text>
          );
        }
        return (
          <Text key={index} style={{ color }}>
            {part}
          </Text>
        );
      })}
    </>
  );
}

export function Markdown({ text }: { text: string }) {
  const { colors } = useTheme();
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <View style={styles.root}>
      {blocks.map((block, index) => {
        switch (block.kind) {
          case 'heading':
            return (
              <Text
                key={index}
                style={[
                  block.level === 1 ? textStyles.heading : type('semibold', 15, -0.01),
                  { color: colors.text, marginTop: index === 0 ? 0 : 6 },
                ]}
              >
                <Inline text={block.text} color={colors.text} />
              </Text>
            );
          case 'code':
            return (
              <View
                key={index}
                style={[
                  styles.codeBlock,
                  { backgroundColor: colors.bgSoft, borderColor: colors.line },
                ]}
              >
                {block.lang.length > 0 ? (
                  <Text style={[textStyles.monoLabel, { color: colors.muted, marginBottom: 6 }]}>
                    {block.lang.toUpperCase()}
                  </Text>
                ) : null}
                <Text style={[textStyles.mono, { color: colors.text }]} selectable>
                  {block.text}
                </Text>
              </View>
            );
          case 'list':
            return (
              <View key={index} style={styles.list}>
                {block.items.map((item, itemIndex) => (
                  <View key={itemIndex} style={styles.listRow}>
                    <Text style={[textStyles.body, { color: colors.goldText }]}>
                      {block.ordered ? `${itemIndex + 1}.` : '•'}
                    </Text>
                    <Text style={[textStyles.body, { color: colors.text, flex: 1 }]}>
                      <Inline text={item} color={colors.text} />
                    </Text>
                  </View>
                ))}
              </View>
            );
          case 'quote':
            return (
              <View
                key={index}
                style={[styles.quote, { borderLeftColor: colors.gold, backgroundColor: colors.goldSoft }]}
              >
                <Text style={[textStyles.small, { color: colors.text, fontStyle: 'italic' }]}>
                  <Inline text={block.text} color={colors.text} />
                </Text>
              </View>
            );
          default:
            return (
              <Text key={index} style={[textStyles.body, { color: colors.text }]}>
                <Inline text={block.text} color={colors.text} />
              </Text>
            );
        }
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  codeBlock: {
    borderWidth: 1,
    borderRadius: radii.panel,
    padding: 12,
  },
  list: { gap: 6 },
  listRow: { flexDirection: 'row', gap: 8 },
  quote: {
    borderLeftWidth: 2,
    borderRadius: radii.quiet,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
