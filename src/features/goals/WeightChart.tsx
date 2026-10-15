/**
 * Weight trend chart (react-native-svg): a smooth monotone curve in the energy gradient with a soft area wash,
 * a dashed cyan target line, and tap / drag scrubbing with a readout above the plot (never under a finger).
 * The line draws itself in and the wash fades up on mount (skipped with Reduce Motion). Screen readers get a summary and can
 * swipe up / down to step through weigh-ins (adjustable role).
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { StyleSheet, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Rect, Stop, Text as SvgText } from 'react-native-svg';

import { haptics } from '@/lib/haptics';
import { colors, fonts } from '@/theme';
import { Text } from '@/ui';

import { KG_PER_LB, daysBetween, formatDayDate, formatDecimal, formatShortDate, kgToUnit, weightUnit } from './math';
import type { WeightPoint } from './types';

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);

const M = { top: 16, right: 14, bottom: 26, left: 40 };
const AXIS = colors.subtle;
const GRID = 'rgba(20,20,20,0.07)';
const TARGET = colors.cyan;

/** Clean y-axis ticks (0.5 / 1 / 2 / 5 / 10 / 20 steps) in the display unit — same as the web. */
function yScaleFor(values: number[]) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max(0.5, (hi - lo) * 0.15);
  const span = hi - lo + pad * 2;
  const step = [0.5, 1, 2, 5, 10, 20].find((s) => span / s <= 4) ?? 20;
  const min = Math.floor((lo - pad) / step) * step;
  const max = Math.ceil((hi + pad) / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 10) / 10);
  return { min, max, ticks };
}

/** Monotone cubic (Fritsch–Carlson) path: smooth, never overshoots between weigh-ins. */
function monotonePath(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return '';
  if (n === 1) return `M${pts[0].x},${pts[0].y}`;
  if (n === 2) return `M${pts[0].x},${pts[0].y}L${pts[1].x},${pts[1].y}`;
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x || 1e-6;
    slope[i] = (pts[i + 1].y - pts[i].y) / dx[i];
  }
  const m: number[] = [slope[0]];
  for (let i = 1; i < n - 1; i++) m[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  m[n - 1] = slope[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(pts[i].x + h).toFixed(1)},${(pts[i].y + m[i] * h).toFixed(1)} ${(pts[i + 1].x - h).toFixed(1)},${(pts[i + 1].y - m[i + 1] * h).toFixed(1)} ${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`;
  }
  return d;
}

const signed = (d: number) => (d === 0 ? '±0' : `${d > 0 ? '+' : '−'}${formatDecimal(Math.abs(d))}`);

export function WeightChart({ points: kgPoints, target: targetKg, imperial = false, height = 220 }: { points: WeightPoint[]; target?: number | null; imperial?: boolean; height?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const reduce = useReducedMotion();
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const unit = weightUnit(imperial);

  const points = useMemo(() => kgPoints.map((p) => ({ date: p.date, value: kgToUnit(p.weight_kg, imperial) })), [kgPoints, imperial]);
  const target = targetKg != null ? kgToUnit(targetKg, imperial) : null;
  const n = points.length;

  const values = points.map((p) => p.value);
  const dataLo = n ? Math.min(...values) : 0;
  const dataHi = n ? Math.max(...values) : 0;
  const near = imperial ? 6 / KG_PER_LB : 6;
  const targetInView = target != null && n > 0 && target >= dataLo - near && target <= dataHi + near;
  const y = yScaleFor(n ? (targetInView ? [...values, target as number] : values) : [0]);

  const innerW = Math.max(0, width - M.left - M.right);
  const innerH = height - M.top - M.bottom;
  const first = points[0]?.date;
  const last = points[n - 1]?.date;
  const spanDays = n > 1 ? Math.max(1, daysBetween(first, last)) : 1;
  const xAt = (date: string) => (n > 1 ? M.left + (daysBetween(first, date) / spanDays) * innerW : M.left + innerW / 2);
  const yAt = (v: number) => M.top + (1 - (v - y.min) / (y.max - y.min || 1)) * innerH;
  const coords = points.map((p) => ({ x: xAt(p.date), y: yAt(p.value) }));
  const line = monotonePath(coords);
  const baseY = M.top + innerH;
  const area = n > 1 ? `${line}L${coords[n - 1].x.toFixed(1)},${baseY}L${coords[0].x.toFixed(1)},${baseY}Z` : '';
  const xTicks = n > 1 ? [...new Set(innerW > 300 ? [0, Math.floor((n - 1) / 2), n - 1] : [0, n - 1])] : n ? [0] : [];

  // Draw the curve in whenever the data set changes size (first paint, new weigh-in).
  const reveal = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!width) return;
    if (reduce) {
      reveal.set(1);
      return;
    }
    reveal.set(0);
    reveal.set(withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [width, n, reduce, reveal]);
  // Polyline length (+ slack) ≥ the curve's length, so the dash fully hides the line at the start.
  const lineLen = coords.reduce((sum, c, i) => (i ? sum + Math.hypot(c.x - coords[i - 1].x, c.y - coords[i - 1].y) : 0), 0) * 1.2 + 12;
  const lineProps = useAnimatedProps(() => ({ strokeDashoffset: lineLen * (1 - reveal.get()) }));
  const washProps = useAnimatedProps(() => ({ opacity: reveal.get() }));
  const dotsProps = useAnimatedProps(() => ({ opacity: Math.max(0, reveal.get() * 2 - 1) }));

  const shown = active != null && active < n ? active : n - 1;
  const select = (x: number) => {
    if (!n) return;
    let best = 0;
    let dist = Infinity;
    coords.forEach((c, i) => {
      const d = Math.abs(c.x - x);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    if (best !== active) {
      haptics.select();
      setActive(best);
    }
  };

  const gesture = Gesture.Race(
    Gesture.Pan()
      .runOnJS(true)
      .activeOffsetX([-6, 6])
      .failOffsetY([-14, 14])
      .onBegin((e) => select(e.x))
      .onUpdate((e) => select(e.x)),
    Gesture.Tap()
      .runOnJS(true)
      .onEnd((e) => select(e.x)),
  );

  const onAccessibilityAction = (e: AccessibilityActionEvent) => {
    if (!n) return;
    const cur = shown;
    const next = e.nativeEvent.actionName === 'increment' ? Math.min(n - 1, cur + 1) : e.nativeEvent.actionName === 'decrement' ? Math.max(0, cur - 1) : cur;
    if (next !== active) {
      haptics.select();
      setActive(next);
    }
  };

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w > 0 && w !== width) setWidth(w);
  };

  const sel = n ? points[shown] : null;
  const prev = n && shown > 0 ? points[shown - 1] : null;
  const delta = sel && prev ? Math.round((sel.value - prev.value) * 10) / 10 : null;
  const selC = n ? coords[shown] : null;
  const summary =
    n > 1
      ? `Weight trend, ${n} weigh-ins from ${formatShortDate(first)} to ${formatShortDate(last)}: ${formatDecimal(points[0].value)} to ${formatDecimal(points[n - 1].value)} ${unit}.${target != null ? ` Target ${formatDecimal(target)} ${unit}.` : ''}`
      : n === 1
        ? `One weigh-in: ${formatDecimal(points[0].value)} ${unit} on ${formatShortDate(points[0].date)}.`
        : 'No weigh-ins yet.';

  return (
    <View>
      {sel ? (
        <View style={styles.readout} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <View style={styles.readoutLeft}>
            <Text variant="eyebrow" tone="subtle">
              {active == null || shown === n - 1 ? `Latest · ${formatDayDate(sel.date)}` : formatDayDate(sel.date)}
            </Text>
            <Text variant="title" style={styles.tabular}>
              {formatDecimal(sel.value)} {unit}
            </Text>
          </View>
          {delta != null ? (
            <Text variant="caption" tone="muted" style={styles.tabular}>
              {signed(delta)} {unit} vs {formatShortDate(prev!.date)}
            </Text>
          ) : null}
        </View>
      ) : null}

      <GestureDetector gesture={gesture}>
        <View
          onLayout={onLayout}
          style={{ height }}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={summary}
          accessibilityValue={sel ? { text: `${formatDecimal(sel.value)} ${unit} on ${formatDayDate(sel.date)}` } : undefined}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={onAccessibilityAction}
        >
          {width > 0 ? (
            <Svg width={width} height={height}>
              <Defs>
                <LinearGradient id={`stroke${id}`} x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor={colors.amber} />
                  <Stop offset="0.55" stopColor={colors.coral} />
                  <Stop offset="1" stopColor={colors.pink} />
                </LinearGradient>
                <LinearGradient id={`area${id}`} x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={colors.coral} stopOpacity={0.24} />
                  <Stop offset="0.7" stopColor={colors.amber} stopOpacity={0.06} />
                  <Stop offset="1" stopColor={colors.amber} stopOpacity={0} />
                </LinearGradient>
              </Defs>

              {/* grid + y labels */}
              {y.ticks.map((t) => (
                <G key={t}>
                  <Line x1={M.left} x2={width - M.right} y1={yAt(t)} y2={yAt(t)} stroke={GRID} strokeWidth={1} />
                  <SvgText x={M.left - 8} y={yAt(t) + 3.5} fontSize={10} fontFamily={fonts.mono} fill={AXIS} textAnchor="end">
                    {formatDecimal(t)}
                  </SvgText>
                </G>
              ))}

              {/* target */}
              {targetInView && target != null ? (
                <G>
                  <Line x1={M.left} x2={width - M.right} y1={yAt(target)} y2={yAt(target)} stroke={TARGET} strokeWidth={1.5} strokeDasharray="5 5" />
                  <Rect x={width - M.right - 74} y={yAt(target) - 19} width={74} height={16} rx={8} fill={colors.cyan50} />
                  <SvgText x={width - M.right - 37} y={yAt(target) - 7.5} fontSize={9.5} fontFamily={fonts.mono} fill={colors.cyan700} textAnchor="middle">
                    {`TARGET ${formatDecimal(target)}`}
                  </SvgText>
                </G>
              ) : null}

              {/* curve */}
              {area ? <AnimatedPath d={area} fill={`url(#area${id})`} animatedProps={washProps} /> : null}
              {n > 1 ? (
                <AnimatedPath
                  d={line}
                  stroke={`url(#stroke${id})`}
                  strokeWidth={2.5}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={[lineLen, lineLen]}
                  animatedProps={lineProps}
                />
              ) : null}
              {n <= 24 ? (
                <AnimatedG animatedProps={dotsProps}>
                  {coords.map((c, i) => (
                    <Circle key={points[i].date} cx={c.x} cy={c.y} r={2.4} fill={colors.white} stroke={colors.coral} strokeWidth={1.4} />
                  ))}
                </AnimatedG>
              ) : null}

              {/* selection */}
              {selC ? (
                <G>
                  {active != null ? <Line x1={selC.x} x2={selC.x} y1={M.top} y2={baseY} stroke="rgba(20,20,20,0.22)" strokeWidth={1} strokeDasharray="3 4" /> : null}
                  <Circle cx={selC.x} cy={selC.y} r={9} fill="rgba(255,122,106,0.18)" />
                  <Circle cx={selC.x} cy={selC.y} r={4.6} fill={colors.coral} stroke={colors.white} strokeWidth={2} />
                </G>
              ) : null}

              {/* x labels */}
              {xTicks.map((i) => (
                <SvgText
                  key={i}
                  x={n > 1 ? coords[i].x : M.left + innerW / 2}
                  y={height - 8}
                  fontSize={10}
                  fontFamily={fonts.mono}
                  fill={AXIS}
                  textAnchor={n > 1 ? (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') : 'middle'}
                >
                  {formatShortDate(points[i].date).toUpperCase()}
                </SvgText>
              ))}
            </Svg>
          ) : null}
        </View>
      </GestureDetector>

      {target != null && !targetInView && n > 0 ? (
        <View style={styles.offChart}>
          <View style={styles.dash} />
          <Text variant="caption" tone="muted">
            Target {formatDecimal(target)} {unit} sits {target < dataLo ? 'below' : 'above'} this view
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  readout: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, minHeight: 40, marginBottom: 6 },
  readoutLeft: { flexShrink: 1, gap: 2 },
  tabular: { fontVariant: ['tabular-nums'] },
  offChart: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  dash: { width: 18, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: TARGET },
});
