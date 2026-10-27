/**
 * Reminders & alarms — up-next hero, "Alarms on this phone" (permissions with one-tap fixes, next alarm, doses inside
 * quiet hours, Test alarm), one-tap presets, the reminder list (switch on/off, tap to edit in a sheet), medicine alarms
 * shortcut, WhatsApp (only when configured), quiet hours and how delivery works. Pull to refresh.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition, useReducedMotion } from 'react-native-reanimated';

import { AlarmStatusCard } from '@/features/alarms/AlarmStatusCard';
import { ErrorPanel } from '@/features/meds/StatusViews';
import { useAddPreset, useIntegrations, useReminders, useResumeReminders, useToggleReminder } from '@/features/reminders/api';
import { NotificationsCard } from '@/features/reminders/NotificationsCard';
import { useNotificationPermission } from '@/features/reminders/notifications';
import { CardHeader, IconTile } from '@/features/reminders/parts';
import { QuietHoursCard } from '@/features/reminders/QuietHoursCard';
import { ReminderRow, ReminderRowSkeleton } from '@/features/reminders/ReminderRow';
import { ReminderSheet } from '@/features/reminders/ReminderSheet';
import { describeNext, KIND_ICON, MAX_REMINDERS, presetAdded, REMINDER_PRESETS, type ReminderPreset } from '@/features/reminders/shared';
import type { ReminderView } from '@/features/reminders/types';
import { WhatsAppCard } from '@/features/reminders/WhatsAppCard';
import { alarmAdapter } from '@/lib/alarms/adapter';
import { errorMessage } from '@/lib/api';
import { useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, EmptyState, GlassCard, Icon, IconButton, Orb, PressableScale, Screen, ScreenHeader, Skeleton, Tag, Text, toast } from '@/ui';

const enter = (i: number) => FadeInDown.delay(40 + i * 50).springify().damping(18).stiffness(100).mass(1);
/** This build rings alarms on the phone (the native module / iOS notifications) — not Expo Go or the web preview. */
const alarmsOnPhone = alarmAdapter.maxScheduled > 0;

export default function Reminders() {
  const user = useSignedInUser();
  const reduceMotion = useReducedMotion();
  const list = useReminders();
  const integrationsQ = useIntegrations();
  const notif = useNotificationPermission();
  const toggle = useToggleReminder();
  const addPreset = useAddPreset();
  const resume = useResumeReminders();
  const [sheet, setSheet] = useState<{ open: boolean; reminder: ReminderView | null }>({ open: false, reminder: null });
  const [refreshing, setRefreshing] = useState(false);
  const [pendingPreset, setPendingPreset] = useState<string | null>(null);

  const integrations = integrationsQ.data;
  const tz = integrations?.timezone || user.profile?.timezone || 'Asia/Kolkata';
  const reminders = list.data ?? [];
  const activeCount = reminders.filter((r) => r.active).length;
  const atLimit = reminders.length >= MAX_REMINDERS;
  const whatsappAvailable = !!integrations?.whatsapp.configured;
  const whatsappReady = whatsappAvailable && !!integrations?.whatsapp.opt_in && !!integrations?.whatsapp.phone;
  const remindersEnabled = integrations ? integrations.reminders_enabled : user.preferences?.reminders !== false;
  const layout = reduceMotion ? undefined : LinearTransition.springify().damping(20).stiffness(100).mass(1);

  const upNext = reminders
    .filter((r) => r.active && r.next_at)
    .sort((a, b) => Date.parse(a.next_at ?? '') - Date.parse(b.next_at ?? ''))[0];

  const openNew = () => {
    if (atLimit) {
      haptics.warning();
      toast.info(`You've reached ${MAX_REMINDERS} reminders — delete one to add another.`);
      return;
    }
    setSheet({ open: true, reminder: null });
  };

  async function onRefresh() {
    haptics.soft();
    setRefreshing(true);
    try {
      const [a, b] = await Promise.all([list.refetch(), integrationsQ.refetch(), notif.refresh()]);
      const failed = [a, b].find((r) => r.isError && r.data !== undefined);
      if (failed) toast.error(errorMessage(failed.error));
    } finally {
      setRefreshing(false);
    }
  }

  const onToggle = (r: ReminderView, active: boolean) => {
    toggle.mutate(
      { reminder: r, active },
      {
        onError: (e) => {
          haptics.error();
          toast.error(errorMessage(e));
        },
      }
    );
  };

  const onPreset = (p: ReminderPreset) => {
    if (pendingPreset || atLimit) return;
    setPendingPreset(p.key);
    addPreset.mutate(
      { preset: p, whatsappReady },
      {
        onSuccess: () => {
          haptics.success();
          toast.success(`Added “${p.label}”`);
        },
        onError: (e) => {
          haptics.error();
          toast.error(errorMessage(e));
        },
        onSettled: () => setPendingPreset(null),
      }
    );
  };

  const onResume = () =>
    resume.mutate(undefined, {
      onSuccess: () => {
        haptics.success();
        toast.success('Gentle reminders are back on');
      },
      onError: (e) => {
        haptics.error();
        toast.error(errorMessage(e));
      },
    });

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
        eyebrow="Care · Reminders"
        title="Reminders & alarms"
        subtitle="Gentle nudges for meals, water and weigh-ins — and medicine alarms that show a photo of every medicine."
        right={<IconButton icon="plus" variant="solid" accessibilityLabel="New reminder" onPress={openNew} haptic="firm" disabled={!list.isSuccess} />}
      />

      {!remindersEnabled ? (
        <Animated.View entering={enter(0)}>
          <GlassCard padding={spacing.lg} style={[styles.section, styles.paused]} accessibilityRole="alert">
            <View style={styles.row}>
              <Icon name="bell-off" size={18} color={colors.warning} />
              <Text variant="small" tone="text" style={styles.flex}>
                Meal, water and weigh-in reminders are paused (Settings → Gentle reminders). Medicine alarms still ring.
              </Text>
            </View>
            <Button label="Turn reminders back on" variant="primary" size="sm" loading={resume.isPending} onPress={onResume} style={styles.pausedBtn} />
          </GlassCard>
        </Animated.View>
      ) : null}

      {/* Up next */}
      <Animated.View entering={enter(1)}>
        <GlassCard tone="hero" glow padding={spacing.xl} style={styles.section}>
          <View style={styles.heroOrb} pointerEvents="none">
            <Orb size={120} tone="dark" orbits={false} paused={reduceMotion} />
          </View>
          <Text variant="eyebrow" tone="heroSubtle">
            Up next
          </Text>
          {list.isPending ? (
            <View style={styles.heroSkel}>
              <Skeleton width="70%" height={22} />
              <Skeleton width="40%" height={14} />
            </View>
          ) : upNext ? (
            <>
              <Text variant="h2" tone="inverse" numberOfLines={2} style={styles.heroTitle}>
                {upNext.title}
              </Text>
              <Text variant="callout" tone="heroMuted">
                {describeNext(upNext.next_at, tz)}
              </Text>
            </>
          ) : (
            <>
              <Text variant="h2" tone="inverse" style={styles.heroTitle}>
                Nothing scheduled
              </Text>
              <Text variant="small" tone="heroMuted">
                Add a reminder and ÖRZA will nudge you right on time.
              </Text>
            </>
          )}
          <View style={styles.heroTags}>
            <Tag label={`${activeCount} active`} tone="hero" icon="bell" />
            {integrations?.quiet_hours ? <Tag label="Quiet hours on" tone="hero" icon="moon" /> : null}
          </View>
        </GlassCard>
      </Animated.View>

      <Animated.View entering={enter(2)} style={styles.section}>
        {alarmsOnPhone ? (
          <AlarmStatusCard browserCount={integrations?.push.subscriptions ?? 0} />
        ) : (
          <NotificationsCard status={notif.status} asking={notif.asking} onEnable={() => void notif.request()} browserCount={integrations?.push.subscriptions ?? 0} />
        )}
      </Animated.View>

      {/* Your reminders */}
      <Animated.View entering={enter(3)} layout={layout}>
        <GlassCard padding={spacing.lg} style={styles.section}>
          <CardHeader
            icon="clock"
            tone="energy"
            eyebrow={list.isSuccess ? `${activeCount} active` : 'Reminders'}
            title="Your reminders"
            body="Nudges to log meals, drink water and weigh in. Times follow your timezone."
            right={<Button label="Add" icon="plus" variant="secondary" size="sm" onPress={openNew} disabled={!list.isSuccess || atLimit} />}
          />

          <Text variant="eyebrow" tone="subtle" style={styles.presetLabel}>
            One-tap presets
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.presets} style={styles.presetScroll} keyboardShouldPersistTaps="handled">
            {REMINDER_PRESETS.map((p) => {
              const added = list.isSuccess && presetAdded(p, reminders);
              const pending = pendingPreset === p.key;
              return (
                <PressableScale
                  key={p.key}
                  haptic="tap"
                  disabled={added || !!pendingPreset || atLimit || !list.isSuccess}
                  onPress={() => onPreset(p)}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: added || !list.isSuccess, busy: pending }}
                  accessibilityLabel={added ? `${p.label} (${p.hint}) — already added` : `Add ${p.label} (${p.hint})`}
                  style={[styles.preset, added && styles.presetAdded, pending && styles.presetPending]}
                >
                  <Icon name={added ? 'check' : KIND_ICON[p.kind]} size={15} color={added ? colors.success : colors.energyInk} />
                  <View>
                    <Text variant="label" color={added ? colors.success : colors.ink}>
                      {p.label}
                    </Text>
                    <Text variant="caption" color={added ? colors.success : colors.subtle}>
                      {added ? 'Added' : pending ? 'Adding…' : p.hint}
                    </Text>
                  </View>
                </PressableScale>
              );
            })}
          </ScrollView>

          <View style={styles.list}>
            {list.isPending ? (
              <>
                <ReminderRowSkeleton />
                <ReminderRowSkeleton />
                <ReminderRowSkeleton />
              </>
            ) : list.isError && !list.data ? (
              <ErrorPanel error={list.error} onRetry={() => void list.refetch()} retrying={list.isRefetching} />
            ) : reminders.length === 0 ? (
              <EmptyState
                icon="mci:bell-plus-outline"
                title="No reminders yet"
                body="Tap a preset above, or create your own — ÖRZA will nudge you right on time."
                actionLabel="New reminder"
                actionVariant="energy"
                onAction={openNew}
              />
            ) : (
              reminders.map((r) => (
                <Animated.View key={r.id} layout={layout}>
                  <ReminderRow
                    reminder={r}
                    tz={tz}
                    whatsapp={whatsappAvailable}
                    busy={toggle.isPending && toggle.variables?.reminder.id === r.id}
                    onToggle={(v) => onToggle(r, v)}
                    onEdit={() => setSheet({ open: true, reminder: r })}
                  />
                </Animated.View>
              ))
            )}
          </View>
          {atLimit ? (
            <Text variant="caption" tone="warning" style={styles.limit}>
              You&apos;ve reached {MAX_REMINDERS} reminders — delete one to add another.
            </Text>
          ) : null}
        </GlassCard>
      </Animated.View>

      {/* Medicine alarms */}
      <Animated.View entering={enter(4)}>
        <GlassCard tone="energy" padding={spacing.lg} style={styles.section}>
          <View style={styles.row}>
            <IconTile icon="mci:pill" tone="energy" />
            <View style={styles.flex}>
              <Text variant="eyebrow" tone="subtle">
                Medicine alarms
              </Text>
              <Text variant="h3" accessibilityRole="header">
                Set up in Medicines
              </Text>
            </View>
          </View>
          <Text variant="small" tone="muted" style={styles.body}>
            Each medicine rings at its own times with its photo. Scan a prescription and ÖRZA creates the alarms for you.
          </Text>
          <View style={styles.actions}>
            <Button label="Open Medicines" iconRight="chevron-right" variant="primary" size="sm" onPress={() => router.dismissTo('/medicines')} />
            <Button label="Scan a prescription" icon="camera" variant="secondary" size="sm" onPress={() => router.push('/rx')} />
          </View>
        </GlassCard>
      </Animated.View>

      {integrations ? (
        <>
          {whatsappAvailable ? (
            <Animated.View entering={enter(5)} style={styles.section}>
              <WhatsAppCard integrations={integrations} />
            </Animated.View>
          ) : null}
          <Animated.View entering={enter(6)} style={styles.section}>
            <QuietHoursCard integrations={integrations} />
          </Animated.View>
        </>
      ) : integrationsQ.isError ? (
        <View style={styles.section}>
          <ErrorPanel error={integrationsQ.error} onRetry={() => void integrationsQ.refetch()} retrying={integrationsQ.isRefetching} />
        </View>
      ) : (
        <GlassCard padding={spacing.lg} style={styles.section}>
          <Skeleton width="50%" height={20} />
          <Skeleton width="90%" height={12} style={styles.skelGap} />
          <Skeleton width="70%" height={12} style={styles.skelGap} />
        </GlassCard>
      )}

      {/* How it works */}
      <Animated.View entering={enter(7)}>
        <GlassCard padding={spacing.lg} style={styles.section}>
          <CardHeader
            icon="info"
            tone="cyan"
            eyebrow="How it works"
            title="When reminders arrive"
            body={
              alarmsOnPhone
                ? 'Alarms and reminders are set on this phone itself, so they ring on time — even offline, locked or with ÖRZA closed. They update whenever your medicines, reminders or quiet hours change.'
                : 'ÖRZA checks for due alarms every minute, so a web notification can arrive up to a minute after its time.'
            }
          />
          <View style={styles.howList}>
            <HowRow
              tag="Phone"
              tone="energy"
              text={
                alarmsOnPhone
                  ? 'Medicine doses ring as an alarm with the photo of each medicine and Take / Snooze 10 min / Skip; meal, water and weigh-in reminders arrive as notifications.'
                  : 'Notifications on each device where you turned them on, plus the full-screen alarm when ÖRZA is open.'
              }
            />
            {whatsappAvailable ? <HowRow tag="WhatsApp" tone="info" text="Messages from ÖRZA's WhatsApp number, with the medicine photo." /> : null}
            <HowRow tag="Calendar" tone="violet" text="Events with alerts in your phone's calendar — add ÖRZA from the Calendar screen." onPress={() => router.push('/calendar')} />
          </View>
        </GlassCard>
      </Animated.View>

      <ReminderSheet
        visible={sheet.open}
        reminder={sheet.reminder}
        onClose={() => setSheet((s) => ({ ...s, open: false }))}
        whatsappAvailable={whatsappAvailable}
        whatsappReady={whatsappReady}
        pushReady={notif.status === 'granted'}
      />
    </Screen>
  );
}

function HowRow({ tag, tone, text, onPress }: { tag: string; tone: 'energy' | 'info' | 'violet'; text: string; onPress?: () => void }) {
  const body = (
    <>
      <Tag label={tag} tone={tone} />
      <Text variant="small" tone="text" style={styles.flex}>
        {text}
      </Text>
      {onPress ? <Icon name="chevron-right" size={16} color={colors.subtle} /> : null}
    </>
  );
  if (!onPress) return <View style={styles.howRow}>{body}</View>;
  return (
    <PressableScale haptic="tap" onPress={onPress} accessibilityRole="link" accessibilityLabel={`${tag}: ${text}`} style={styles.howRow}>
      {body}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  section: { marginTop: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  paused: { backgroundColor: colors.warningBg, borderColor: 'rgba(176,106,0,0.2)' },
  pausedBtn: { marginTop: spacing.md, alignSelf: 'flex-start' },
  heroOrb: { position: 'absolute', right: -22, top: -18, opacity: 0.9 },
  heroSkel: { gap: 8, marginTop: spacing.md },
  heroTitle: { marginTop: spacing.sm, marginRight: 70 },
  heroTags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  presetLabel: { marginTop: spacing.xl, marginBottom: spacing.sm },
  presetScroll: { marginHorizontal: -spacing.lg },
  presets: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  preset: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.glassSolid,
    minHeight: 48,
  },
  presetAdded: { backgroundColor: colors.successBg, borderColor: 'rgba(18,122,86,0.22)' },
  presetPending: { opacity: 0.6 },
  list: { marginTop: spacing.md },
  limit: { marginTop: spacing.md },
  body: { marginTop: spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  skelGap: { marginTop: 10 },
  howList: { marginTop: spacing.md, gap: spacing.sm },
  howRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: 6 },
});
