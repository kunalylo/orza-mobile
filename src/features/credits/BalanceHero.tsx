/** Dark hero with the glowing energy orb and the balance as a large editorial numeral in the energy gradient. */
import { useEffect, useId, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Stop, Text as SvgText } from 'react-native-svg';

import { formatNumber } from '@/features/goals/math';
import { colors, fonts, radii, spacing } from '@/theme';
import { Button, Icon, Orb, Text } from '@/ui';

import type { CreditCosts } from './types';

/** Counts up to `value` (and between later values); jumps straight there with Reduce Motion. */
function useCountUp(value: number) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : 0);
  const from = useRef(reduce ? value : 0);
  useEffect(() => {
    if (reduce) {
      from.current = value;
      return;
    }
    const start = from.current;
    const t0 = Date.now();
    const duration = 1100;
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - t0) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      setShown(Math.round(start + (value - start) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value, reduce]);
  return reduce ? value : shown;
}

export function BalanceHero({
  credits,
  costs,
  aiEnabled,
  spent30d,
  requested,
  onRequest,
  onShowCosts,
}: {
  credits: number;
  costs: CreditCosts;
  aiEnabled: boolean;
  spent30d?: number;
  requested: boolean;
  onRequest: () => void;
  onShowCosts: () => void;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const shown = useCountUp(credits);
  const [width, setWidth] = useState(0);
  const scans = Math.floor(credits / Math.max(1, costs.scan));
  const chats = Math.floor(credits / Math.max(1, costs.chat));
  const low = aiEnabled && credits < 10;
  const label = formatNumber(shown);
  const fontSize = width && width < 300 ? 72 : 88;

  return (
    <View style={styles.hero}>
      <View style={styles.washCyan} pointerEvents="none" />
      <View style={styles.washViolet} pointerEvents="none" />
      <Orb size={260} tone="dark" style={styles.orb} />

      <View style={styles.pills}>
        <View style={styles.pill}>
          <Icon name="zap" size={12} color={colors.amber} />
          <Text variant="eyebrow" tone="heroMuted" style={styles.pillText}>
            AI credits · Free plan
          </Text>
        </View>
        <View style={[styles.pill, aiEnabled ? styles.pillOn : null]}>
          <View style={[styles.dot, { backgroundColor: aiEnabled ? '#8FE6C2' : colors.heroMuted }]} />
          <Text variant="caption" weight="medium" color={aiEnabled ? '#8FE6C2' : colors.heroMuted}>
            {aiEnabled ? 'AI is on' : 'Built-in engine · free'}
          </Text>
        </View>
      </View>

      <View
        style={styles.numberWrap}
        onLayout={(e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width))}
        accessible
        accessibilityRole="header"
        accessibilityLabel={`${formatNumber(credits)} credits available`}
      >
        {width > 0 ? (
          <Svg width={width} height={fontSize * 1.08}>
            <Defs>
              <LinearGradient id={`num${id}`} x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={colors.amber} />
                <Stop offset="0.55" stopColor={colors.coral} />
                <Stop offset="1" stopColor={colors.pink} />
              </LinearGradient>
            </Defs>
            <SvgText x={0} y={fontSize * 0.86} fontSize={fontSize} fontFamily={fonts.display} letterSpacing={-2} fill={`url(#num${id})`}>
              {label}
            </SvgText>
          </Svg>
        ) : (
          <View style={{ height: fontSize * 1.08 }} />
        )}
        <Text variant="callout" tone="heroMuted">
          credits available
        </Text>
      </View>

      <Text variant="small" tone="heroMuted" style={styles.copy}>
        {aiEnabled
          ? credits > 0
            ? `Enough for about ${formatNumber(scans)} meal scans or ${formatNumber(chats)} chat messages.${low ? " You're running low — request more below and we'll top you up." : ''}`
            : "You've used all your AI credits. Manual logging keeps working for free — request more and we'll top you up."
          : "ÖRZA's built-in engine is handling meal logging, chat, recipes and plans for free right now. Your credits stay untouched."}
      </Text>

      <View style={styles.stats}>
        <View style={styles.flex} accessible accessibilityLabel={`Used in the last 30 days: ${spent30d == null ? 'unknown' : formatNumber(spent30d)}`}>
          <Text variant="eyebrow" tone="heroSubtle" style={styles.statKey}>
            Used · last 30 days
          </Text>
          <Text variant="h2" tone="inverse" style={styles.tabular}>
            {spent30d == null ? '—' : formatNumber(spent30d)}
          </Text>
        </View>
        <View style={styles.flex} accessible accessibilityLabel="Manual logging: free">
          <Text variant="eyebrow" tone="heroSubtle" style={styles.statKey}>
            Manual logging
          </Text>
          <View style={styles.free}>
            <Icon name="cpu" size={16} color={colors.cyan300} />
            <Text variant="h2" tone="inverse">
              Free
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          label={requested ? 'Request sent' : 'Request more credits'}
          icon={requested ? 'check' : 'message-square'}
          variant="hero"
          block
          disabled={requested}
          onPress={onRequest}
          accessibilityHint={requested ? 'The team will reply by email' : undefined}
        />
        <Button label="What costs credits" iconRight="arrow-down" variant="heroOutline" block onPress={onShowCosts} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  hero: { backgroundColor: colors.hero, borderRadius: radii.xl, padding: spacing.xl, overflow: 'hidden', boxShadow: '0px 18px 60px rgba(20,20,20,0.22)' },
  washCyan: { position: 'absolute', left: -120, top: -140, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(47,210,240,0.08)' },
  washViolet: { position: 'absolute', left: -100, bottom: -160, width: 300, height: 300, borderRadius: 150, backgroundColor: 'rgba(191,168,255,0.07)' },
  orb: { position: 'absolute', right: -96, top: -70 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    // Near-opaque: on a phone-width hero the second pill sits over the bright orb, so a see-through pill loses its text.
    backgroundColor: 'rgba(24,24,27,0.82)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  pillOn: { borderColor: 'rgba(95,211,164,0.35)', backgroundColor: 'rgba(17,40,32,0.88)' },
  pillText: { fontSize: 10 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  numberWrap: { marginTop: spacing.xxxl },
  copy: { marginTop: spacing.lg },
  stats: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.14)' },
  statKey: { fontSize: 10, marginBottom: 4 },
  tabular: { fontVariant: ['tabular-nums'] },
  free: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { marginTop: spacing.xl, gap: spacing.sm },
});
