/** The four "latest" tiles at the top of the Health screen: steps (with a target ring), sleep, resting HR, weight. */
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { colors, radii, spacing } from '@/theme';
import { EnergyRing, GlassCard, Icon, Skeleton, Text, type IconName } from '@/ui';

import { addDays, formatInt, formatKg, formatRelativeDay, formatSleep } from './format';
import type { HealthMetric, MergedHealthDay } from './types';

/** Latest day in `days` with a value for `metric`. */
export function latest(days: MergedHealthDay[], metric: HealthMetric): { date: string; value: number } | null {
  for (let i = days.length - 1; i >= 0; i--) {
    const v = days[i][metric];
    if (typeof v === 'number') return { date: days[i].date, value: v };
  }
  return null;
}

interface TileProps {
  label: string;
  icon: IconName;
  accent: string;
  value: string;
  unit?: string;
  hint: string;
  index: number;
  /** Progress towards a target (draws an energy ring around the icon). */
  ring?: { progress: number };
}

function Tile({ label, icon, accent, value, unit, hint, index, ring }: TileProps) {
  const reduce = useReducedMotion();
  return (
    <Animated.View entering={reduce ? undefined : FadeInDown.delay(60 + index * 60).springify().damping(18)} style={styles.cell}>
      <GlassCard padding={spacing.lg} style={styles.tile} accessible accessibilityLabel={`${label}: ${value}${unit ? ` ${unit}` : ''}. ${hint}`}>
        <View style={styles.tileHead}>
          <Text variant="eyebrow" tone="subtle" numberOfLines={1} style={styles.flex}>
            {label}
          </Text>
          {ring ? (
            <EnergyRing progress={ring.progress} size={30} stroke={4} delay={200 + index * 60}>
              <Icon name={icon} size={13} color={accent} />
            </EnergyRing>
          ) : (
            <View style={[styles.iconDot, { backgroundColor: `${accent}1F` }]}>
              <Icon name={icon} size={14} color={accent} />
            </View>
          )}
        </View>
        <View style={styles.valueRow}>
          <Text variant="h2" tone="ink" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={styles.value}>
            {value}
          </Text>
          {unit ? (
            <Text variant="caption" tone="muted">
              {unit}
            </Text>
          ) : null}
        </View>
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {hint}
        </Text>
      </GlassCard>
    </Animated.View>
  );
}

export function StatTiles({ days, today, stepTarget }: { days: MergedHealthDay[]; today: string; stepTarget: number }) {
  const steps = latest(days, 'steps');
  const sleep = latest(days, 'sleep_minutes');
  const resting = latest(days, 'resting_hr');
  const weight = latest(days, 'weight_kg');
  const rel = (d: string) => formatRelativeDay(d, today);
  const yesterday = addDays(today, -1);

  return (
    <View style={styles.grid}>
      <Tile
        index={0}
        label="Steps"
        icon="mci:shoe-print"
        accent={colors.coral}
        value={steps ? formatInt(steps.value) : '—'}
        hint={steps ? `${rel(steps.date)} · target ${formatInt(stepTarget)}` : 'No steps in this period'}
        ring={{ progress: steps ? steps.value / stepTarget : 0 }}
      />
      <Tile
        index={1}
        label="Sleep"
        icon="moon"
        accent={colors.violet}
        value={sleep ? formatSleep(sleep.value) : '—'}
        hint={
          sleep
            ? `Woke up ${sleep.date === today ? 'today' : sleep.date === yesterday ? 'yesterday' : rel(sleep.date)}`
            : 'No sleep in this period'
        }
      />
      <Tile
        index={2}
        label="Resting HR"
        icon="heart"
        accent="#E0593F"
        value={resting ? String(Math.round(resting.value)) : '—'}
        unit={resting ? 'bpm' : undefined}
        hint={resting ? rel(resting.date) : 'No readings in this period'}
      />
      <Tile
        index={3}
        label="Weight"
        icon="mci:scale-bathroom"
        accent={colors.cyan600}
        value={weight ? formatKg(weight.value) : '—'}
        unit={weight ? 'kg' : undefined}
        hint={weight ? rel(weight.date) : 'No weigh-ins in this period'}
      />
    </View>
  );
}

export function StatTilesSkeleton() {
  return (
    <View style={styles.grid} accessibilityLabel="Loading your latest numbers">
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={styles.cell}>
          <Skeleton height={118} radius={radii.md} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -spacing.xs - 2 },
  cell: { width: '50%', padding: spacing.xs + 2 },
  tile: { minHeight: 118, gap: spacing.xs },
  tileHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  iconDot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4, marginTop: spacing.xs },
  value: { flexShrink: 1, fontVariant: ['tabular-nums'] },
  flex: { flex: 1 },
});
