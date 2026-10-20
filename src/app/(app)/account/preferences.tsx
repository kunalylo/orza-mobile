/**
 * Settings → Preferences ("How ÖRZA works for you"): units, coach tone, reminders, weekly report, AI-training opt-out
 * and time zone. Each control saves on change — optimistic, reverted (with a toast) if the save fails.
 *
 * Saves run one after another (each answer carries the whole user, so an older answer can never land last and undo a
 * newer change), and a value being saved is shown over the server copy until its own save settles.
 */
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';

import { useAccountSync, useSaveProfile, useSavePreference } from '@/features/settings/api';
import { DEFAULT_PREFERENCES, TONE_COPY } from '@/features/settings/options';
import { SavedPill, SettingsGroup, ToggleRow } from '@/features/settings/parts';
import { errorMessage } from '@/lib/api';
import { useSignedInUser } from '@/lib/auth';
import { WEB_URL } from '@/lib/config';
import { deviceTimeZone } from '@/lib/device';
import { haptics } from '@/lib/haptics';
import type { Preferences } from '@/lib/types';
import { colors, spacing } from '@/theme';
import { Button, Icon, Screen, ScreenHeader, Segmented, Text, toast } from '@/ui';

const DEFAULT_TZ = 'Asia/Kolkata';
const tzLabel = (tz: string) => tz.replace(/_/g, ' ');

function ChoiceRow({ title, description, children, last }: { title: string; description?: string; children: ReactNode; last?: boolean }) {
  return (
    <Animated.View layout={LinearTransition.springify().damping(20).stiffness(100).mass(1)} style={[styles.choiceRow, !last && styles.divider]}>
      <Text variant="title">{title}</Text>
      {description ? (
        <Text variant="small" tone="muted" style={styles.desc}>
          {description}
        </Text>
      ) : null}
      <View style={styles.control}>{children}</View>
    </Animated.View>
  );
}

export default function PreferencesSettings() {
  const user = useSignedInUser();
  const sync = useAccountSync();
  const savePref = useSavePreference();
  const saveProfile = useSaveProfile();

  const server: Preferences = { ...DEFAULT_PREFERENCES, ...(user.preferences || {}) };
  // Values waiting for (or in) their save. Shown over the server copy, so the answer to another control's save, or a
  // refresh, landing in between never flips them back; dropping one shows the server value again (saved or rolled back).
  const [unsaved, setUnsaved] = useState<Partial<Preferences>>({});
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const queue = useRef<Promise<void>>(Promise.resolve());

  const prefs: Preferences = { ...server, ...unsaved };
  const isPending = (key: keyof Preferences) => key in unsaved;

  useEffect(() => {
    if (!savedAt) return;
    const t = setTimeout(() => setSavedAt(null), 2200);
    return () => clearTimeout(t);
  }, [savedAt]);

  const settle = (key: keyof Preferences) =>
    setUnsaved((u) => {
      const next = { ...u };
      delete next[key];
      return next;
    });

  // `mutateAsync` settles for this very save; callbacks passed to `mutate` are dropped once another control saves.
  const save = async (key: keyof Preferences, body: Partial<Preferences>) => {
    try {
      await savePref.mutateAsync(body); // its onSuccess has already put the fresh user in place
      haptics.success();
      setSavedAt(Date.now());
    } catch (e) {
      haptics.error();
      toast.error(errorMessage(e, "We couldn't save that. Please try again."));
    } finally {
      settle(key);
    }
  };

  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    if (prefs[key] === value || isPending(key)) return; // one save per control at a time
    setUnsaved((u) => ({ ...u, [key]: value }));
    const body = { [key]: value } as Partial<Preferences>;
    queue.current = queue.current.then(() => save(key, body)).catch(() => undefined);
  };

  const tz = user.profile?.timezone || DEFAULT_TZ;
  const deviceTz = deviceTimeZone();
  const tzDiffers = !!deviceTz && deviceTz !== tz;

  const applyDeviceTz = () => {
    if (!deviceTz) return;
    saveProfile.mutate(
      { profile: { timezone: deviceTz } },
      {
        onSuccess: () => {
          haptics.success();
          toast.success(`Time zone updated — your days now follow ${tzLabel(deviceTz)}.`);
        },
        onError: (e) => {
          haptics.error();
          toast.error(e instanceof Error && e.message ? e.message : "We couldn't update your time zone. Please try again.");
        },
      }
    );
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await sync.refetch();
    setRefreshing(false);
  };

  return (
    <Screen refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.coral} colors={[colors.coral]} />}>
      <ScreenHeader
        back
        large={false}
        eyebrow="Preferences"
        title="How ÖRZA works for you"
        subtitle="Changes save automatically."
        right={<SavedPill visible={!!savedAt} />}
      />

      <SettingsGroup title="Display & coaching" delay={0}>
        <ChoiceRow title="Units" description="How weight and height are shown across ÖRZA.">
          <Segmented<Preferences['units']>
            accessibilityLabel="Units"
            value={prefs.units}
            onChange={(v) => update('units', v)}
            options={[
              { value: 'metric', label: 'Metric · kg, cm' },
              { value: 'imperial', label: 'Imperial · lb, ft' },
            ]}
            style={isPending('units') ? styles.pending : undefined}
          />
        </ChoiceRow>
        <ChoiceRow title="Coach tone" description={TONE_COPY[prefs.tone]} last>
          <Segmented<Preferences['tone']>
            accessibilityLabel="Coach tone"
            value={prefs.tone}
            onChange={(v) => update('tone', v)}
            options={[
              { value: 'gentle', label: 'Gentle' },
              { value: 'direct', label: 'Direct' },
            ]}
            style={isPending('tone') ? styles.pending : undefined}
          />
        </ChoiceRow>
      </SettingsGroup>

      <SettingsGroup title="Nudges" delay={70}>
        <ToggleRow
          title="Gentle reminders"
          description="Friendly nudges to log meals, drink water and weigh in, plus your custom reminders. Medicine alarms aren’t affected — they keep ringing."
          value={prefs.reminders}
          pending={isPending('reminders')}
          onChange={(v) => update('reminders', v)}
        />
        <ToggleRow
          title="Weekly report"
          description="A calm summary of your week — patterns, wins and one thing to try next."
          value={prefs.weekly_report}
          pending={isPending('weekly_report')}
          onChange={(v) => update('weekly_report', v)}
          last
        />
      </SettingsGroup>

      <SettingsGroup title="Privacy" delay={140}>
        <ToggleRow
          title="Help improve ÖRZA’s AI"
          description="Lets your conversations and logs, anonymized first, help make ÖRZA’s AI better. Turning this off doesn’t change how AI features work for you."
          value={!prefs.ai_training_opt_out}
          pending={isPending('ai_training_opt_out')}
          onChange={(v) => update('ai_training_opt_out', !v)}
          last
        >
          <Text
            variant="small"
            weight="semibold"
            tone="ink"
            accessibilityRole="link"
            onPress={() => {
              haptics.tap();
              void WebBrowser.openBrowserAsync(`${WEB_URL}/privacy#ai-processing`, { toolbarColor: colors.canvas, controlsColor: colors.energyInk }).catch(() =>
                toast.error("Couldn't open the page. Please try again.")
              );
            }}
            style={styles.link}
          >
            How we use data ↗
          </Text>
        </ToggleRow>
      </SettingsGroup>

      <SettingsGroup title="Time zone" delay={210}>
        <View style={styles.choiceRow}>
          <View style={styles.tzHead}>
            <Icon name="globe" size={16} color={colors.cyan700} />
            <Text variant="title" style={styles.flex}>
              Time zone
            </Text>
            {!tzDiffers ? (
              <Text variant="label" tone="muted">
                {tzLabel(tz.split('/').pop() || tz)}
              </Text>
            ) : null}
          </View>
          <Text variant="small" tone="muted" style={styles.desc}>
            {tzDiffers ? `Your days follow ${tzLabel(tz)}. This phone is set to ${tzLabel(deviceTz)}.` : `Your days follow ${tzLabel(tz)}.`}
          </Text>
          {tzDiffers ? (
            <Animated.View entering={FadeInDown.springify().damping(18).stiffness(100).mass(1)} style={styles.control}>
              <Button label="Use this phone’s time zone" icon="smartphone" variant="secondary" size="sm" loading={saveProfile.isPending} onPress={applyDeviceTz} style={styles.tzButton} />
            </Animated.View>
          ) : null}
        </View>
      </SettingsGroup>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  choiceRow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.lg },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairlineStrong },
  desc: { marginTop: 2 },
  control: { marginTop: spacing.md },
  pending: { opacity: 0.7 },
  link: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  tzHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tzButton: { alignSelf: 'flex-start' },
});
