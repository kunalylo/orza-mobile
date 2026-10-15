/**
 * "Connect your calendar" — read-only import of the user's own Google / iCloud / Outlook calendar (iCal / ICS address),
 * so meetings show next to doses and meals and ÖRZA can flag busy days. PUT/DELETE /api/calendar/external.
 */
import { useRef, useState } from 'react';
import { StyleSheet, View, type TextInput } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { CardHeader, ConfirmStrip } from '@/features/reminders/parts';
import { ApiError, errorMessage } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, Segmented, Skeleton, Tag, Text, TextField, toast } from '@/ui';

import { useConnectExternal, useDisconnectExternal } from './api';
import type { ExternalCalendarState } from './types';

type Provider = 'google' | 'apple' | 'outlook';

const PROVIDER_NAME: Record<NonNullable<ExternalCalendarState['provider']>, string> = {
  google: 'Google Calendar',
  apple: 'Apple iCloud Calendar',
  outlook: 'Outlook Calendar',
  other: 'Your calendar',
};

const GUIDES: Record<Provider, { steps: string[]; note: string }> = {
  google: {
    steps: [
      'On a computer, open calendar.google.com and go to Settings (the gear icon).',
      'Under Settings for my calendars, choose your calendar, then Integrate calendar.',
      'Copy the Secret address in iCal format and paste it below.',
    ],
    note: 'The secret address lets anyone who has it read that calendar. ÖRZA only reads it, and you can reset it in Google at any time.',
  },
  apple: {
    steps: [
      'On iPhone, open Calendar, tap Calendars, then the ⓘ next to your iCloud calendar.',
      'Turn on Public Calendar and tap Share Link… → Copy. (On iCloud.com: Calendar → share icon → Public Calendar → Copy Link.)',
      'Paste the link below — webcal:// links work as they are.',
    ],
    note: 'A public calendar link can be viewed by anyone who has it. Turn Public Calendar off in Apple Calendar to stop sharing.',
  },
  outlook: {
    steps: [
      'In Outlook on the web, open Settings → Calendar → Shared calendars.',
      'Under Publish a calendar, pick your calendar and a permission (“Can view all details” or “Can view when I’m busy”), then Publish.',
      'Copy the ICS link and paste it below.',
    ],
    note: 'With “Can view when I’m busy”, ÖRZA still sees busy times for busy-day insights, without event titles.',
  },
};

export function ConnectCard({ external, loading }: { external: ExternalCalendarState; loading: boolean }) {
  const reduceMotion = useReducedMotion();
  const connect = useConnectExternal();
  const disconnect = useDisconnectExternal();
  const inputRef = useRef<TextInput>(null);
  const [provider, setProvider] = useState<Provider>('google');
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lastCount, setLastCount] = useState<number | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const submit = () => {
    if (connect.isPending) return;
    const value = url.trim();
    if (!value) {
      haptics.error();
      setError("Paste your calendar's iCal (ICS) address first.");
      inputRef.current?.focus();
      return;
    }
    if (!/^(https|webcals?):\/\//i.test(value)) {
      haptics.error();
      setError("Calendar links start with https:// or webcal://. Copy the full address from your calendar's settings.");
      inputRef.current?.focus();
      return;
    }
    setError(null);
    connect.mutate(value, {
      onSuccess: (res) => {
        haptics.success();
        setLastCount(res.upcoming_count);
        setEditing(false);
        setUrl('');
        toast.success(
          res.upcoming_count
            ? `Calendar connected — ${res.upcoming_count} event${res.upcoming_count === 1 ? '' : 's'} in the next 30 days.`
            : 'Calendar connected. It has no events in the next 30 days yet.'
        );
      },
      onError: (e) => {
        haptics.error();
        setError(e instanceof ApiError && e.status === 429 ? e.message : errorMessage(e, "We couldn't read that calendar right now. Please try again in a moment."));
      },
    });
  };

  const remove = () =>
    disconnect.mutate(undefined, {
      onSuccess: () => {
        haptics.success();
        setConfirmRemove(false);
        setLastCount(null);
        toast.success('Calendar disconnected. ÖRZA no longer reads it.');
      },
      onError: (e) => {
        haptics.error();
        toast.error(errorMessage(e));
      },
    });

  const guide = GUIDES[provider];
  const showForm = !external.connected || editing;

  return (
    <GlassCard padding={spacing.lg}>
      <CardHeader
        icon="mci:calendar-heart"
        tone="violet"
        eyebrow="Your calendar"
        title="Connect your calendar"
        body="See your meetings next to doses and meals, and let ÖRZA flag busy days so you can plan food around them. Read-only — ÖRZA never changes your calendar."
      />

      {loading ? (
        <View style={styles.skel}>
          <Skeleton width="100%" height={40} radius={radii.md} />
          <Skeleton width="80%" height={12} />
        </View>
      ) : (
        <>
          {external.connected && !editing ? (
            <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(200)} style={styles.connected}>
              <View style={styles.row}>
                <Icon name="mci:calendar-check" size={20} color={external.error ? colors.warning : colors.success} />
                <View style={styles.flex}>
                  <Text variant="label">{PROVIDER_NAME[external.provider || 'other']}</Text>
                  {external.name ? (
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      “{external.name}”
                    </Text>
                  ) : null}
                </View>
                <Tag label={external.error ? 'Needs attention' : 'Connected'} tone={external.error ? 'warning' : 'success'} />
              </View>
              {external.url_preview ? (
                <View style={styles.preview}>
                  <Icon name="lock" size={12} color={colors.subtle} />
                  <Text variant="mono" tone="subtle" numberOfLines={1} style={styles.flex}>
                    {external.url_preview}
                  </Text>
                </View>
              ) : null}
              {lastCount !== null && !external.error ? (
                <Text variant="caption" tone="muted" style={styles.gapTop}>
                  {lastCount} event{lastCount === 1 ? '' : 's'} in the next 30 days
                </Text>
              ) : null}
              {external.error ? (
                <Text variant="caption" tone="warning" style={styles.gapTop}>
                  {external.error}
                </Text>
              ) : null}
              <Text variant="caption" tone="subtle" style={styles.gapTop}>
                ÖRZA re-reads your calendar at most every 10 minutes while you use this screen.
              </Text>
              {confirmRemove ? (
                <ConfirmStrip
                  message="Disconnect your calendar? ÖRZA will stop reading it and forget the link. Your calendar itself isn't changed."
                  confirmLabel="Disconnect"
                  busy={disconnect.isPending}
                  onCancel={() => setConfirmRemove(false)}
                  onConfirm={remove}
                />
              ) : (
                <View style={styles.actions}>
                  <Button
                    label="Use a different link"
                    icon="edit-2"
                    variant="secondary"
                    size="sm"
                    onPress={() => {
                      setError(null);
                      setEditing(true);
                    }}
                  />
                  <Button
                    label="Disconnect"
                    variant="ghost"
                    size="sm"
                    onPress={() => {
                      haptics.warning();
                      setConfirmRemove(true);
                    }}
                  />
                </View>
              )}
            </Animated.View>
          ) : null}

          {showForm ? (
            <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(200)}>
              <Segmented<Provider>
                accessibilityLabel="Your calendar app"
                value={provider}
                onChange={(v) => {
                  haptics.select();
                  setProvider(v);
                }}
                options={[
                  { value: 'google', label: 'Google' },
                  { value: 'apple', label: 'Apple iCloud' },
                  { value: 'outlook', label: 'Outlook' },
                ]}
                size="sm"
                style={styles.segmented}
              />
              <View style={styles.steps} accessibilityLabel={`How to find your ${PROVIDER_NAME[provider]} link`}>
                {guide.steps.map((s, i) => (
                  <View key={s} style={styles.step}>
                    <View style={styles.stepNum}>
                      <Text variant="caption" weight="bold" color={colors.violet600}>
                        {i + 1}
                      </Text>
                    </View>
                    <Text variant="small" tone="text" style={styles.flex}>
                      {s}
                    </Text>
                  </View>
                ))}
              </View>
              <Text variant="caption" tone="subtle" style={styles.gapTop}>
                {guide.note}
              </Text>
              <TextField
                ref={inputRef}
                label="Calendar address (iCal / ICS)"
                icon="link"
                value={url}
                onChangeText={(t) => {
                  setUrl(t);
                  if (error) setError(null);
                }}
                error={error}
                hint={error ? undefined : 'ÖRZA checks the link once before saving. It stays private and is never shown in full again.'}
                placeholder="https://… or webcal://…"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                textContentType="URL"
                returnKeyType="go"
                onSubmitEditing={submit}
                maxLength={2048}
                containerStyle={styles.field}
              />
              <View style={styles.actions}>
                <Button label={connect.isPending ? 'Checking…' : 'Connect'} icon="link" variant="primary" size="sm" loading={connect.isPending} onPress={submit} />
                {external.connected ? (
                  <Button
                    label="Cancel"
                    variant="ghost"
                    size="sm"
                    disabled={connect.isPending}
                    onPress={() => {
                      setEditing(false);
                      setError(null);
                      setUrl('');
                    }}
                  />
                ) : null}
              </View>
            </Animated.View>
          ) : null}
        </>
      )}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  skel: { marginTop: spacing.lg, gap: spacing.md },
  connected: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.glassSolid,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.sm },
  gapTop: { marginTop: spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  segmented: { marginTop: spacing.lg },
  steps: { marginTop: spacing.md, gap: spacing.sm },
  step: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.violet50, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  field: { marginTop: spacing.lg },
});
