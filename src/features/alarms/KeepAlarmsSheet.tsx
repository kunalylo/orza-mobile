/**
 * "Keep medicine alarms working" (see `./keepAlive` and `lib/alarms/oem.ts`): on phones whose maker closes apps to save
 * battery, the settings that stop it, step by step, and a button to the best screen this phone has. Mounted once in
 * the member layout: it shows itself once per install, right after the member's first medicine alarm is set (never
 * over "Let your medicine alarms ring" — which also takes its place if it comes up meanwhile — or an alarm on screen),
 * and opens again from Reminders & alarms › Alarms on this phone. The sheet stays open when the member comes back from
 * Settings, so the next step is still there.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { AppState, StyleSheet, View } from 'react-native';

import { shouldOfferKeepAlive } from '@/lib/alarms/oem';
import { anyAlarmOnScreen } from '@/lib/alarms/presence';
import { useAlarmSyncState } from '@/lib/alarms/useAlarmSync';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, Sheet, Text, toast } from '@/ui';

import { getStatus } from '../../../modules/orza-alarms';

import {
  closeKeepAlive,
  getKeepAlive,
  keepAliveGuideHere,
  keepAliveSeen,
  offerKeepAlive,
  openKeepAliveScreen,
  subscribeKeepAlive,
  yieldKeepAlive,
} from './keepAlive';
import { getAlarmPrompt, subscribeAlarmPrompt } from './prompt';

/** Let the alarm engine's run (and any sheet it follows) settle before this one slides up. */
const SHOW_DELAY_MS = 1500;

export function KeepAlarmsSheet() {
  const sheet = useSyncExternalStore(subscribeKeepAlive, getKeepAlive, getKeepAlive);
  const prompt = useSyncExternalStore(subscribeAlarmPrompt, getAlarmPrompt, getAlarmPrompt);
  const engine = useAlarmSyncState();
  const [opening, setOpening] = useState(false);
  const guide = keepAliveGuideHere();
  const doseAlarms = engine.doseAlarms;
  const notificationsGranted = engine.status?.notifications === 'granted';

  // "Let your medicine alarms ring" goes first: one sheet at a time.
  useEffect(() => {
    if (prompt.visible) yieldKeepAlive();
  }, [prompt.visible]);

  // Once per install, after the first medicine alarm is set on this phone.
  useEffect(() => {
    if (!guide || prompt.visible || doseAlarms <= 0 || !notificationsGranted || keepAliveSeen()) return undefined;
    let alive = true;
    const timer = setTimeout(() => {
      void (async () => {
        // Samsung: only while ÖRZA's battery isn't "Unrestricted" (which also keeps it out of the sleeping apps).
        const native = guide.maker === 'samsung' ? await getStatus().catch(() => null) : null;
        const offer = shouldOfferKeepAlive({
          maker: guide.maker,
          seen: keepAliveSeen(),
          doseAlarms,
          notificationsGranted,
          busy: getAlarmPrompt().visible || anyAlarmOnScreen() || AppState.currentState !== 'active',
          batteryUnrestricted: native?.batteryUnrestricted,
        });
        if (alive && offer) offerKeepAlive();
      })();
    }, SHOW_DELAY_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [guide, prompt.visible, doseAlarms, notificationsGranted]);

  if (!guide) return null;

  const open = async () => {
    haptics.firm();
    setOpening(true);
    try {
      if (!(await openKeepAliveScreen())) toast.error('That didn’t open — please open Settings › Apps › ÖRZA yourself.');
    } finally {
      setOpening(false);
    }
  };

  return (
    <Sheet
      visible={sheet.visible}
      onClose={closeKeepAlive}
      eyebrow="Medicine alarms"
      title={guide.title}
      footer={
        <View style={styles.footer}>
          <Button
            label="Open settings"
            icon="settings"
            iconRight="arrow-up-right"
            variant="energy"
            size="lg"
            block
            loading={opening}
            onPress={() => void open()}
            accessibilityHint="Opens your phone’s settings for ÖRZA"
          />
          <Button label="Done" variant="ghost" onPress={closeKeepAlive} />
        </View>
      }
    >
      <Text variant="callout" tone="text">
        {guide.intro}
      </Text>
      <View style={styles.steps}>
        {guide.steps.map((step, i) => (
          <View key={step} style={styles.step} accessible accessibilityLabel={`Step ${i + 1}: ${step}`}>
            <View style={styles.num}>
              <Text variant="label" tone="energy">
                {i + 1}
              </Text>
            </View>
            <Text variant="small" tone="text" style={styles.flex}>
              {step}
            </Text>
          </View>
        ))}
      </View>
      {sheet.auto ? (
        <Text variant="caption" tone="muted" style={styles.hint}>
          You can find this again in Reminders &amp; alarms › Alarms on this phone.
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  steps: { gap: spacing.md, marginTop: spacing.lg },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  num: {
    width: 28,
    height: 28,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.energyBg,
  },
  hint: { marginTop: spacing.lg },
  footer: { gap: spacing.xs },
});
