/**
 * Tiny, safe renderer for ÖRZA's replies — React Native <Text> nodes only, never HTML.
 * Paragraphs, line breaks, "- " / "• " bullets, "1. " lists, "# headings" (as bold), **bold**, *italic*, `code`
 * and [links](https://…) (https opens in the in-app browser; the website's app paths like /dashboard/compensation open
 * the matching screen — see ./links; anything else shows as plain text).
 */
import * as WebBrowser from 'expo-web-browser';
import { Fragment, useMemo, type ReactNode } from 'react';
import { Text as RNText, StyleSheet, View } from 'react-native';

import { colors, fonts } from '@/theme';
import { Text } from '@/ui';

import { appLinkFor, openAppLink } from './links';

type Block = { kind: 'p'; lines: string[] } | { kind: 'ul'; items: string[] } | { kind: 'ol'; items: string[]; start: number };

export function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let gap = true; // a blank line (or the start) precedes the current line
  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim() || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      gap = true;
      continue;
    }
    const prev = blocks[blocks.length - 1];
    const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
    const numbered = line.match(/^\s*(\d{1,3})[.)]\s+(.+)$/);
    if (bullet) {
      if (prev?.kind === 'ul') prev.items.push(bullet[1]);
      else blocks.push({ kind: 'ul', items: [bullet[1]] });
    } else if (numbered) {
      if (prev?.kind === 'ol') prev.items.push(numbered[2]);
      else blocks.push({ kind: 'ol', items: [numbered[2]], start: Number(numbered[1]) || 1 });
    } else {
      const heading = line.match(/^\s*#{1,6}\s+(.+)$/);
      const text = heading ? `**${heading[1].replace(/\*\*/g, '')}**` : line;
      if (!gap && prev?.kind === 'p') prev.lines.push(text);
      else blocks.push({ kind: 'p', lines: [text] });
    }
    gap = false;
  }
  return blocks;
}

// 1: bold · 2,3: link text + href · 4: italic · 5: code
const INLINE = /\*\*([^\n]+?)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)|\*([^*\s](?:[^*\n]*?[^*\s])?)\*|`([^`\n]+)`/g;

/** Plain https URLs only (no credentials, no control characters); anything else renders as text. */
function safeHttps(href: string): string | null {
  if (!href || /[\\\u0000-\u001f\u007f]/.test(href)) return null;
  try {
    const u = new URL(href);
    if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function renderInline(text: string, keyPrefix: string, allowLinks = true): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(INLINE.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyPrefix}.${m.index}`;
    if (m[1] != null) {
      out.push(
        <RNText key={k} style={styles.bold}>
          {renderInline(m[1], k, allowLinks)}
        </RNText>,
      );
    } else if (m[2] != null && m[3] != null) {
      const url = allowLinks ? safeHttps(m[3]) : null;
      const appLink = allowLinks && !url ? appLinkFor(m[3]) : null;
      const label = renderInline(m[2], k, false);
      if (appLink)
        out.push(
          <RNText key={k} style={styles.link} accessibilityRole="link" onPress={() => openAppLink(appLink)}>
            {label}
          </RNText>,
        );
      else if (!url) out.push(<Fragment key={k}>{label}</Fragment>);
      else
        out.push(
          <RNText
            key={k}
            style={styles.link}
            accessibilityRole="link"
            onPress={() => {
              WebBrowser.openBrowserAsync(url).catch(() => {});
            }}
          >
            {label}
          </RNText>,
        );
    } else if (m[4] != null) {
      out.push(
        <RNText key={k} style={styles.italic}>
          {renderInline(m[4], k, allowLinks)}
        </RNText>,
      );
    } else if (m[5] != null) {
      out.push(
        <RNText key={k} style={styles.code}>
          {m[5]}
        </RNText>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichText({ text, color = colors.ink }: { text: string; color?: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <View style={styles.wrap}>
      {blocks.map((b, bi) => {
        if (b.kind === 'p') {
          return (
            <Text key={bi} variant="callout" color={color} selectable>
              {b.lines.map((l, li) => (
                <Fragment key={li}>
                  {li > 0 ? '\n' : null}
                  {renderInline(l, `${bi}.${li}`)}
                </Fragment>
              ))}
            </Text>
          );
        }
        return (
          <View key={bi} style={styles.list}>
            {b.items.map((it, ii) => (
              <View key={ii} style={styles.item}>
                {b.kind === 'ul' ? (
                  <View style={styles.bulletBox} accessibilityElementsHidden importantForAccessibility="no">
                    <View style={styles.bullet} />
                  </View>
                ) : (
                  <Text variant="mono" tone="subtle" style={styles.number} accessibilityElementsHidden importantForAccessibility="no">
                    {b.start + ii}.
                  </Text>
                )}
                <Text variant="callout" color={color} style={styles.itemText} selectable>
                  {renderInline(it, `${bi}.${ii}`)}
                </Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  list: { gap: 6 },
  item: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bulletBox: { height: 22, justifyContent: 'center' },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.coral },
  number: { minWidth: 18, textAlign: 'right', lineHeight: 22 },
  itemText: { flex: 1 },
  bold: { fontFamily: fonts.bodySemiBold },
  italic: { fontStyle: 'italic' },
  link: { color: colors.cyan700, textDecorationLine: 'underline', fontFamily: fonts.bodyMedium },
  code: { fontFamily: fonts.mono, fontSize: 13, backgroundColor: 'rgba(20,20,20,0.06)' },
});

