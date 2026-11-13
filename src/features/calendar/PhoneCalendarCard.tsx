/**
 * "Add ÖRZA to my phone calendar" — creates a dedicated ÖRZA calendar on the phone with the next 14 days of medicine
 * doses (and reminders with Calendar on), each with an alert. Re-syncs on demand and quietly when it's stale. On an
 * iPhone it also says that medicine events leave out the medicine's name (`./phoneEvents`), and, when the events had
 * to go into the default calendar or access is "Add Events Only", where they are and what ÖRZA can do there
 * (`./phoneTarget`).
 */
import { useEffect, useState } from 'react';
import { AppState, Linking, Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { useIsMutating, useQueryClient } from '@tanstack/react-query';

import { timeAgo } from '@/features/health/format';
import { CardHeader, ConfirmStrip } from '@/features/reminders/parts';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, Skeleton, Tag, Text, toast } from '@/ui';

import { calendarKeys, usePhoneCalendarState, usePhoneCalendarSync, useRemovePhoneCalendar } from './api';
import { AUTO_SYNC_AFTER_MS, isPhoneCalendarStale, PhoneCalendarError, phoneCalendarMessage, SYNC_DAYS, type PhoneSyncResult } from './deviceCalendar';
import { PHONE_EVENT_COPY } from './phoneEvents';
import { linkMode, PHONE_CALENDAR_COPY } from './phoneTarget';

function syncSummary(r: PhoneSyncResult): string {
  if (r.created && r.mode === 'default') return PHONE_CALENDAR_COPY.addedToDefault(r.total);
  if (r.created) return `Added ÖRZA to your calendar with ${r.total} event${r.total === 1 ? '' : 's'}.`;
  const changes = r.added + r.updated + r.removed;
  if (!changes) return 'Your calendar is already up to date.';
  return `Calendar updated — ${r.total} upcoming event${r.total === 1 ? '' : 's'}.`;
}

export function PhoneCalendarCard({ tz, today }: { tz: string; today: string }) {
  const reduceMotion = useReducedMotion();
  const qc = useQueryClient();
  const state = usePhoneCalendarState();
  const sync = usePhoneCalendarSync(tz, today);
  const remove = useRemovePhoneCalendar();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<{ message: string; permission: boolean } | null>(null);
  const fail = (e: unknown) => setError({ message: phoneCalendarMessage(e), permission: e instanceof PhoneCalendarError && e.reason === 'permission' });
  // Remove's errors always show: without full access it changes nothing and says how to allow it.
  const failRemove = (e: unknown) => setError({ message: phoneCalendarMessage(e), permission: false });

  // Re-read permission + link when coming back from Settings or the Calendar app.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void qc.invalidateQueries({ queryKey: calendarKeys.phone() });
    });
    return () => sub.remove();
  }, [qc]);

  const data = state.data;
  const link = data?.link ?? null;
  const granted = data?.permission === 'granted';
  const writeOnly = data?.permission === 'writeOnly';
  const blocked = data?.permission === 'blocked';
  // Events in the member's default calendar (no account took an ÖRZA calendar, or "Add Events Only").
  const inDefault = !!link && linkMode(link) === 'default';
  // "Add Events Only" can still add new events to the default calendar; ÖRZA's own calendar needs full access.
  const canSync = granted || (writeOnly && inDefault);

  // Quiet re-sync when the copy on the phone is older than a few hours or ÖRZA data changed. "Syncing" counts any
  // sync still running — including one started before this screen was last closed — so reopening Calendar mid-sync
  // doesn't start another.
  const linked = !!link;
  const syncedAtIso = link?.syncedAt ?? null;
  const { mutate: runSync, isError: syncFailed } = sync;
  const syncing = useIsMutating({ mutationKey: calendarKeys.phoneSync() }) > 0;
  useEffect(() => {
    if (!linked || !canSync || syncing || syncFailed) return;
    const syncedAt = syncedAtIso ? Date.parse(syncedAtIso) : 0;
    if (isPhoneCalendarStale() || Date.now() - syncedAt > AUTO_SYNC_AFTER_MS) runSync({ ask: false });
  }, [linked, canSync, syncedAtIso, syncing, syncFailed, runSync]);

  const add = () => {
    setError(null);
    haptics.firm();
    sync.mutate(
      { ask: true },
      {
        onSuccess: (r) => {
          haptics.success();
          toast.success(syncSummary(r));
        },
        onError: (e) => {
          haptics.error();
          fail(e);
        },
      }
    );
  };

  const doRemove = () => {
    remove.mutate(undefined, {
      onSuccess: () => {
        haptics.success();
        setConfirmRemove(false);
        toast.success(inDefault ? PHONE_CALENDAR_COPY.removedFromDefault : 'Removed the ÖRZA calendar from this phone.');
      },
      onError: (e) => {
        haptics.error();
        failRemove(e);
      },
    });
  };

  // A permission error is old news once access is back, and the "access is off" box already says it when blocked.
  const permissionNote = blocked || (!!link && !granted);
  const shownError = error && !(error.permission && (granted || permissionNote)) ? error.message : null;

  if (data && !data.supported) return null;

  return (
    <GlassCard tone="strong" glow padding={spacing.lg}>
      <CardHeader
        icon="mci:calendar-sync"
        tone="energy"
        eyebrow="Phone calendar"
        title={link ? 'ÖRZA is in your calendar' : 'Add ÖRZA to my phone calendar'}
        right={link ? <Tag label="On" tone="success" dot /> : undefined}
      />
      <Text variant="small" tone="muted" style={styles.body}>
        {inDefault
          ? `Your medicine doses — and reminders with Calendar switched on — for the next ${SYNC_DAYS} days, in your default calendar.`
          : `A calendar called “ÖRZA” with your medicine doses — and reminders with Calendar switched on — for the next ${SYNC_DAYS} days.`}{' '}
        Each event rings at its time, even when ÖRZA isn&apos;t open.{Platform.OS === 'ios' ? ` ${PHONE_EVENT_COPY.iosCardNote}` : ''}
      </Text>

      {state.isPending ? (
        <View style={styles.skel}>
          <Skeleton width="60%" height={14} />
          <Skeleton width={160} height={40} radius={radii.pill} />
        </View>
      ) : link ? (
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(200)}>
          <View style={styles.stats}>
            <View style={styles.stat}>
              <Text variant="stat" style={styles.statNum}>
                {link.count}
              </Text>
              <Text variant="caption" tone="subtle">
                upcoming events
              </Text>
            </View>
            <View style={styles.stat}>
              <Text variant="label">{syncing ? 'Syncing…' : link.syncedAt ? `Synced ${timeAgo(link.syncedAt)}` : 'Not synced yet'}</Text>
              <Text variant="caption" tone="subtle">
                Updates when you open Calendar or tap Sync now
              </Text>
            </View>
          </View>
          {granted && inDefault ? (
            <Text variant="caption" tone="muted" style={styles.note}>
              {PHONE_CALENDAR_COPY.defaultCalendarNote(link.calendarTitle)}
            </Text>
          ) : null}
          {!granted ? (
            <View style={styles.warn}>
              <Icon name="alert-triangle" size={16} color={colors.warning} />
              <Text variant="caption" tone="warning" style={styles.flex}>
                {!writeOnly
                  ? Platform.OS === 'ios'
                    ? PHONE_CALENDAR_COPY.accessOffLinkedIos
                    : "Calendar access is off for ÖRZA, so new doses can't be added. Turn it on in Settings."
                  : inDefault
                    ? [link.stuck ? PHONE_CALENDAR_COPY.stuck(link.stuck) : '', PHONE_CALENDAR_COPY.writeOnlyLinked].filter(Boolean).join(' ')
                    : PHONE_CALENDAR_COPY.ownNeedsFullAccess}
              </Text>
            </View>
          ) : null}
          {confirmRemove ? (
            <ConfirmStrip
              message={
                inDefault
                  ? PHONE_CALENDAR_COPY.removeDefaultConfirm
                  : 'Remove the ÖRZA calendar and all its events from this phone? Your medicines and reminders in ÖRZA stay as they are.'
              }
              confirmLabel={inDefault ? PHONE_CALENDAR_COPY.removeDefaultConfirmLabel : 'Remove calendar'}
              busy={remove.isPending}
              onCancel={() => setConfirmRemove(false)}
              onConfirm={doRemove}
            />
          ) : (
            <View style={styles.actions}>
              {canSync ? <Button label="Sync now" icon="refresh-cw" variant="primary" size="sm" loading={syncing} onPress={add} /> : null}
              {!granted ? (
                <Button
                  label="Open Settings"
                  icon="settings"
                  variant={canSync ? 'secondary' : 'primary'}
                  size="sm"
                  onPress={() => void Linking.openSettings()}
                />
              ) : null}
              <Button
                label="Remove"
                icon="trash-2"
                variant="ghost"
                size="sm"
                disabled={syncing || remove.isPending}
                onPress={() => {
                  setError(null);
                  // Without full access Remove changes nothing (it says how to allow it), so there's nothing to confirm.
                  if (!granted) {
                    doRemove();
                    return;
                  }
                  haptics.warning();
                  setConfirmRemove(true);
                }}
              />
            </View>
          )}
        </Animated.View>
      ) : blocked ? (
        <View>
          <View style={styles.warn}>
            <Icon name="alert-triangle" size={16} color={colors.warning} />
            <Text variant="caption" tone="warning" style={styles.flex}>
              {Platform.OS === 'ios' ? PHONE_CALENDAR_COPY.accessOffIos : 'Calendar access is off for ÖRZA. Turn it on in Settings, then come back.'}
            </Text>
          </View>
          <Button label="Open Settings" icon="settings" variant="primary" onPress={() => void Linking.openSettings()} style={styles.cta} />
        </View>
      ) : writeOnly ? (
        <View>
          <View style={styles.warn}>
            <Icon name="alert-triangle" size={16} color={colors.warning} />
            <Text variant="caption" tone="warning" style={styles.flex}>
              {PHONE_CALENDAR_COPY.writeOnlyBeforeAdd}
            </Text>
          </View>
          <View style={styles.actions}>
            <Button label="Add to my calendar" icon="calendar" variant="energy" loading={syncing} onPress={add} />
            <Button label="Open Settings" icon="settings" variant="secondary" onPress={() => void Linking.openSettings()} />
          </View>
        </View>
      ) : (
        <Button label="Add to my calendar" icon="calendar" variant="energy" loading={syncing} onPress={add} style={styles.cta} />
      )}

      {shownError ? (
        <Text variant="caption" tone="error" style={styles.error} accessibilityRole="alert">
          {shownError}
        </Text>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { marginTop: spacing.md },
  note: { marginTop: spacing.md },
  skel: { marginTop: spacing.lg, gap: spacing.md },
  stats: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.lg, alignItems: 'center' },
  stat: { flexShrink: 1, gap: 2 },
  statNum: { color: colors.energyInk },
  warn: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.warningBg,
  },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.lg },
  cta: { marginTop: spacing.lg, alignSelf: 'flex-start' },
  error: { marginTop: spacing.md },
});
