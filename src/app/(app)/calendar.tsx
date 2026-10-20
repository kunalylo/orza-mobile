/**
 * Calendar — month grid + selected-day agenda (medicine doses, reminders, meals and the user's own calendar, with
 * busy-day insights), "Add ÖRZA to my phone calendar" (expo-calendar), the private subscribe feed and connecting an
 * external iCal calendar. Pull to refresh; refreshes on dose / medicine changes.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { calendarKeys, useCalendarEvents, useCalendarStatus } from '@/features/calendar/api';
import { ConnectCard } from '@/features/calendar/ConnectCard';
import { DayAgenda } from '@/features/calendar/DayAgenda';
import { MonthGrid } from '@/features/calendar/MonthGrid';
import { PhoneCalendarCard } from '@/features/calendar/PhoneCalendarCard';
import { SubscribeCard } from '@/features/calendar/SubscribeCard';
import { KIND_COLOR, KIND_LABEL, type ExternalCalendarState } from '@/features/calendar/types';
import { BUSY_DAY_MINUTES, busyMinutes, formatMonth, groupByDate, KIND_ORDER, monthGridDates, monthOf, sameDayIn, shiftMonth } from '@/features/calendar/utils';
import { useLocalToday } from '@/features/meds/api';
import { onDoseEvent } from '@/features/meds/events';
import { DEFAULT_TZ } from '@/features/meds/shared';
import { ErrorPanel } from '@/features/meds/StatusViews';
import { errorMessage } from '@/lib/api';
import { useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { colors, spacing } from '@/theme';
import { Chip, GlassCard, Icon, IconButton, Screen, ScreenHeader, Text, toast } from '@/ui';

const enter = (i: number) => FadeInDown.delay(40 + i * 60).springify().damping(18).stiffness(100).mass(1);
const NOT_CONNECTED: ExternalCalendarState = { connected: false };

/**
 * The screen's one external-calendar state (banner, legend, busy days and "Connect your calendar" all read it). GET
 * /api/calendar never sends the calendar's name or a failed refresh — only /calendar/events does — so the events copy
 * wins. Connect / disconnect patch every cached range (features/calendar/api.ts), but while a new month loads the
 * previous month's copy is a frozen placeholder: it only stands in while it still describes the same link.
 */
function screenExternal(
  fromEvents: ExternalCalendarState | undefined,
  placeholder: boolean,
  fromStatus: ExternalCalendarState | undefined
): ExternalCalendarState {
  const sameLink = !fromStatus || !fromEvents || (fromStatus.connected === fromEvents.connected && fromStatus.url_preview === fromEvents.url_preview);
  return (placeholder && !sameLink ? fromStatus : fromEvents) ?? fromStatus ?? NOT_CONNECTED;
}

export default function CalendarScreen() {
  const user = useSignedInUser();
  const qc = useQueryClient();
  const statusQ = useCalendarStatus();
  const tz = statusQ.data?.tz || user.profile?.timezone || DEFAULT_TZ;
  const today = useLocalToday(tz);
  const [picked, setPicked] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const selected = picked ?? today;
  const month = monthOf(selected);
  const dates = monthGridDates(month);
  const from = dates[0];
  const to = dates[dates.length - 1];
  const eventsQ = useCalendarEvents(from, to);

  // Doses taken elsewhere (alarm, medicines) or medicine edits change what the calendar shows.
  useEffect(() => onDoseEvent(() => void qc.invalidateQueries({ queryKey: calendarKeys.eventsAll() })), [qc]);

  const loadedRange = eventsQ.data && eventsQ.data.from === from && eventsQ.data.to === to;
  const events = loadedRange && eventsQ.data ? eventsQ.data.events : [];
  const eventsTz = eventsQ.data?.tz || tz;
  const byDate = groupByDate(events, eventsTz);
  const external = screenExternal(eventsQ.data?.external, eventsQ.isPlaceholderData, statusQ.data?.external);
  const busyDates = new Set(external.connected ? dates.filter((d) => busyMinutes(events, d, eventsTz) >= BUSY_DAY_MINUTES) : []);
  const monthEvents = events.filter((e) => e.kind !== 'external');
  const doseCount = dates.filter((d) => d.startsWith(month)).reduce((n, d) => n + (byDate.get(d)?.filter((e) => e.kind === 'medication').length ?? 0), 0);
  const reminderCount = dates.filter((d) => d.startsWith(month)).reduce((n, d) => n + (byDate.get(d)?.filter((e) => e.kind === 'reminder').length ?? 0), 0);
  const isCurrentMonth = month === monthOf(today);

  const go = (delta: 1 | -1) => {
    const target = shiftMonth(month, delta);
    setPicked(target === monthOf(today) ? today : sameDayIn(target, selected));
  };

  async function onRefresh() {
    haptics.soft();
    setRefreshing(true);
    try {
      const [a, b] = await Promise.all([eventsQ.refetch(), statusQ.refetch(), qc.invalidateQueries({ queryKey: calendarKeys.phone() })]);
      const failed = [a, b].find((r) => r.isError && r.data !== undefined);
      if (failed) toast.error(errorMessage(failed.error));
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <Screen
      backdrop="orb"
      keyboard
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.coral} colors={[colors.coral]} progressBackgroundColor={colors.canvas} />
      }
    >
      <ScreenHeader
        back
        eyebrow="Care · Calendar"
        title="Calendar"
        subtitle="Medicines, reminders and meals in one view — with your own calendar alongside, so ÖRZA can help you plan food around busy days."
      />

      {/* Month */}
      <Animated.View entering={enter(0)}>
        <GlassCard tone="strong" padding={spacing.lg} style={styles.section}>
          <View style={styles.monthHead}>
            <IconButton icon="chevron-left" variant="glass" size={40} accessibilityLabel="Previous month" onPress={() => go(-1)} haptic="select" />
            <View style={styles.monthTitle}>
              <Text variant="eyebrow" tone="subtle" numberOfLines={1}>
                {loadedRange ? `${doseCount} doses · ${reminderCount} reminders` : 'Loading month'}
              </Text>
              <Text variant="h2" accessibilityRole="header" accessibilityLiveRegion="polite" numberOfLines={1}>
                {formatMonth(month)}
              </Text>
            </View>
            <IconButton icon="chevron-right" variant="glass" size={40} accessibilityLabel="Next month" onPress={() => go(1)} haptic="select" />
          </View>

          <View style={styles.legendRow}>
            <View style={styles.legend} accessibilityLabel="Legend">
              {KIND_ORDER.filter((k) => k !== 'external' || external.connected).map((k) => (
                <View key={k} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: KIND_COLOR[k] }]} />
                  <Text variant="caption" tone="muted">
                    {KIND_LABEL[k]}
                  </Text>
                </View>
              ))}
              {external.connected ? (
                <View style={styles.legendItem}>
                  <View style={[styles.legendDot, styles.busyDot]} />
                  <Text variant="caption" tone="muted">
                    Busy day (4 h+)
                  </Text>
                </View>
              ) : null}
            </View>
            {selected !== today || !isCurrentMonth ? (
              <Chip label="Today" icon="calendar" size="sm" onPress={() => setPicked(null)} accessibilityHint="Selects today" />
            ) : null}
          </View>

          {eventsQ.isError && !loadedRange ? (
            <ErrorPanel error={eventsQ.error} onRetry={() => void eventsQ.refetch()} retrying={eventsQ.isRefetching} style={styles.gridError} />
          ) : null}
          {external.connected && external.error && !eventsQ.isError ? (
            <View style={styles.extError}>
              <Icon name="alert-circle" size={14} color={colors.warning} />
              <Text variant="caption" tone="warning" style={styles.flex}>
                Your calendar couldn&apos;t be refreshed. See “Connect your calendar” below.
              </Text>
            </View>
          ) : null}

          <View style={styles.grid}>
            <MonthGrid
              month={month}
              dates={dates}
              today={today}
              selected={selected}
              byDate={byDate}
              busyDates={busyDates}
              loading={!loadedRange && !eventsQ.isError}
              onSelect={setPicked}
              onSwipe={go}
            />
          </View>
          {monthEvents.length === 0 && loadedRange ? (
            <Text variant="caption" tone="subtle" align="center" style={styles.quiet}>
              Nothing from ÖRZA this month yet — add a medicine or a reminder and it appears here.
            </Text>
          ) : null}
        </GlassCard>
      </Animated.View>

      {/* Agenda */}
      <Animated.View entering={enter(1)} style={styles.section}>
        <DayAgenda
          date={selected}
          today={today}
          events={byDate.get(selected) ?? []}
          tz={eventsTz}
          loading={!loadedRange && !eventsQ.isError}
          externalConnected={external.connected}
        />
      </Animated.View>

      {/* On this phone */}
      <Animated.View entering={enter(2)} style={styles.section}>
        <PhoneCalendarCard tz={eventsTz} today={today} />
      </Animated.View>

      {statusQ.isError && !statusQ.data ? (
        <View style={styles.section}>
          <Text variant="small" tone="muted" style={styles.statusErr}>
            Calendar settings didn&apos;t load.
          </Text>
          <ErrorPanel error={statusQ.error} onRetry={() => void statusQ.refetch()} retrying={statusQ.isRefetching} />
        </View>
      ) : (
        <>
          <Animated.View entering={enter(3)} style={styles.section}>
            <SubscribeCard feed={statusQ.data?.feed ?? null} isLocal={statusQ.data?.is_local ?? false} loading={statusQ.isPending} />
          </Animated.View>
          <Animated.View entering={enter(4)} style={styles.section}>
            <ConnectCard external={external} loading={statusQ.isPending} />
          </Animated.View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { marginTop: spacing.lg },
  monthHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  monthTitle: { flex: 1, alignItems: 'center' },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  legend: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.md, rowGap: 4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  busyDot: { backgroundColor: colors.violet, borderRadius: 2 },
  gridError: { marginTop: spacing.md },
  extError: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  grid: { marginTop: spacing.lg },
  quiet: { marginTop: spacing.sm },
  statusErr: { marginBottom: spacing.sm },
});
