/** Reports — a gentle daily check-in and a weekly view you can share (CSV). See src/features/reports. */
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addDays, isImperial, todayInTz } from '@/features/goals/math';
import { useDailyReport, useEnsureWeekly, useWeeklyReport } from '@/features/reports/api';
import { CalendarSheet } from '@/features/reports/CalendarSheet';
import { DailyReportView, DailySkeleton } from '@/features/reports/DailyReportView';
import { DateStepper } from '@/features/reports/DateStepper';
import { dayLabel, rangeLabel } from '@/features/reports/format';
import { ShareUnavailableError, shareWeeklyCsv } from '@/features/reports/share';
import { WeeklyReportView, WeeklySkeleton } from '@/features/reports/WeeklyReportView';
import { errorMessage } from '@/lib/api';
import { useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { colors, gutter, spacing } from '@/theme';
import { Button, EmptyState, GlassCard, IconButton, Screen, ScreenHeader, Segmented, Text, toast } from '@/ui';

type Tab = 'daily' | 'weekly';

export default function Reports() {
  const user = useSignedInUser();
  const insets = useSafeAreaInsets();
  const imperial = isImperial(user.preferences?.units);
  const today = todayInTz(user.profile?.timezone);

  const [tab, setTab] = useState<Tab>('daily');
  const [date, setDate] = useState(today);
  const [end, setEnd] = useState(today);
  const [weeklyOpened, setWeeklyOpened] = useState(false);
  const [calendar, setCalendar] = useState<Tab | null>(null);
  const [sharing, setSharing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const daily = useDailyReport(date);
  // Weekly loads lazily — the first time the tab is opened (or a CSV is shared), then whenever the week changes.
  const weekly = useWeeklyReport(end, tab === 'weekly' || weeklyOpened);
  const ensureWeekly = useEnsureWeekly();

  const changeTab = (t: Tab) => {
    setTab(t);
    if (t === 'weekly') setWeeklyOpened(true);
  };

  async function shareCsv() {
    setSharing(true);
    setWeeklyOpened(true);
    try {
      const w = weekly.data && weekly.data.end === end && !weekly.isPlaceholderData ? weekly.data : await ensureWeekly(end);
      await shareWeeklyCsv(w, imperial);
    } catch (e) {
      haptics.error();
      toast.error(e instanceof ShareUnavailableError ? e.message : errorMessage(e, "Couldn't share your weekly report. Please try again."));
    } finally {
      setSharing(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    try {
      await (tab === 'daily' ? daily.refetch() : weekly.refetch());
    } finally {
      setRefreshing(false);
    }
  }

  const d = daily.data;
  const dStale = !!d && (d.date !== date || daily.isPlaceholderData);
  const w = weekly.data;
  const wStale = !!w && (w.end !== end || weekly.isPlaceholderData);

  return (
    <Screen backdrop="orb" scroll={false} padded={false} edges={['top']} contentContainerStyle={styles.noPad}>
      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xxxl }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.coral} colors={[colors.coral]} />}
      >
        <ScreenHeader
          back
          large={false}
          eyebrow="Reports"
          title="Your wellness, in numbers"
          subtitle="A gentle daily check-in and a weekly view you can share with your doctor."
          right={<IconButton icon="share" accessibilityLabel="Share this week as a CSV file" onPress={shareCsv} disabled={sharing} />}
        />

        <Segmented<Tab>
          accessibilityLabel="Report period"
          value={tab}
          onChange={changeTab}
          options={[
            { value: 'daily', label: 'Daily' },
            { value: 'weekly', label: 'Weekly' },
          ]}
        />

        {tab === 'daily' ? (
          <View style={styles.body}>
            <View style={styles.nav}>
              <DateStepper
                label={dayLabel(date, today)}
                sublabel={date === today ? 'So far today' : undefined}
                onPrev={() => setDate(addDays(date, -1))}
                onNext={() => setDate(addDays(date, 1) > today ? today : addDays(date, 1))}
                prevLabel="Previous day"
                nextLabel="Next day"
                nextDisabled={date >= today}
                onPressLabel={() => setCalendar('daily')}
                pressLabelHint="Opens a calendar to pick a day"
              />
              {date !== today ? <Button label="Back to today" variant="ghost" size="sm" icon="rotate-ccw" onPress={() => setDate(today)} style={styles.back} /> : null}
            </View>

            {!d && daily.isPending ? (
              <DailySkeleton />
            ) : daily.isError && (!d || dStale) ? (
              <GlassCard tone="strong">
                <EmptyState icon="wifi-off" title="Couldn't load this report" body={errorMessage(daily.error)} actionLabel="Try again" onAction={() => void daily.refetch()} />
              </GlassCard>
            ) : d ? (
              <DailyReportView report={d} imperial={imperial} dimmed={dStale} />
            ) : null}
          </View>
        ) : (
          <View style={styles.body}>
            <View style={styles.nav}>
              <DateStepper
                label={rangeLabel(addDays(end, -6), end)}
                sublabel={end === today ? 'Last 7 days' : undefined}
                onPrev={() => setEnd(addDays(end, -7))}
                onNext={() => setEnd(addDays(end, 7) > today ? today : addDays(end, 7))}
                prevLabel="Previous week"
                nextLabel="Next week"
                nextDisabled={end >= today}
                onPressLabel={() => setCalendar('weekly')}
                pressLabelHint="Opens a calendar to pick the last day of the week"
              />
              {end !== today ? <Button label="Back to this week" variant="ghost" size="sm" icon="rotate-ccw" onPress={() => setEnd(today)} style={styles.back} /> : null}
            </View>

            {!w && weekly.isPending ? (
              <WeeklySkeleton />
            ) : weekly.isError && (!w || wStale) ? (
              <GlassCard tone="strong">
                <EmptyState icon="wifi-off" title="Couldn't load this week" body={errorMessage(weekly.error)} actionLabel="Try again" onAction={() => void weekly.refetch()} />
              </GlassCard>
            ) : w ? (
              <>
                <WeeklyReportView report={w} today={today} imperial={imperial} dimmed={wStale} />
                <GlassCard style={styles.shareCard}>
                  <Text variant="eyebrow" tone="subtle">
                    Export
                  </Text>
                  <Text variant="h3" accessibilityRole="header" style={styles.shareTitle}>
                    Share this week
                  </Text>
                  <Text variant="small" tone="muted" style={styles.shareBody}>
                    A spreadsheet (CSV) of every day plus your averages and targets — save it to Files, email it or send it to your doctor.
                  </Text>
                  <Button label="Share weekly CSV" icon="share" variant="primary" block loading={sharing} onPress={shareCsv} />
                </GlassCard>
              </>
            ) : null}
          </View>
        )}
      </ScrollView>

      <CalendarSheet
        visible={calendar != null}
        onClose={() => setCalendar(null)}
        value={calendar === 'weekly' ? end : date}
        max={today}
        title={calendar === 'weekly' ? 'Week ending on…' : 'Pick a day'}
        onSelect={(v) => (calendar === 'weekly' ? setEnd(v) : setDate(v))}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  noPad: { paddingBottom: 0 },
  content: { paddingHorizontal: gutter },
  body: { marginTop: spacing.xl },
  nav: { marginBottom: spacing.xl, gap: spacing.sm },
  back: { alignSelf: 'center' },
  shareCard: { marginTop: spacing.lg },
  shareTitle: { marginTop: 4 },
  shareBody: { marginTop: spacing.sm, marginBottom: spacing.lg },
});
