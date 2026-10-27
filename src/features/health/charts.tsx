/**
 * Health trend charts (react-native-svg): daily bars (steps, sleep) and a line (resting heart rate, weight).
 *
 * - Bars grow up from the baseline and the line draws itself in (skipped with Reduce Motion).
 * - Tap or drag across a chart to read any day (selection tick haptic); the readout above the plot always shows the
 *   selected — or latest — day, so nothing hides under a finger.
 * - Screen readers get a summary label and can swipe up / down to step through days (adjustable role).
 */
import { useId, useState, type ReactNode } from 'react';
import { StyleSheet, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  FadeInDown,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { haptics } from '@/lib/haptics';
import { colors, fonts, radii, spacing } from '@/theme';
import { GlassCard, Text, useReveal } from '@/ui';

import { compact, formatDay, niceTicks } from './format';
import type { ChartPoint } from './types';

const AnimatedPath = Animated.createAnimatedComponent(Path);

const M = { top: 12, right: 8, bottom: 24, left: 36 };
const PLOT_H = 148;
const HEIGHT = M.top + PLOT_H + M.bottom;
const BAR_REVEAL = { delay: 120, spring: { damping: 18, stiffness: 120, mass: 0.9 } };
const LINE_REVEAL = { delay: 140, duration: 900 };

export type ChartTone = 'energy' | 'violet' | 'coral' | 'cyan';

const TONE: Record<ChartTone, { solid: string; top: string; bottom: string; soft: string }> = {
  energy: { solid: colors.coral, top: colors.pink, bottom: colors.amber, soft: 'rgba(255,122,106,0.16)' },
  violet: { solid: colors.violet, top: colors.violet, bottom: colors.violet300, soft: 'rgba(135,87,242,0.16)' },
  coral: { solid: '#E0593F', top: '#E0593F', bottom: '#FF7A6A', soft: 'rgba(224,89,63,0.16)' },
  cyan: { solid: colors.cyan600, top: colors.cyan600, bottom: colors.cyan300, soft: 'rgba(11,143,166,0.16)' },
};

/* ───────────────────────────── shared plumbing ───────────────────────────── */

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== width) setWidth(w);
  };
  return [width, onLayout];
}

/** Evenly spaced x-label indexes (first and last always included). */
function labelIndexes(n: number, width: number): number[] {
  const slots = Math.max(2, Math.min(5, Math.floor(width / 78)));
  if (n <= slots) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>();
  for (let i = 0; i < slots; i++) out.add(Math.round((i * (n - 1)) / (slots - 1)));
  return [...out];
}

function lastIndexWithData(points: ChartPoint[]) {
  for (let i = points.length - 1; i >= 0; i--) if (points[i].value !== undefined) return i;
  return -1;
}

/** Tap / drag selection + screen-reader stepping. */
function useSelection(points: ChartPoint[], band: number) {
  const [active, setActive] = useState<number | null>(null);
  const n = points.length;

  const selectIndex = (i: number) => {
    const c = Math.max(0, Math.min(n - 1, i));
    if (c === active) return;
    haptics.select();
    setActive(c);
  };
  const selectX = (x: number) => {
    if (band > 0) selectIndex(Math.floor((x - M.left) / band));
  };

  // Select only once a horizontal drag is recognised (onStart = activation; onUpdate fires only while active), never on
  // touch-down (onBegin): a vertical scroll of the screen that starts on a chart fails the pan and must not pick a day.
  const gesture = Gesture.Race(
    Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-6, 6])
      .failOffsetY([-14, 14])
      .onStart((e) => selectX(e.x))
      .onUpdate((e) => selectX(e.x)),
    Gesture.Tap()
      .runOnJS(true)
      .onEnd((e) => selectX(e.x))
  );

  const fallback = lastIndexWithData(points);
  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    const cur = active !== null && active < n ? active : fallback >= 0 ? fallback : n - 1;
    if (e.nativeEvent.actionName === 'increment') selectIndex(cur + 1);
    if (e.nativeEvent.actionName === 'decrement') selectIndex(cur - 1);
  };

  // A selection from a longer range (90 → 30 days) no longer exists.
  const valid = active !== null && active < n ? active : null;
  const shown = valid ?? (fallback >= 0 ? fallback : null);
  return { active: valid, shown, gesture, onAccessibilityAction };
}

function Readout({ point, isLatest, format, note }: { point: ChartPoint | null; isLatest: boolean; format: (v: number) => string; note?: string }) {
  if (!point) return <View style={styles.readout} />;
  return (
    <View style={styles.readout}>
      <View style={styles.readoutLeft}>
        <Text variant="eyebrow" tone="subtle">
          {isLatest ? `Latest · ${formatDay(point.date)}` : formatDay(point.date)}
        </Text>
        <Text variant="label" tone="ink" numberOfLines={1}>
          {point.value !== undefined ? format(point.value) : 'No data'}
        </Text>
      </View>
      {note ? (
        <Text variant="caption" tone="muted" numberOfLines={1} style={styles.readoutNote}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

function XLabels({ points, width, band }: { points: ChartPoint[]; width: number; band: number }) {
  return (
    <>
      {labelIndexes(points.length, width - M.left - M.right).map((i) => {
        const x = M.left + band * i + band / 2;
        const anchor = i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle';
        return (
          <SvgText
            key={i}
            x={anchor === 'start' ? Math.max(M.left, x - band / 2) : anchor === 'end' ? Math.min(width - M.right, x + band / 2) : x}
            y={HEIGHT - 6}
            fontSize={9.5}
            fontFamily={fonts.mono}
            fill={colors.subtle}
            textAnchor={anchor}
          >
            {formatDay(points[i].date)}
          </SvgText>
        );
      })}
    </>
  );
}

function YGrid({ ticks, y, width, format = compact }: { ticks: number[]; y: (v: number) => number; width: number; format?: (v: number) => string }) {
  return (
    <>
      {ticks.map((t) => (
        <G key={t}>
          <Line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke={colors.divider} strokeWidth={1} />
          <SvgText x={M.left - 6} y={y(t) + 3} fontSize={9.5} fontFamily={fonts.mono} fill={colors.subtle} textAnchor="end">
            {format(t)}
          </SvgText>
        </G>
      ))}
    </>
  );
}

function summary(points: ChartPoint[], format: (v: number) => string) {
  const vals = points.filter((p) => p.value !== undefined) as { date: string; value: number }[];
  if (!vals.length) return 'No data';
  const latest = vals[vals.length - 1];
  return `${vals.length} days with data. Latest ${formatDay(latest.date)}: ${format(latest.value)}.`;
}

/* ───────────────────────────── Bar chart ───────────────────────────── */

export interface BarChartProps {
  points: ChartPoint[];
  tone?: ChartTone;
  format: (v: number) => string;
  /** Accessible name, e.g. "Daily steps, last 30 days". */
  label: string;
  /** Dashed target line (days at or above it draw at full strength). */
  reference?: { value: number; label: string };
  /** A short note for the selected day ("Target reached"). */
  unitNote?: (v: number) => string;
  yFormat?: (v: number) => string;
}

export function BarChart({ points, tone = 'energy', format, label, reference, unitNote, yFormat }: BarChartProps) {
  const [width, onLayout] = useWidth();
  const gid = `bar${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const t = TONE[tone];
  const n = points.length;
  const plotW = Math.max(0, width - M.left - M.right);
  const band = n ? plotW / n : 0;
  const barW = Math.max(2, Math.min(18, band * (n > 45 ? 0.72 : 0.6)));

  const vals = points.flatMap((p) => (p.value !== undefined ? [p.value] : []));
  const ticks = niceTicks(0, Math.max(...vals, reference?.value ?? 0, 1), 3);
  const top = ticks[ticks.length - 1] || 1;
  const y = (v: number) => M.top + PLOT_H - (Math.max(0, v) / top) * PLOT_H;

  const { active, shown, gesture, onAccessibilityAction } = useSelection(points, band);

  // Grow from the baseline (then the bars are plain views — see useReveal).
  const { progress: grow, done: grown } = useReveal(width > 0, '', BAR_REVEAL);
  const growStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: grow.get() }] }));

  const sel = shown !== null ? points[shown] : null;
  const note = sel && sel.value !== undefined && unitNote ? unitNote(sel.value) : undefined;

  const bars = (
    <Svg width={plotW} height={PLOT_H}>
      <Defs>
        <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <Stop offset={0} stopColor={t.top} />
          <Stop offset={1} stopColor={t.bottom} />
        </LinearGradient>
      </Defs>
      {points.map((p, i) => {
        if (p.value === undefined || p.value <= 0) return null;
        const h = Math.max(2, (p.value / top) * PLOT_H);
        const reached = !reference || p.value >= reference.value;
        const dim = shown !== null && active !== null && i !== shown;
        return (
          <Rect
            key={p.date}
            x={band * i + (band - barW) / 2}
            y={PLOT_H - h}
            width={barW}
            height={h}
            rx={Math.min(barW / 2, 5)}
            fill={`url(#${gid})`}
            opacity={dim ? 0.3 : reached ? 1 : 0.55}
          />
        );
      })}
    </Svg>
  );

  return (
    <View>
      <Readout point={sel} isLatest={active === null} format={format} note={note} />
      <GestureDetector gesture={gesture}>
        <View
          onLayout={onLayout}
          style={styles.plot}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`${label}. ${summary(points, format)}`}
          accessibilityHint="Swipe up or down to move between days"
          accessibilityValue={sel ? { text: `${formatDay(sel.date)}: ${sel.value !== undefined ? format(sel.value) : 'no data'}` } : undefined}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={onAccessibilityAction}
        >
          {width > 0 ? (
            <>
              <Svg width={width} height={HEIGHT} style={StyleSheet.absoluteFill}>
                <YGrid ticks={ticks} y={y} width={width} format={yFormat} />
                <XLabels points={points} width={width} band={band} />
              </Svg>

              {grown ? (
                <View pointerEvents="none" style={[styles.layer, { left: M.left, top: M.top, width: plotW, height: PLOT_H }]}>
                  {bars}
                </View>
              ) : (
                <Animated.View pointerEvents="none" style={[styles.layer, { left: M.left, top: M.top, width: plotW, height: PLOT_H }, growStyle]}>
                  {bars}
                </Animated.View>
              )}

              <Svg width={width} height={HEIGHT} style={StyleSheet.absoluteFill} pointerEvents="none">
                {reference ? (
                  <G>
                    <Line
                      x1={M.left}
                      x2={width - M.right}
                      y1={y(reference.value)}
                      y2={y(reference.value)}
                      stroke={colors.ink}
                      strokeOpacity={0.45}
                      strokeWidth={1}
                      strokeDasharray="4 4"
                    />
                    {/* A light halo under the label: the tallest bars reach the target line and ran through the text. */}
                    <SvgText
                      x={width - M.right}
                      y={y(reference.value) - 4}
                      fontSize={9.5}
                      fontFamily={fonts.mono}
                      fill={colors.white}
                      stroke={colors.white}
                      strokeWidth={3.5}
                      strokeLinejoin="round"
                      textAnchor="end"
                    >
                      {reference.label}
                    </SvgText>
                    <SvgText x={width - M.right} y={y(reference.value) - 4} fontSize={9.5} fontFamily={fonts.mono} fill={colors.muted} textAnchor="end">
                      {reference.label}
                    </SvgText>
                  </G>
                ) : null}
                {active !== null ? (
                  <Line
                    x1={M.left + band * active + band / 2}
                    x2={M.left + band * active + band / 2}
                    y1={M.top}
                    y2={M.top + PLOT_H}
                    stroke={t.solid}
                    strokeOpacity={0.35}
                    strokeWidth={1}
                  />
                ) : null}
              </Svg>
            </>
          ) : null}
        </View>
      </GestureDetector>
    </View>
  );
}

/* ───────────────────────────── Line chart ───────────────────────────── */

function lineTicks(vals: number[], minSpan: number) {
  if (!vals.length) return [0, 1];
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  return niceTicks(lo, hi, 3);
}

export interface LineChartProps {
  points: ChartPoint[];
  tone?: ChartTone;
  format: (v: number) => string;
  label: string;
  /** Smallest vertical span shown, so a flat week doesn't look like a cliff. */
  minSpan?: number;
  yFormat?: (v: number) => string;
}

export function LineChart({ points, tone = 'coral', format, label, minSpan = 4, yFormat }: LineChartProps) {
  const [width, onLayout] = useWidth();
  const gid = `line${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const t = TONE[tone];
  const n = points.length;
  const plotW = Math.max(0, width - M.left - M.right);
  const band = n ? plotW / n : 0;

  const vals = points.flatMap((p) => (p.value !== undefined ? [p.value] : []));
  const ticks = lineTicks(vals, minSpan);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const y = (v: number) => M.top + PLOT_H - ((v - lo) / (hi - lo || 1)) * PLOT_H;
  const x = (i: number) => M.left + band * i + band / 2;

  const defined = points.flatMap((p, i) => (p.value !== undefined ? [{ i, v: p.value }] : []));
  const d = defined.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area =
    defined.length > 1
      ? `${d} L${x(defined[defined.length - 1].i).toFixed(1)},${M.top + PLOT_H} L${x(defined[0].i).toFixed(1)},${M.top + PLOT_H} Z`
      : '';
  let length = 0;
  for (let k = 1; k < defined.length; k++) {
    length += Math.hypot(x(defined[k].i) - x(defined[k - 1].i), y(defined[k].v) - y(defined[k - 1].v));
  }
  const total = Math.max(1, Math.ceil(length));

  const { active, shown, gesture, onAccessibilityAction } = useSelection(points, band);

  // Draw the line in (then it is a plain path — see useReveal).
  const { progress: draw, done: drawn } = useReveal(width > 0, '', LINE_REVEAL);
  const lineProps = useAnimatedProps(() => ({ strokeDashoffset: total * (1 - draw.get()) }));
  const fadeProps = useAnimatedProps(() => ({ opacity: draw.get() }));

  const sel = shown !== null ? points[shown] : null;
  const dots = n <= 45;

  return (
    <View>
      <Readout point={sel} isLatest={active === null} format={format} />
      <GestureDetector gesture={gesture}>
        <View
          onLayout={onLayout}
          style={styles.plot}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={`${label}. ${summary(points, format)}`}
          accessibilityHint="Swipe up or down to move between days"
          accessibilityValue={sel ? { text: `${formatDay(sel.date)}: ${sel.value !== undefined ? format(sel.value) : 'no data'}` } : undefined}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={onAccessibilityAction}
        >
          {width > 0 ? (
            <Svg width={width} height={HEIGHT}>
              <Defs>
                <LinearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset={0} stopColor={t.solid} stopOpacity={0.22} />
                  <Stop offset={1} stopColor={t.solid} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <YGrid ticks={ticks} y={y} width={width} format={yFormat} />
              <XLabels points={points} width={width} band={band} />
              {area ? drawn ? <Path d={area} fill={`url(#${gid})`} /> : <AnimatedPath d={area} fill={`url(#${gid})`} animatedProps={fadeProps} /> : null}
              {defined.length > 1 && drawn ? (
                <Path d={d} fill="none" stroke={t.solid} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
              ) : defined.length > 1 ? (
                <AnimatedPath
                  d={d}
                  fill="none"
                  stroke={t.solid}
                  strokeWidth={2.25}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={[total, total]}
                  animatedProps={lineProps}
                />
              ) : null}
              {dots || defined.length === 1
                ? defined.map((p) => <Circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={2.6} fill={colors.white} stroke={t.solid} strokeWidth={1.6} />)
                : null}
              {active !== null ? (
                <G>
                  <Line x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + PLOT_H} stroke={t.solid} strokeOpacity={0.35} strokeWidth={1} />
                  {points[active]?.value !== undefined ? (
                    <Circle cx={x(active)} cy={y(points[active].value!)} r={5} fill={t.solid} stroke={colors.white} strokeWidth={2} />
                  ) : null}
                </G>
              ) : null}
            </Svg>
          ) : null}
        </View>
      </GestureDetector>
    </View>
  );
}

/* ───────────────────────────── Card ───────────────────────────── */

export interface ChartCardProps {
  title: string;
  subtitle: string;
  headline?: string;
  headlineNote?: string;
  empty: boolean;
  emptyText: string;
  /** Previous range still showing while the next one loads. */
  dimmed?: boolean;
  /** Stagger index for the entrance. */
  index?: number;
  children: ReactNode;
}

export function ChartCard({ title, subtitle, headline, headlineNote, empty, emptyText, dimmed, index = 0, children }: ChartCardProps) {
  const reduce = useReducedMotion();
  return (
    <Animated.View entering={reduce ? undefined : FadeInDown.delay(80 + index * 70).springify().damping(18).stiffness(100).mass(1)} style={dimmed ? styles.dimmed : undefined}>
      <GlassCard padding={spacing.lg}>
        <View style={styles.cardHead}>
          <View style={styles.flex}>
            <Text variant="h3" tone="ink">
              {title}
            </Text>
            <Text variant="caption" tone="muted">
              {subtitle}
            </Text>
          </View>
          {headline && !empty ? (
            <View style={styles.headline}>
              <Text variant="h3" tone="ink" style={styles.tabular}>
                {headline}
              </Text>
              {headlineNote ? (
                <Text variant="caption" tone="muted" align="right">
                  {headlineNote}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
        {empty ? (
          <View style={styles.empty}>
            <Text variant="small" tone="muted" align="center">
              {emptyText}
            </Text>
          </View>
        ) : (
          children
        )}
      </GlassCard>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  plot: { height: HEIGHT, width: '100%' },
  layer: { position: 'absolute', transformOrigin: 'bottom' },
  readout: {
    minHeight: 40,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  readoutLeft: { flexShrink: 1, gap: 2 },
  readoutNote: { flexShrink: 1, textAlign: 'right' },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  flex: { flex: 1, gap: 2 },
  headline: { alignItems: 'flex-end', maxWidth: '48%' },
  tabular: { fontVariant: ['tabular-nums'] },
  empty: {
    height: 120,
    marginTop: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  dimmed: { opacity: 0.55 },
});
