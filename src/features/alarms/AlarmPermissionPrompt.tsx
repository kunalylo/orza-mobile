/**
 * The first-run alarm sheet (see `./prompt`): why ÖRZA needs notifications (and, on Android, exact alarm times), then
 * the system prompt — or the phone's Settings when the prompt can't be shown any more. Mounted once in the member
 * layout; re-reads the permissions when the member comes back from Settings and closes itself once all is set.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';

import { alarmAdapter } from '@/lib/alarms/adapter';
import { emitAlarmDataChanged } from '@/lib/alarms/events';
import { requestAlarmPermission } from '@/lib/alarms/sync';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, Icon, Sheet, Text, toast, type IconName } from '@/ui';

import { alarmPermissionMissing, closeAlarmPrompt, getAlarmPrompt, subscribeAlarmPrompt, updateAlarmPromptStatus } from './prompt';

function Point({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={styles.point}>
      <View style={styles.pointIcon}>
        <Icon name={icon} size={16} color={colors.energyInk} />
      </View>
      <Text variant="small" tone="text" style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

export function AlarmPermissionPrompt() {
  const prompt = useSyncExternalStore(subscribeAlarmPrompt, getAlarmPrompt, getAlarmPrompt);
  const [busy, setBusy] = useState(false);
  const status = prompt.status;
  const needsNotifications = !!status && status.notifications !== 'granted';
  const needsExact = !needsNotifications && status?.exact === false;

  // Back from Settings: read again; everything allowed → done.
  useEffect(() => {
    if (!prompt.visible) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      void alarmAdapter
        .status()
        .then((next) => {
          updateAlarmPromptStatus(next);
          if (!alarmPermissionMissing(next)) {
            // Allowed in Settings: schedule the alarms now.
            emitAlarmDataChanged('permission-changed');
            closeAlarmPrompt(false);
          }
        })
        .catch(() => undefined);
    });
    return () => sub.remove();
  }, [prompt.visible]);

  const allow = async () => {
    haptics.firm();
    setBusy(true);
    try {
      if (needsNotifications && status?.canAskNotifications) {
        const next = await requestAlarmPermission();
        updateAlarmPromptStatus(next);
        if (next.notifications === 'granted') {
          haptics.success();
          if (next.exact === false) return; // next step: exact alarm times (Android)
          toast.success('Done — your medicine alarms will ring on this phone.');
          closeAlarmPrompt(false);
        }
        return;
      }
      await alarmAdapter.openSettings(needsExact ? 'exactAlarms' : 'notifications').catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const title = needsExact ? 'Ring each dose on time' : 'Let your medicine alarms ring';
  const cta = needsExact
    ? 'Allow exact alarm times'
    : status?.canAskNotifications
      ? 'Allow notifications'
      : Platform.OS === 'ios'
        ? 'Open Settings'
        : 'Open notification settings';

  return (
    <Sheet
      visible={prompt.visible}
      onClose={() => closeAlarmPrompt(true)}
      eyebrow="Medicine alarms"
      title={title}
      footer={
        <View style={styles.footer}>
          <Button label={cta} icon={needsExact ? 'clock' : 'bell'} variant="energy" size="lg" block loading={busy} onPress={() => void allow()} />
          <Button label="Not now" variant="ghost" onPress={() => closeAlarmPrompt(true)} />
        </View>
      }
    >
      {needsExact ? (
        <>
          <Text variant="callout" tone="text">
            Notifications are on. One more switch: &quot;Alarms &amp; reminders&quot; lets ÖRZA ring each dose on the minute instead of
            whenever the phone wakes up.
          </Text>
          <View style={styles.points}>
            <Point icon="settings" text={'Tap below, then switch on "Allow setting alarms and reminders" for ÖRZA.'} />
            <Point icon="corner-up-left" text="Come back here — your alarms are set straight away." />
          </View>
        </>
      ) : (
        <>
          <Text variant="callout" tone="text">
            {prompt.reason === 'prescription'
              ? 'Your prescription medicines have their alarms. Allow notifications so they ring on this phone.'
              : 'Your medicine has its alarm times. Allow notifications so they ring on this phone.'}
          </Text>
          <View style={styles.points}>
            <Point icon="image" text="Every alarm shows the photo of each medicine to take — no guessing which strip." />
            <Point icon="wifi-off" text="Rings even offline, with the phone locked or ÖRZA closed." />
            <Point icon="check-circle" text="Take, Snooze 10 min or Skip right from the alarm." />
          </View>
          {status && !status.canAskNotifications ? (
            <Text variant="caption" tone="muted" style={styles.hint}>
              Notifications for ÖRZA are switched off in your phone&apos;s Settings — turn them on there, then come back.
            </Text>
          ) : null}
        </>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  points: { gap: spacing.md, marginTop: spacing.lg },
  point: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  pointIcon: {
    width: 32,
    height: 32,
    borderRadius: radii.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.energyBg,
  },
  hint: { marginTop: spacing.lg },
  footer: { gap: spacing.xs },
});
