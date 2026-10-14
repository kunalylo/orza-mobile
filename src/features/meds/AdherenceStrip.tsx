/** 7-day adherence: the overall rate on an energy ring + one small ring per day (taken / doses due so far). */
import { StyleSheet, View } from 'react-native';

import { colors, fonts, radii, spacing } from '@/theme';
import { EnergyRing, Icon, Skeleton, Text } from '@/ui';

import { formatDateShort, weekdayOf, WEEKDAYS } from './shared';
import type { AdherenceDay, AdherenceResponse } from './types';

type DayTone = 'none' | 'future' | 'full' | 'partial' | 'low';

function dayTone(t: AdherenceDay): DayTone {
  if (!t.scheduled) return 'none';
  if (!t.total) return 'future';
  const r = t.taken / t.total;
  if (r >= 0.999) return 'full';
  if (r >= 0.5) return 'partial';
  return 'low';
}

const PALETTE = { full: 'success', partial: 'energy', low: 'energyDeep', future: 'cyan', none: 'cyan' } as const;

function dayLabel(d: AdherenceDay, today: string): string {
  const day = `${d.date === today ? 'Today, ' : ''}${formatDateShort(d.date)}`;
  if (!d.scheduled) return `${day}: no doses scheduled`;
  return `${day}: ${d.taken} of ${d.total} due doses taken${d.missed ? `, ${d.missed} missed` : ''}${d.skipped ? `, ${d.skipped} skipped` : ''}${d.upcoming ? `, ${d.upcoming} still to come` : ''}`;
}

export function AdherenceSkeleton() {
  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <Skeleton circle height={64} />
        <View style={styles.flex}>
          <Skeleton width="70%" height={14} />
          <Skeleton width="45%" height={12} style={styles.gapTop} />
        </View>
      </View>
      <View style={styles.days}>
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} height={74} radius={radii.sm} style={styles.flex} />
        ))}
      </View>
    </View>
  );
}

export function AdherenceStrip({ data, today }: { data: AdherenceResponse; today: string }) {
  const { overall } = data;
  const pct = overall.rate != null ? Math.round(overall.rate * 100) : null;

  return (
    <View style={styles.wrap}>
      <View style={styles.head}>
        <EnergyRing
          progress={overall.rate ?? 0}
          size={64}
          stroke={7}
          palette={pct != null && pct >= 90 ? 'success' : 'energy'}
          accessibilityLabel={pct != null ? `${pct} percent of due doses taken in the last 7 days` : 'No doses due yet in the last 7 days'}
        >
          <Text style={styles.pct}>
            {pct != null ? pct : '–'}
            {pct != null ? <Text style={styles.pctSign}>%</Text> : null}
          </Text>
        </EnergyRing>
        <View style={styles.flex}>
          {overall.total ? (
            <Text variant="small" tone="muted">
              <Text variant="small" weight="semibold" tone="ink">
                {overall.taken}
              </Text>{' '}
              of {overall.total} doses taken in the last 7 days
            </Text>
          ) : (
            <Text variant="small" tone="muted">
              This fills in as doses come due.
            </Text>
          )}
          {overall.missed ? (
            <Text variant="caption" tone="error" style={styles.gapTopXs}>
              {overall.missed === 1 ? '1 dose missed' : `${overall.missed} doses missed`}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.days} accessibilityLabel="Doses taken each day, last 7 days">
        {data.daily.map((d, i) => {
          const tone = dayTone(d);
          const isToday = d.date === today;
          return (
            <View key={d.date} style={[styles.day, isToday && styles.dayToday]} accessible accessibilityLabel={dayLabel(d, today)}>
              <Text variant="eyebrow" style={[styles.dayName, isToday && styles.dayNameToday]}>
                {WEEKDAYS[weekdayOf(d.date)]}
              </Text>
              {tone === 'none' ? (
                <View style={styles.noneRing}>
                  <Text variant="small" tone="subtle">
                    –
                  </Text>
                </View>
              ) : (
                <EnergyRing progress={d.total ? d.taken / d.total : 0} size={32} stroke={4} palette={PALETTE[tone]} delay={i * 50}>
                  {tone === 'full' ? <Icon name="check" size={13} color={colors.success} /> : null}
                </EnergyRing>
              )}
              <Text variant="caption" tone="muted" style={styles.count}>
                {d.scheduled ? `${d.taken}/${d.total || d.scheduled}` : ' '}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  wrap: { gap: spacing.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  gapTop: { marginTop: spacing.sm },
  gapTopXs: { marginTop: spacing.xs },
  pct: { fontFamily: fonts.display, fontSize: 20, lineHeight: 24, color: colors.ink, fontVariant: ['tabular-nums'] },
  pctSign: { fontFamily: fonts.body, fontSize: 11, color: colors.subtle },
  days: { flexDirection: 'row', gap: 5 },
  day: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 5,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(20,20,20,0.06)',
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  dayToday: { borderColor: 'rgba(11,190,220,0.35)', backgroundColor: '#F1FCFF' },
  dayName: { fontSize: 9.5, letterSpacing: 0.8, color: colors.subtle },
  dayNameToday: { color: colors.cyan700 },
  noneRing: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  count: { fontSize: 11, fontVariant: ['tabular-nums'] },
});
