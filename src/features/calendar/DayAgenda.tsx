/**
 * Selected-day agenda: busy-day insights, then everything in time order — medicine doses (photo + status, tap → alarm or
 * medicine), reminders (→ Reminders), meals (→ that day's meal log) and events from the user's own calendar.
 */
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { MedPhoto } from '@/features/meds/MedPhoto';
import { colors, radii, spacing } from '@/theme';
import { GlassCard, Icon, PressableScale, Skeleton, Tag, Text, type IconName, type TagTone } from '@/ui';

import type { CalendarEvent, DoseEventStatus } from './types';
import { dayInsights, formatLongDate, formatTimeRange, parseDoseEventId, type DayInsight } from './utils';

const STATUS: Record<DoseEventStatus, { label: string; tone: TagTone }> = {
  upcoming: { label: 'Upcoming', tone: 'neutral' },
  due: { label: 'Due now', tone: 'energy' },
  snoozed: { label: 'Snoozed', tone: 'info' },
  taken: { label: 'Taken', tone: 'success' },
  skipped: { label: 'Skipped', tone: 'neutral' },
  missed: { label: 'Missed', tone: 'error' },
};

const KIND_ICON: Record<CalendarEvent['kind'], IconName> = {
  medication: 'mci:pill',
  reminder: 'bell',
  meal: 'mci:silverware-fork-knife',
  external: 'calendar',
};

// Tab routes (medicines, meals) use dismissTo: it returns to the existing tabs instead of stacking a second copy.
function openEvent(e: CalendarEvent, date: string) {
  if (e.kind === 'medication') {
    const dose = parseDoseEventId(e.id);
    if (!dose) return router.dismissTo('/medicines');
    const acted = e.status === 'taken' || e.status === 'skipped';
    if (acted) return router.push({ pathname: '/med/[id]', params: { id: dose.medicationId } });
    return router.push({ pathname: '/alarm', params: { med: dose.medicationId, at: dose.at } });
  }
  if (e.kind === 'meal') return router.dismissTo({ pathname: '/meals', params: { date } });
  if (e.kind === 'reminder') return router.push('/reminders');
}

function EventRow({ event: e, tz, date }: { event: CalendarEvent; tz: string; date: string }) {
  const status = e.status ? STATUS[e.status] : null;
  const time = formatTimeRange(e, tz, date);
  const acted = e.status === 'taken' || e.status === 'skipped';
  const pressable = e.kind !== 'external';
  const hint =
    e.kind === 'medication' ? (acted ? 'Opens the medicine' : 'Opens the alarm with photos') : e.kind === 'meal' ? 'Opens the meal log' : e.kind === 'reminder' ? 'Opens reminders' : undefined;

  const content = (
    <>
      <View style={styles.time}>
        <Text variant="label" numberOfLines={1}>
          {time.split(' – ')[0]}
        </Text>
        {time.includes(' – ') ? (
          <Text variant="caption" tone="subtle" numberOfLines={1}>
            {time.split(' – ')[1]}
          </Text>
        ) : null}
      </View>
      <View style={[styles.accent, { backgroundColor: e.color }]} />
      {e.kind === 'medication' ? (
        <MedPhoto url={e.photo_url} size={40} radius={10} />
      ) : (
        <View style={[styles.kindIcon, { backgroundColor: `${e.color}22` }]}>
          <Icon name={KIND_ICON[e.kind]} size={18} color={e.kind === 'meal' ? colors.warning : e.kind === 'reminder' ? colors.cyan700 : colors.violet600} />
        </View>
      )}
      <View style={styles.body}>
        <Text variant="label" numberOfLines={2} style={acted ? styles.acted : undefined}>
          {e.title}
        </Text>
        {e.subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {e.subtitle}
          </Text>
        ) : null}
        {status ? <Tag label={status.label} tone={status.tone} style={styles.tag} /> : null}
      </View>
      {pressable ? <Icon name="chevron-right" size={16} color={colors.subtle} /> : null}
    </>
  );

  const label = `${e.title}, ${time}${status ? `, ${status.label}` : ''}${e.subtitle ? `. ${e.subtitle}` : ''}`;
  if (!pressable) {
    return (
      <View style={styles.row} accessible accessibilityLabel={label}>
        {content}
      </View>
    );
  }
  return (
    <PressableScale haptic="tap" scaleTo={0.98} onPress={() => openEvent(e, date)} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint} style={styles.row}>
      {content}
    </PressableScale>
  );
}

function InsightCard({ insight }: { insight: DayInsight }) {
  const energy = insight.tone === 'energy';
  return (
    <View style={[styles.insight, energy ? styles.insightEnergy : styles.insightCyan]} accessible accessibilityLabel={`${insight.title}. ${insight.body}`}>
      <Icon name={energy ? 'mci:food-apple-outline' : 'mci:pill'} size={18} color={energy ? colors.energyInk : colors.cyan700} />
      <View style={styles.body}>
        <Text variant="label">{insight.title}</Text>
        <Text variant="caption" tone="muted">
          {insight.body}
        </Text>
      </View>
    </View>
  );
}

export function DayAgenda({
  date,
  today,
  events,
  tz,
  loading,
  externalConnected,
}: {
  date: string;
  today: string;
  events: CalendarEvent[];
  tz: string;
  loading: boolean;
  externalConnected: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const insights = dayInsights(events, date, tz);
  const doses = events.filter((e) => e.kind === 'medication');
  const taken = doses.filter((d) => d.status === 'taken').length;
  const isToday = date === today;

  return (
    <GlassCard padding={spacing.lg}>
      <View style={styles.head}>
        <View style={styles.body}>
          <Text variant="eyebrow" tone={isToday ? 'energy' : 'subtle'}>
            {isToday ? 'Today' : date < today ? 'Past day' : 'Coming up'}
          </Text>
          <Text variant="h3" accessibilityRole="header" accessibilityLiveRegion="polite">
            {formatLongDate(date)}
          </Text>
        </View>
        {doses.length > 0 && date <= today ? <Tag label={`${taken}/${doses.length} doses taken`} tone={taken === doses.length ? 'success' : 'neutral'} /> : null}
      </View>

      {insights.length ? (
        <View style={styles.insights} accessibilityLabel="Insights for this day">
          {insights.map((i) => (
            <InsightCard key={i.id} insight={i} />
          ))}
        </View>
      ) : null}

      <View style={styles.list}>
        {loading ? (
          [0, 1, 2].map((i) => (
            <View key={i} style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <Skeleton width={48} height={14} />
              <Skeleton width={40} height={40} radius={10} />
              <View style={[styles.body, styles.skelBody]}>
                <Skeleton width="70%" height={14} />
                <Skeleton width="45%" height={11} />
              </View>
            </View>
          ))
        ) : events.length === 0 ? (
          <View style={styles.empty}>
            <Icon name="mci:calendar-blank-outline" size={26} color={colors.subtle} />
            <Text variant="title" align="center">
              {date < today ? 'Nothing logged this day' : 'A clear day'}
            </Text>
            <Text variant="small" tone="muted" align="center">
              {date < today
                ? 'No doses, reminders or meals were recorded.'
                : 'No medicines, reminders or events here yet. Add a medicine or a reminder and it will show up on this calendar.'}
            </Text>
            {!externalConnected ? (
              <Text variant="caption" tone="subtle" align="center">
                Connect your own calendar below to see your meetings here too.
              </Text>
            ) : null}
          </View>
        ) : (
          events.map((e, i) => (
            <Animated.View key={`${e.id}-${date}`} entering={reduceMotion ? undefined : FadeInDown.delay(Math.min(i, 8) * 30).springify().damping(20).stiffness(100).mass(1)}>
              <EventRow event={e} tz={tz} date={date} />
            </Animated.View>
          ))
        )}
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  body: { flex: 1, minWidth: 0, gap: 2 },
  skelBody: { gap: 6 },
  insights: { marginTop: spacing.md, gap: spacing.sm },
  insight: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth },
  insightEnergy: { backgroundColor: colors.energyBg, borderColor: 'rgba(255,122,106,0.28)' },
  insightCyan: { backgroundColor: colors.cyan50, borderColor: 'rgba(11,143,166,0.22)' },
  list: { marginTop: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  time: { width: 62 },
  accent: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
  kindIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  acted: { opacity: 0.7 },
  tag: { marginTop: 4 },
  empty: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl, paddingHorizontal: spacing.md },
});
