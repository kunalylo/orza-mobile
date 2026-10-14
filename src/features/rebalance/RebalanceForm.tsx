/** Occasion chips, "what did you eat?", optional calories and a 2–5 day spread → POST /compensation/plan. */
import { useRef, useState } from 'react';
import { StyleSheet, View, type TextInput } from 'react-native';
import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { aiErrorInfo } from '@/features/chat/ai';
import { haptics } from '@/lib/haptics';
import { spacing } from '@/theme';
import { Button, Chip, GlassCard, Segmented, Text, TextField, toast } from '@/ui';

import { useCreatePlan } from './api';
import { OCCASIONS, PLACEHOLDERS, type RebalanceCreateResponse } from './types';

type Days = '2' | '3' | '4' | '5';
type Errors = Partial<Record<'occasion' | 'description' | 'extra_calories' | 'days', string>>;
const FIELDS = new Set(['occasion', 'description', 'extra_calories', 'days']);

export function RebalanceForm({
  aiEnabled,
  cost,
  onCreated,
  onNeedCredits,
}: {
  aiEnabled?: boolean;
  cost?: number;
  onCreated: (res: RebalanceCreateResponse) => void;
  onNeedCredits?: () => void;
}) {
  const reduce = useReducedMotion();
  const create = useCreatePlan();
  const [occasion, setOccasion] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [description, setDescription] = useState('');
  const [calories, setCalories] = useState('');
  const [days, setDays] = useState<Days>('3');
  const [errors, setErrors] = useState<Errors>({});
  const customRef = useRef<TextInput>(null);

  function pick(value: string) {
    setOccasion(value);
    setErrors((e) => ({ ...e, occasion: undefined }));
    if (value === 'Other') requestAnimationFrame(() => customRef.current?.focus());
  }

  async function submit() {
    if (create.isPending) return;
    const occ = occasion === 'Other' ? custom.trim() : occasion;
    const next: Errors = {};
    if (!occ) next.occasion = occasion === 'Other' ? 'Tell ÖRZA what the occasion was.' : "Pick the occasion you're rebalancing for.";
    else if (occ.length < 2) next.occasion = 'Use at least 2 characters.';
    const raw = calories.trim().replace(/,/g, '');
    const kcal = raw ? Number(raw) : null;
    if (kcal != null && (!Number.isFinite(kcal) || kcal < 100 || kcal > 5000)) next.extra_calories = 'Enter between 100 and 5,000 kcal — or leave it blank.';
    setErrors(next);
    if (next.occasion || next.extra_calories) {
      haptics.error();
      return;
    }

    try {
      const res = await create.mutateAsync({
        occasion: occ as string,
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(kcal != null ? { extra_calories: Math.round(kcal) } : {}),
        days: Number(days),
      });
      onCreated(res);
    } catch (e) {
      haptics.error();
      const info = aiErrorInfo(e);
      if (info.field && FIELDS.has(info.field)) setErrors({ [info.field]: info.message });
      else toast.error(info.message, info.needsCredits ? 6000 : undefined);
      if (info.needsCredits) onNeedCredits?.();
    }
  }

  const footnote = aiEnabled
    ? `Personalised by ÖRZA's AI for ${cost ?? 1} credit${(cost ?? 1) === 1 ? '' : 's'} — the built-in plan is always there if credits run out.`
    : aiEnabled === false
      ? 'Free built-in plan, tailored to your targets and diet.'
      : 'Tailored to your usual targets and diet.';

  return (
    <GlassCard tone="strong" glow padding={spacing.xl}>
      <Text variant="label" accessibilityRole="header">
        What was the occasion?
      </Text>
      <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Occasion">
        {OCCASIONS.map((o) => (
          <Chip key={o.value} role="radio" label={o.label} icon={o.icon} selected={occasion === o.value} onPress={() => pick(o.value)} />
        ))}
      </View>
      {occasion === 'Other' ? (
        <Animated.View entering={reduce ? undefined : FadeInDown.springify().damping(18)} style={styles.custom}>
          <TextField
            ref={customRef}
            value={custom}
            onChangeText={(t) => {
              setCustom(t);
              if (errors.occasion) setErrors((x) => ({ ...x, occasion: undefined }));
            }}
            maxLength={80}
            placeholder="e.g. Office farewell, Anniversary dinner"
            accessibilityLabel="Occasion"
            returnKeyType="next"
          />
        </Animated.View>
      ) : null}
      {errors.occasion ? (
        <Text variant="caption" tone="error" style={styles.error} accessibilityLiveRegion="polite">
          {errors.occasion}
        </Text>
      ) : null}

      <TextField
        label="What did you eat?"
        value={description}
        onChangeText={(t) => {
          setDescription(t);
          if (errors.description) setErrors((x) => ({ ...x, description: undefined }));
        }}
        multiline
        maxLength={500}
        placeholder={PLACEHOLDERS[occasion || 'Wedding']}
        hint={`Optional — English, Hindi or Hinglish all work. · ${description.length}/500`}
        error={errors.description}
        inputStyle={styles.textarea}
        containerStyle={styles.field}
      />

      <TextField
        label="Extra calories (optional)"
        value={calories}
        onChangeText={(t) => {
          setCalories(t.replace(/[^\d]/g, '').slice(0, 4));
          if (errors.extra_calories) setErrors((x) => ({ ...x, extra_calories: undefined }));
        }}
        keyboardType="number-pad"
        placeholder="e.g. 800"
        suffix="kcal"
        maxLength={4}
        hint="Not sure? Leave it blank — ÖRZA will estimate from what you ate."
        error={errors.extra_calories}
        containerStyle={styles.field}
      />

      <View style={styles.field}>
        <Text variant="label" tone="text" style={styles.daysLabel}>
          Days to spread it over
        </Text>
        <Segmented<Days>
          accessibilityLabel="Days to spread it over"
          value={days}
          onChange={(d) => {
            haptics.select();
            setDays(d);
          }}
          options={(['2', '3', '4', '5'] as Days[]).map((d) => ({ value: d, label: d }))}
        />
        <Text variant="caption" tone={errors.days ? 'error' : 'subtle'} style={styles.daysHint}>
          {errors.days || 'Starting tomorrow. More days means gentler changes.'}
        </Text>
      </View>

      <View style={styles.footer}>
        <Text variant="caption" tone="subtle">
          {footnote}
        </Text>
        <Button
          label={create.isPending ? 'Creating your plan…' : 'Create my plan'}
          icon={create.isPending ? undefined : 'mci:star-four-points-outline'}
          variant="energy"
          size="lg"
          block
          haptic="firm"
          loading={create.isPending}
          onPress={submit}
          style={styles.cta}
        />
      </View>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  custom: { marginTop: spacing.md },
  error: { marginTop: 6, marginLeft: 4 },
  field: { marginTop: spacing.xl },
  textarea: { minHeight: 96, textAlignVertical: 'top', paddingTop: 14 },
  daysLabel: { marginBottom: 8, marginLeft: 4 },
  daysHint: { marginTop: 7, marginLeft: 4 },
  footer: { marginTop: spacing.xl, paddingTop: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(20,20,20,0.12)' },
  cta: { marginTop: spacing.md },
});
