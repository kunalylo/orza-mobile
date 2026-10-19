/** Quiet hours (do not disturb) — PUT /api/integrations/quiet-hours {start, end} | {start: null, end: null}. */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';

import { TimePickerSheet } from '@/features/meds/PickerSheets';
import { formatTime12 } from '@/features/meds/shared';
import { useAlarmSyncState } from '@/lib/alarms/useAlarmSync';
import { errorMessage } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, GlassCard, PressableScale, Text, toast } from '@/ui';

import { useQuietHours } from './api';
import { BrandSwitch, CardHeader } from './parts';
import { isHHMM, tzLabel } from './shared';
import type { IntegrationsView } from './types';

const DEFAULT_QUIET = { start: '22:30', end: '07:00' };

export function QuietHoursCard({ integrations }: { integrations: IntegrationsView }) {
  const reduceMotion = useReducedMotion();
  const mutation = useQuietHours();
  // Doses this phone won't ring because of quiet hours (web parity: they don't notify) — counted by the alarm engine.
  const quietDoses = useAlarmSyncState().quietDoses.length;
  const saved = integrations.quiet_hours;
  const [enabled, setEnabled] = useState(!!saved);
  const [start, setStart] = useState(saved?.start || DEFAULT_QUIET.start);
  const [end, setEnd] = useState(saved?.end || DEFAULT_QUIET.end);
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<'start' | 'end' | null>(null);

  // Follow the server value when it changes (another device, a refetch).
  const savedKey = saved ? `${saved.start}-${saved.end}` : 'off';
  const [seenKey, setSeenKey] = useState(savedKey);
  if (seenKey !== savedKey) {
    setSeenKey(savedKey);
    setEnabled(!!saved);
    if (saved) {
      setStart(saved.start);
      setEnd(saved.end);
    }
  }

  const busy = mutation.isPending;

  const persist = (next: { start: string; end: string } | null, onFail?: () => void) => {
    setError(null);
    mutation.mutate(next, {
      onSuccess: () => {
        haptics.success();
        toast.success(next ? `Quiet hours set: ${formatTime12(next.start)} – ${formatTime12(next.end)}` : 'Quiet hours turned off');
      },
      onError: (e) => {
        haptics.error();
        setError(errorMessage(e));
        onFail?.();
      },
    });
  };

  const toggle = (v: boolean) => {
    if (busy) return;
    setEnabled(v);
    if (v) persist({ start, end }, () => setEnabled(false));
    else if (saved) persist(null, () => setEnabled(true));
  };

  const save = () => {
    if (busy) return;
    if (!isHHMM(start) || !isHHMM(end)) return setError('Choose both a start and an end time.');
    if (start === end) return setError('Start and end need to be different times.');
    persist({ start, end });
  };

  const dirty = !!saved && (saved.start !== start || saved.end !== end);
  const whatsapp = integrations.whatsapp.configured;

  return (
    <GlassCard padding={spacing.lg}>
      <CardHeader
        icon="moon"
        tone="violet"
        eyebrow="Do not disturb"
        title="Quiet hours"
        body={`No notifications${whatsapp ? ' or WhatsApp messages' : ''} during these hours (your time, ${tzLabel(integrations.timezone)}).`}
        right={<BrandSwitch value={enabled} onValueChange={toggle} disabled={busy} accessibilityLabel="Quiet hours" />}
      />

      {enabled ? (
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(200)} exiting={reduceMotion ? undefined : FadeOut.duration(140)}>
          <View style={styles.row}>
            <TimeBox label="From" value={start} onPress={() => setPicker('start')} />
            <TimeBox label="Until" value={end} onPress={() => setPicker('end')} />
          </View>
          {dirty || !saved ? <Button label="Save quiet hours" variant="primary" size="sm" loading={busy} onPress={save} style={styles.save} /> : null}
          <Text variant="caption" tone="subtle" style={styles.hint}>
            Medicine doses that fall inside quiet hours won&apos;t notify you — keep your dose times outside this window. Refill alerts wait until
            quiet hours end.
          </Text>
          {saved && !dirty && quietDoses > 0 ? (
            <Text variant="caption" tone="warning" style={styles.hint} accessibilityRole="alert">
              {quietDoses === 1 ? '1 medicine dose' : `${quietDoses} medicine doses`} in the next 7 days fall
              {quietDoses === 1 ? 's' : ''} inside these hours and won&apos;t ring on this phone.
            </Text>
          ) : null}
        </Animated.View>
      ) : null}

      {error ? (
        <Text variant="caption" tone="error" style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <TimePickerSheet
        visible={picker !== null}
        value={picker === 'end' ? end : start}
        title={picker === 'end' ? 'Quiet until' : 'Quiet from'}
        onClose={() => setPicker(null)}
        onSubmit={(t) => {
          setError(null);
          if (picker === 'end') setEnd(t);
          else setStart(t);
        }}
      />
    </GlassCard>
  );
}

function TimeBox({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <PressableScale haptic="tap" onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label} ${formatTime12(value)}. Change`} style={styles.box}>
      <Text variant="eyebrow" tone="subtle">
        {label}
      </Text>
      <Text variant="h3">{formatTime12(value)}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  box: {
    flex: 1,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.violet50,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(135,87,242,0.22)',
    gap: 4,
  },
  save: { marginTop: spacing.md, alignSelf: 'flex-start' },
  hint: { marginTop: spacing.md },
  error: { marginTop: spacing.sm },
});
