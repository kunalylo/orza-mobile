/**
 * WhatsApp channel — save a number with consent, pause / resume, send a test, remove. Shown only while WhatsApp is
 * configured for ÖRZA (GET /api/integrations → whatsapp.configured).
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';

import { errorMessage } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, PressableScale, Sheet, Tag, Text, TextField, toast } from '@/ui';

import { useSaveWhatsApp, useWhatsAppTest } from './api';
import { CardHeader } from './parts';
import { COUNTRY_CODES, formatPhone, splitE164, toE164 } from './shared';
import type { IntegrationsView } from './types';

type Busy = 'save' | 'pause' | 'remove' | 'test' | null;

export function WhatsAppCard({ integrations }: { integrations: IntegrationsView }) {
  const reduceMotion = useReducedMotion();
  const wa = integrations.whatsapp;
  const saveMutation = useSaveWhatsApp();
  const testMutation = useWhatsAppTest();
  const initial = splitE164(wa.phone);
  const [editing, setEditing] = useState(!wa.phone);
  const [code, setCode] = useState(initial.code);
  const [national, setNational] = useState(initial.national);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [codesOpen, setCodesOpen] = useState(false);

  const status = wa.opt_in ? { label: 'On', tone: 'success' as const } : wa.phone ? { label: 'Paused', tone: 'warning' as const } : { label: 'Not set', tone: 'neutral' as const };

  const put = (phone: string | null, optIn: boolean, kind: Exclude<Busy, null>, done: string, after?: () => void) => {
    setBusy(kind);
    saveMutation.mutate(
      { phone, optIn },
      {
        onSuccess: () => {
          haptics.success();
          toast.success(done);
          after?.();
        },
        onError: (e) => {
          haptics.error();
          if (kind === 'save') setError(errorMessage(e));
          else toast.error(errorMessage(e));
        },
        onSettled: () => setBusy(null),
      }
    );
  };

  const save = () => {
    if (busy) return;
    const parsed = toE164(national, code);
    if (!parsed.ok) {
      haptics.error();
      setError(parsed.error);
      return;
    }
    if (!consent) {
      haptics.error();
      setError('Tick the consent box so ÖRZA may message you on WhatsApp.');
      return;
    }
    setError(null);
    put(parsed.e164, true, 'save', 'WhatsApp number saved', () => {
      setEditing(false);
      setConsent(false);
    });
  };

  const test = () => {
    if (busy) return;
    setBusy('test');
    testMutation.mutate(undefined, {
      onSuccess: (r) => {
        haptics.success();
        toast.success(
          r.image && r.image !== 'sent' && r.image !== 'skipped' ? "Test message sent (the photo couldn't be attached)" : 'Test message sent — check WhatsApp'
        );
      },
      onError: (e) => {
        haptics.error();
        toast.error(errorMessage(e));
      },
      onSettled: () => setBusy(null),
    });
  };

  return (
    <GlassCard padding={spacing.lg}>
      <CardHeader
        icon="mci:whatsapp"
        tone="success"
        eyebrow="Channel"
        title="WhatsApp"
        body="Get medicine alarms (with the photo) and the reminders you choose on WhatsApp."
        right={<Tag label={status.label} tone={status.tone} dot />}
      />

      {wa.phone && !editing ? (
        <Animated.View entering={reduceMotion ? undefined : FadeIn.duration(180)}>
          <View style={styles.numberRow}>
            <View style={styles.flex}>
              <Text variant="eyebrow" tone="subtle">
                Sending to
              </Text>
              <Text variant="title">{formatPhone(wa.phone)}</Text>
            </View>
            <Button
              label="Change"
              variant="ghost"
              size="sm"
              disabled={!!busy}
              onPress={() => {
                const s = splitE164(wa.phone);
                setCode(s.code);
                setNational(s.national);
                setError(null);
                setEditing(true);
              }}
            />
          </View>
          <View style={styles.actions}>
            {wa.opt_in ? (
              <>
                <Button label="Send test" icon="send" variant="primary" size="sm" loading={busy === 'test'} disabled={!!busy} onPress={test} />
                <Button label="Pause" variant="secondary" size="sm" loading={busy === 'pause'} disabled={!!busy} onPress={() => put(wa.phone, false, 'pause', 'WhatsApp reminders are paused')} />
              </>
            ) : (
              <Button label="Turn back on" variant="primary" size="sm" loading={busy === 'pause'} disabled={!!busy} onPress={() => put(wa.phone, true, 'pause', 'WhatsApp reminders are on')} />
            )}
            <Button
              label="Remove number"
              variant="ghost"
              size="sm"
              loading={busy === 'remove'}
              disabled={!!busy}
              onPress={() =>
                put(null, false, 'remove', 'WhatsApp number removed', () => {
                  setNational('');
                  setEditing(true);
                })
              }
            />
          </View>
          {wa.mode === 'session' ? (
            <Text variant="caption" tone="subtle" style={styles.hint}>
              WhatsApp only delivers ÖRZA&apos;s messages within 24 hours of your last message to ÖRZA&apos;s WhatsApp number. Send it a quick
              “Hi” each day, or use notifications as your main alarm.
            </Text>
          ) : null}
          <Text variant="caption" tone="subtle" style={styles.hint}>
            Medicine alarms go to WhatsApp automatically. For meal, water and weigh-in reminders, switch on WhatsApp in each reminder.
          </Text>
        </Animated.View>
      ) : (
        <View style={styles.form}>
          <Text variant="label">WhatsApp number</Text>
          <View style={styles.phoneRow}>
            <PressableScale
              haptic="tap"
              onPress={() => setCodesOpen(true)}
              accessibilityRole="button"
              accessibilityLabel={`Country code ${code}. Change`}
              style={styles.code}
            >
              <Text variant="label">{code}</Text>
              <Icon name="chevron-down" size={14} color={colors.muted} />
            </PressableScale>
            <TextField
              value={national}
              onChangeText={(t) => {
                setNational(t);
                if (error) setError(null);
              }}
              placeholder="98765 43210"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              maxLength={20}
              accessibilityLabel="WhatsApp number"
              containerStyle={styles.flex}
            />
          </View>
          <PressableScale
            haptic="select"
            onPress={() => {
              setConsent((c) => !c);
              if (error) setError(null);
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: consent }}
            style={styles.consent}
          >
            <View style={[styles.box, consent && styles.boxOn]}>{consent ? <Icon name="check" size={14} color={colors.inverse} /> : null}</View>
            <Text variant="small" tone="text" style={styles.flex}>
              I agree to receive medicine alarms and reminders from ÖRZA on WhatsApp at this number. I can pause or remove it here any time.
            </Text>
          </PressableScale>
          {error ? (
            <Text variant="caption" tone="error" accessibilityRole="alert">
              {error}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button label="Save number" variant="primary" size="sm" loading={busy === 'save'} onPress={save} />
            {wa.phone ? <Button label="Cancel" variant="ghost" size="sm" disabled={!!busy} onPress={() => setEditing(false)} /> : null}
          </View>
        </View>
      )}

      <Sheet visible={codesOpen} onClose={() => setCodesOpen(false)} eyebrow="WhatsApp" title="Country code">
        <View style={styles.codes}>
          {COUNTRY_CODES.map((c) => (
            <PressableScale
              key={c.code}
              haptic="select"
              onPress={() => {
                setCode(c.code);
                setCodesOpen(false);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: code === c.code }}
              style={[styles.codeRow, code === c.code && styles.codeRowOn]}
            >
              <Text variant="label" style={styles.codeNum}>
                {c.code}
              </Text>
              <Text variant="body" style={styles.flex}>
                {c.label}
              </Text>
              {code === c.code ? <Icon name="check" size={18} color={colors.energyInk} /> : null}
            </PressableScale>
          ))}
        </View>
      </Sheet>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  numberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.lg },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  hint: { marginTop: spacing.md },
  form: { marginTop: spacing.lg, gap: spacing.sm },
  phoneRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  code: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 54,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.glassStrong,
    borderWidth: 1.5,
    borderColor: colors.hairlineStrong,
  },
  consent: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', paddingVertical: spacing.sm },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  codes: { gap: 4 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48, paddingHorizontal: spacing.md, borderRadius: radii.sm },
  codeRowOn: { backgroundColor: colors.energyBg },
  codeNum: { width: 52 },
});
