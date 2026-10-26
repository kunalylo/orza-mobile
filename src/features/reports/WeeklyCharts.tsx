/**
 * Weekly bar charts (react-native-svg): calories per day against a dashed target line and a ±10% band, plus
 * small protein / water / steps charts. Bars grow up from the baseline (skipped with Reduce Motion); tap a day
 * to read it. Each day column is an accessible element with the same data.
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withDelay, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { formatNumber } from '@/features/goals/math';
import { haptics } from '@/lib/haptics';
import { colors, fonts, radii, spacing } from '@/theme';
import { GlassCard, Icon, Text, type IconName } from '@/ui';

import { dayMonth, weekdayLong, weekdayShort } from './format';
import type { WeeklyDay } from './types';

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** Rounded-top bar as a path (bottom corners nearly square), drawn up from `base`. */
function barPath(x: number, base: number, w: number, h: number, r: number) {
  'worklet';
  const hh = Math.max(0, h);
  const rr = Math.min(r, w / 2, hh);
  const top = base - hh;
  return `M${x},${base}L${x},${top + rr}Q${x},${top} ${x + rr},${top}L${x + w - rr},${top}Q${x + w},${top} ${x + w},${top + rr}L${x + w},${base}Z`;
}

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [
    width,
    (e) => {
      const w = Math.round(e.nativeEvent.layout.width);
      if (w > 0 && w !== width) setWidth(w);
    },
  ];
}

/** 0 → 1 once the chart has a width (and again when `key` changes). */
function useGrow(ready: boolean, key: string) {
  const reduce = useReducedMotion();
  const grow = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!ready) return;
    if (reduce) {
      grow.set(1);
      return;
    }
    grow.set(0);
    grow.set(withDelay(60, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) })));
  }, [ready, key, reduce, grow]);
  return grow;
}

function Bar({ grow, i, x, base, w, h, r, fill, opacity = 1 }: { grow: SharedValue<number>; i: number; x: number; base: number; w: number; h: number; r: number; fill: string; opacity?: number }) {
  const props = useAnimatedProps(() => {
    // Stagger: each bar starts a little after the previous one.
    const t = Math.min(1, Math.max(0, grow.get() * 1.36 - i * 0.06));
    return { d: barPath(x, base, w, h * t, r) };
  });
  return <AnimatedPath animatedProps={props} fill={fill} opacity={opacity} />;
}

/* ───────────────────────────── calories ───────────────────────────── */

export function CalorieChart({ days, target, today, bestDate }: { days: WeeklyDay[]; target: number; today: string; bestDate?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [width, onLayout] = useWidth();
  const [active, setActive] = useState<string | null>(null);
  const grow = useGrow(width > 0, days.map((d) => `${d.date}:${d.calories}`).join('|'));

  const H = 210;
  const TOP = 20;
  const base = H - 1;
  const plotH = base - TOP;
  const peak = Math.max(target, ...days.map((d) => d.calories));
  const scaleMax = Math.max(peak * 1.14, target * 1.25, 1);
  const yOf = (v: number) => base - Math.max(0, Math.min(1, v / scaleMax)) * plotH;
  const within = (v: number) => target > 0 && Math.abs(v - target) / target <= 0.1;
  // A day's value sits 6 px above its bar; when the dashed target line would run through it (a bar just under the
  // target), lift it above the line instead.
  const labelY = (v: number) => {
    const y = Math.max(11, yOf(v) - 6);
    const lineY = yOf(target);
    return target > 0 && y - 9 <= lineY + 2 && y + 2 >= lineY - 2 ? Math.max(11, lineY - 5) : y;
  };

  const gap = width < 340 ? 6 : 10;
  const slot = width > 0 ? (width - gap * 6) / 7 : 0;
  const barW = Math.min(44, slot);
  const sel = days.find((d) => d.date === active) ?? null;

  return (
    <View>
      <View style={styles.readout} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {sel ? (
          <>
            <Text variant="label">
              {weekdayLong(sel.date)}, {dayMonth(sel.date)}
            </Text>
            <Text variant="caption" tone="muted" style={styles.tabular}>
              {sel.meals_count
                ? `${formatNumber(sel.calories)} kcal · ${sel.meals_count} meal${sel.meals_count === 1 ? '' : 's'}${within(sel.calories) ? ' · within ±10%' : ''}`
                : 'Not logged'}
            </Text>
          </>
        ) : (
          <Text variant="caption" tone="subtle">
            Tap a day to see its details
          </Text>
        )}
      </View>

      <View onLayout={onLayout} style={{ height: H }}>
        {width > 0 ? (
          <Svg width={width} height={H}>
            <Defs>
              <LinearGradient id={`bar${id}`} x1="0" y1="1" x2="0" y2="0">
                <Stop offset="0" stopColor={colors.amber} />
                <Stop offset="0.55" stopColor={colors.coral} />
                <Stop offset="1" stopColor={colors.pink} />
              </LinearGradient>
            </Defs>
            <Line x1={0} x2={width} y1={yOf(scaleMax / 2)} y2={yOf(scaleMax / 2)} stroke="rgba(20,20,20,0.05)" strokeWidth={1} />
            {target > 0 ? (
              <>
                <Rect x={0} y={yOf(target * 1.1)} width={width} height={Math.max(0, yOf(target * 0.9) - yOf(target * 1.1))} fill="rgba(18,122,86,0.08)" />
                <Line x1={0} x2={width} y1={yOf(target)} y2={yOf(target)} stroke="rgba(194,65,12,0.6)" strokeWidth={1.5} strokeDasharray="5 5" />
              </>
            ) : null}
            {days.map((d, i) => {
              const x = i * (slot + gap) + (slot - barW) / 2;
              if (!d.meals_count) return <Rect key={d.date} x={x} y={base - 4} width={barW} height={4} rx={2} fill="rgba(20,20,20,0.10)" />;
              const h = Math.max(base - yOf(d.calories), 4);
              const dim = active != null && active !== d.date;
              return (
                <Bar key={d.date} grow={grow} i={i} x={x} base={base} w={barW} h={h} r={Math.min(10, barW / 2)} fill={`url(#bar${id})`} opacity={dim ? 0.4 : within(d.calories) ? 1 : 0.78} />
              );
            })}
            {days.map((d, i) =>
              d.meals_count ? (
                <SvgText
                  key={`v${d.date}`}
                  x={i * (slot + gap) + slot / 2}
                  y={labelY(d.calories)}
                  fontSize={slot < 40 ? 9 : 10}
                  fontFamily={fonts.mono}
                  fill={colors.ink}
                  textAnchor="middle"
                >
                  {d.calories >= 10000 ? `${Math.round(d.calories / 1000)}k` : formatNumber(d.calories)}
                </SvgText>
              ) : null,
            )}
            <Line x1={0} x2={width} y1={base} y2={base} stroke="rgba(20,20,20,0.14)" strokeWidth={1} />
          </Svg>
        ) : null}
        {/* Tap + screen-reader targets, one per day. */}
        <View style={[StyleSheet.absoluteFill, styles.hitRow, { gap }]}>
          {days.map((d) => (
            <Pressable
              key={d.date}
              style={styles.hit}
              onPress={() => {
                haptics.select();
                setActive((a) => (a === d.date ? null : d.date));
              }}
              accessibilityRole="button"
              accessibilityLabel={`${weekdayLong(d.date)} ${dayMonth(d.date)}${d.date === bestDate ? ', most balanced day' : ''}: ${
                d.meals_count ? `${formatNumber(d.calories)} kilocalories, ${d.meals_count} meals logged${within(d.calories) ? ', within 10% of target' : ''}` : 'not logged'
              }`}
            />
          ))}
        </View>
      </View>

      <View style={[styles.days, { gap }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {days.map((d) => (
          <View key={d.date} style={styles.dayCol}>
            <Text variant="eyebrow" style={styles.dayName} color={d.date === today ? colors.energyInk : d.date === active ? colors.ink : colors.muted}>
              {weekdayShort(d.date)}
            </Text>
            <Text variant="caption" tone="subtle" style={styles.tabular}>
              {Number(d.date.slice(8))}
            </Text>
            <View style={[styles.best, d.date === bestDate && styles.bestOn]} />
          </View>
        ))}
      </View>
    </View>
  );
}

/* ───────────────────────────── mini bars ───────────────────────────── */

const TONES = {
  violet: { from: colors.violet300, to: colors.violet, line: 'rgba(110,62,214,0.5)', bg: colors.violet50, fg: colors.violet600 },
  cyan: { from: colors.cyan300, to: colors.cyan, line: 'rgba(11,143,166,0.5)', bg: colors.cyan50, fg: colors.cyan700 },
  success: { from: '#5FD3A4', to: colors.success, line: 'rgba(18,122,86,0.5)', bg: colors.successBg, fg: colors.success },
} as const;

export function MiniBars({
  title,
  icon,
  days,
  value,
  target,
  unit,
  tone,
  average,
  today,
}: {
  title: string;
  icon: IconName;
  days: WeeklyDay[];
  value: (d: WeeklyDay) => number;
  target: number;
  unit: string;
  tone: keyof typeof TONES;
  average: string;
  today: string;
}) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const [width, onLayout] = useWidth();
  const t = TONES[tone];
  const values = days.map(value);
  const grow = useGrow(width > 0, days.map((d, i) => `${d.date}:${values[i]}`).join('|'));
  const tracked = values.some((v) => v > 0);
  const H = 92;
  const base = H - 1;
  const scaleMax = Math.max(target * 1.2, ...values.map((v) => v * 1.08), 1);
  const yOf = (v: number) => base - Math.max(0, Math.min(1, v / scaleMax)) * (base - 4);
  const gap = 8;
  const slot = width > 0 ? (width - gap * 6) / 7 : 0;
  const barW = Math.min(24, slot);
  const summary = `${title} per day, target ${formatNumber(target)} ${unit}, average ${tracked ? average : 'not tracked'}. ${days
    .map((d, i) => `${weekdayLong(d.date)}: ${values[i] > 0 ? `${formatNumber(values[i])} ${unit}` : 'not tracked'}`)
    .join('; ')}.`;

  return (
    <GlassCard padding={spacing.lg}>
      <View style={styles.miniHead}>
        <View style={[styles.miniIcon, { backgroundColor: t.bg }]}>
          <Icon name={icon} size={16} color={t.fg} />
        </View>
        <View style={styles.flex}>
          <Text variant="label">{title}</Text>
          <Text variant="caption" tone="subtle">
            Target {formatNumber(target)} {unit}
          </Text>
        </View>
        <View style={styles.miniAvg}>
          <Text variant="h3" style={styles.tabular}>
            {tracked ? average : '—'}
          </Text>
          <Text variant="eyebrow" tone="subtle" style={styles.avgLabel}>
            avg / day
          </Text>
        </View>
      </View>
      <View onLayout={onLayout} style={[styles.miniPlot, { height: H }]} accessible accessibilityLabel={summary}>
        {width > 0 ? (
          <Svg width={width} height={H}>
            <Defs>
              <LinearGradient id={`mini${id}`} x1="0" y1="1" x2="0" y2="0">
                <Stop offset="0" stopColor={t.from} />
                <Stop offset="1" stopColor={t.to} />
              </LinearGradient>
            </Defs>
            {target > 0 ? <Line x1={0} x2={width} y1={yOf(target)} y2={yOf(target)} stroke={t.line} strokeWidth={1.2} strokeDasharray="4 4" /> : null}
            {values.map((v, i) => {
              const x = i * (slot + gap) + (slot - barW) / 2;
              if (v <= 0) return <Rect key={days[i].date} x={x} y={base - 3} width={barW} height={3} rx={1.5} fill="rgba(20,20,20,0.10)" />;
              return <Bar key={days[i].date} grow={grow} i={i} x={x} base={base} w={barW} h={Math.max(base - yOf(v), 3)} r={Math.min(6, barW / 2)} fill={`url(#mini${id})`} />;
            })}
            <Line x1={0} x2={width} y1={base} y2={base} stroke="rgba(20,20,20,0.12)" strokeWidth={1} />
          </Svg>
        ) : null}
      </View>
      <View style={[styles.days, { gap }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {days.map((d) => (
          <View key={d.date} style={styles.dayCol}>
            <Text variant="eyebrow" style={styles.dayName} color={d.date === today ? colors.energyInk : colors.subtle}>
              {weekdayShort(d.date).slice(0, 2)}
            </Text>
          </View>
        ))}
      </View>
    </GlassCard>
  );
}

export function Legend({ children }: { children: ReactNode }) {
  return <View style={styles.legend}>{children}</View>;
}

export function LegendItem({ swatch, label }: { swatch: 'bar' | 'dash' | 'band'; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={swatch === 'bar' ? styles.swBar : swatch === 'dash' ? styles.swDash : styles.swBand} />
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  tabular: { fontVariant: ['tabular-nums'] },
  readout: { minHeight: 40, justifyContent: 'center', marginBottom: spacing.sm },
  hitRow: { flexDirection: 'row' },
  hit: { flex: 1 },
  days: { flexDirection: 'row', marginTop: spacing.sm },
  dayCol: { flex: 1, alignItems: 'center' },
  dayName: { fontSize: 10, letterSpacing: 1 },
  best: { width: 6, height: 6, borderRadius: 3, marginTop: 3 },
  bestOn: { backgroundColor: colors.coral, boxShadow: '0px 0px 8px rgba(255,122,106,0.7)' },
  miniHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  miniIcon: { width: 36, height: 36, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  miniAvg: { alignItems: 'flex-end' },
  avgLabel: { fontSize: 9.5, marginTop: 2 },
  miniPlot: { marginTop: spacing.lg },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swBar: { width: 10, height: 10, borderRadius: 3, backgroundColor: colors.coral },
  swDash: { width: 16, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: 'rgba(194,65,12,0.7)' },
  swBand: { width: 16, height: 10, borderRadius: 3, backgroundColor: 'rgba(18,122,86,0.16)' },
});
