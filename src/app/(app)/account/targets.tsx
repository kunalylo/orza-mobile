/**
 * Settings → Daily targets ("Your daily numbers"): hand-tune calories, macros, fiber, water and steps, or reset them
 * to ÖRZA's recommendation for the profile and goal. Shows the energy implied by the macros (4/4/9 kcal per gram).
 */
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useState } from 'react';
import { Alert, RefreshControl, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { splitFieldError, useAccountSync, useResetTargets, useSaveTargets } from '@/features/settings/api';
import { DEFAULT_TARGETS, TARGET_FIELDS, formatNumber, type TargetKey } from '@/features/settings/options';
import { SaveBar } from '@/features/settings/parts';
import { useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import type { Targets } from '@/lib/types';
import { colors, fonts, radii, spacing } from '@/theme';
import { Button, EnergyRing, GlassCard, Icon, Screen, ScreenHeader, Tag, Text, toast } from '@/ui';

type Draft = Record<TargetKey, string>;
type Errors = Partial<Record<TargetKey, string>>;

const toDraft = (t: Targets | undefined): Draft =>
  Object.fromEntries(TARGET_FIELDS.map((f) => [f.key, String(t?.[f.key] ?? DEFAULT_TARGETS[f.key])])) as Draft;
const keyOf = (d: Draft) => TARGET_FIELDS.map((f) => d[f.key]).join('|');
/** Moves a draft onto fresher targets: every field still equal to `from` takes its value from `to`; edits stay. */
const rebase = (draft: Draft, from: Draft, to: Draft): Draft =>
  Object.fromEntries(TARGET_FIELDS.map((f) => [f.key, draft[f.key] === from[f.key] ? to[f.key] : draft[f.key]])) as Draft;

const MACROS = [
  { key: 'protein_g', label: 'Protein', kcal: 4, color: colors.coral },
  { key: 'carbs_g', label: 'Carbs', kcal: 4, color: colors.amber },
  { key: 'fat_g', label: 'Fat', kcal: 9, color: colors.violet },
] as const;

function TargetTile({
  field,
  value,
  error,
  changed,
  onChange,
  wide,
}: {
  field: (typeof TARGET_FIELDS)[number];
  value: string;
  error?: string;
  changed: boolean;
  onChange: (v: string) => void;
  wide?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.tile, wide && styles.tileWide, changed && styles.tileChanged, focused && styles.tileFocused, error && styles.tileError]}>
      <View style={styles.tileHead}>
        <Text variant="label" tone="ink" numberOfLines={1} style={styles.flex}>
          {field.label}
        </Text>
        <Text variant="eyebrow" tone="subtle">
          {field.unit}
        </Text>
      </View>
      <TextInput
        value={value}
        onChangeText={(v) => onChange(v.replace(/[^\d]/g, '').slice(0, 6))}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        keyboardType="number-pad"
        selectTextOnFocus
        maxLength={6}
        accessibilityLabel={`${field.label} in ${field.unit}`}
        accessibilityHint={`Between ${formatNumber(field.min)} and ${formatNumber(field.max)}`}
        placeholderTextColor={colors.subtle}
        style={[styles.tileInput, wide && styles.tileInputWide]}
      />
      {error ? (
        <Animated.View entering={FadeIn.duration(160)} accessibilityLiveRegion="polite">
          <Text variant="caption" color={colors.error}>
            {error}
          </Text>
        </Animated.View>
      ) : (
        <Text variant="caption" tone="subtle" numberOfLines={1}>
          {formatNumber(field.min)}–{formatNumber(field.max)}
        </Text>
      )}
    </View>
  );
}

export default function TargetsSettings() {
  const user = useSignedInUser();
  const navigation = useNavigation();
  const sync = useAccountSync();
  const saveTargets = useSaveTargets();
  const resetTargets = useResetTargets();

  const baseline = toDraft(user.targets);
  const baseKey = keyOf(baseline);
  const [draft, setDraft] = useState<Draft>(baseline);
  // The server copy the draft is edited from.
  const [base, setBase] = useState<Draft>(baseline);
  const [errors, setErrors] = useState<Errors>({});
  const [refreshing, setRefreshing] = useState(false);

  // Follow outside changes (refresh, a profile save that recalculated targets). Untouched targets take the fresh value
  // and unsaved edits stay, so Save never puts back a stale copy of a target that wasn't edited here.
  if (keyOf(base) !== baseKey) {
    setBase(baseline);
    setDraft(rebase(draft, base, baseline));
  }

  const dirty = keyOf(draft) !== baseKey;
  const saving = saveTargets.isPending;
  const resetting = resetTargets.isPending;

  usePreventRemove(dirty || saving, ({ data }) => {
    if (saving) return;
    haptics.warning();
    Alert.alert('Discard changes?', "Your new targets haven't been saved.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  // Energy implied by the macros (4/4/9 kcal per gram) vs the calorie target.
  const num = (k: TargetKey) => Number(draft[k]) || 0;
  const macroKcal = num('protein_g') * 4 + num('carbs_g') * 4 + num('fat_g') * 9;
  const calories = num('calories');
  const gap = calories > 0 ? (macroKcal - calories) / calories : 0;
  const mismatch = calories > 0 && macroKcal > 0 && Math.abs(gap) > 0.12;
  const shares = MACROS.map((m) => ({ ...m, kcal: num(m.key) * m.kcal }));

  const setField = (k: TargetKey, v: string) => {
    setDraft((d) => ({ ...d, [k]: v }));
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }));
  };

  const onSave = () => {
    if (saving) return;
    const errs: Errors = {};
    const body: Partial<Targets> = {};
    for (const f of TARGET_FIELDS) {
      if (draft[f.key] === baseline[f.key]) continue;
      const n = Number(draft[f.key]);
      if (!draft[f.key].trim() || !Number.isFinite(n)) errs[f.key] = 'Enter a number';
      else if (!Number.isInteger(n)) errs[f.key] = 'Use a whole number';
      else if (n < f.min || n > f.max) errs[f.key] = `Between ${formatNumber(f.min)} and ${formatNumber(f.max)}`;
      else body[f.key] = n;
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      haptics.error();
      return;
    }
    if (!Object.keys(body).length) return;
    const sent = draft;
    saveTargets.mutate(body, {
      onSuccess: (res) => {
        haptics.success();
        // The saved targets replace what was sent; anything edited while saving stays as typed.
        const saved = toDraft(res.user.targets);
        setDraft((d) => rebase(d, sent, saved));
        setBase(saved);
        toast.success('Daily targets saved');
      },
      onError: (e) => {
        haptics.error();
        const split = splitFieldError(e);
        const field = TARGET_FIELDS.find((f) => f.key === split?.field)?.key;
        if (field && split) setErrors((x) => ({ ...x, [field]: split.message }));
        else toast.error(split?.message || "We couldn't save your targets. Please try again.");
      },
    });
  };

  const onReset = () => {
    haptics.warning();
    Alert.alert('Reset to recommended?', "Your targets go back to ÖRZA's recommendation for your profile and goal.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        onPress: () =>
          resetTargets.mutate(undefined, {
            onSuccess: (res) => {
              haptics.success();
              setDraft(toDraft(res.user.targets));
              setErrors({});
              toast.success("Targets reset — back to ÖRZA's recommendation.");
            },
            onError: (e) => {
              haptics.error();
              toast.error(e instanceof Error && e.message ? e.message : "We couldn't reset your targets. Please try again.");
            },
          }),
      },
    ]);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await sync.refetch();
    setRefreshing(false);
  };

  return (
    <Screen
      keyboard
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.coral} colors={[colors.coral]} />}
      footer={
        <SaveBar
          dirty={dirty}
          saving={saving}
          onSave={onSave}
          onDiscard={() => {
            haptics.soft();
            setDraft(baseline);
            setErrors({});
          }}
          label="Save targets"
          idleNote="Targets are gentle guides, not rules. Changing your profile or goal may update them."
        />
      }
    >
      <ScreenHeader
        back
        large={false}
        eyebrow="Daily targets"
        title="Your daily numbers"
        subtitle="These drive your Today ring, reports and suggestions. Fine-tune them, or reset to what ÖRZA recommends."
      />

      <Animated.View entering={FadeInDown.springify().damping(18)}>
        <GlassCard tone="strong" glow padding={spacing.lg} style={styles.hero}>
          <View style={styles.heroTop}>
            <EnergyRing
              progress={calories > 0 ? Math.min(1, macroKcal / calories) : 0}
              size={104}
              stroke={10}
              accessibilityLabel={`Macros add up to about ${formatNumber(macroKcal)} of ${formatNumber(calories)} kilocalories`}
            >
              <Text variant="h3" align="center">
                {formatNumber(macroKcal)}
              </Text>
              <Text variant="eyebrow" tone="subtle" align="center">
                kcal
              </Text>
            </EnergyRing>
            <View style={styles.flex}>
              <Text variant="eyebrow" tone="subtle">
                From your macros
              </Text>
              <Text variant="small" tone="muted" style={styles.heroCopy}>
                Your protein, carbs and fat add up to about{' '}
                <Text variant="small" weight="semibold" tone="ink">
                  {formatNumber(macroKcal)} kcal
                </Text>
                {!mismatch && calories > 0 ? ' — in step with your calorie target.' : '.'}
              </Text>
              {mismatch ? <Tag tone="warning" icon="info" label={`${gap > 0 ? 'Above' : 'Below'} your calorie target`} style={styles.heroTag} /> : null}
            </View>
          </View>

          {macroKcal > 0 ? (
            <View>
              <View style={styles.split} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                {shares.map((s) => (s.kcal > 0 ? <View key={s.key} style={{ flex: s.kcal, backgroundColor: s.color }} /> : null))}
              </View>
              <View style={styles.legend}>
                {shares.map((s) => (
                  <View key={s.key} style={styles.legendItem}>
                    <View style={[styles.dot, { backgroundColor: s.color }]} />
                    <Text variant="caption" tone="muted">
                      {s.label} {Math.round((s.kcal / macroKcal) * 100)}%
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          <Button label="Reset to recommended" icon="rotate-ccw" variant="secondary" size="sm" loading={resetting} disabled={saving} onPress={onReset} style={styles.reset} />
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(80).springify().damping(18)} style={styles.grid}>
        {TARGET_FIELDS.map((f) => (
          <TargetTile
            key={f.key}
            field={f}
            wide={f.key === 'calories'}
            value={draft[f.key]}
            error={errors[f.key]}
            changed={draft[f.key] !== baseline[f.key]}
            onChange={(v) => setField(f.key, v)}
          />
        ))}
      </Animated.View>

      <View style={styles.tip}>
        <Icon name="info" size={14} color={colors.subtle} />
        <Text variant="caption" tone="subtle" style={styles.flex}>
          Protein and carbs count 4 kcal per gram, fat 9 kcal per gram.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  hero: { gap: spacing.lg },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  heroCopy: { marginTop: 4 },
  heroTag: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  split: { flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2, backgroundColor: colors.track },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  reset: { alignSelf: 'flex-start' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.xxl },
  tile: {
    flexGrow: 1,
    flexBasis: '45%',
    padding: spacing.md,
    paddingBottom: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.glass,
    gap: 2,
  },
  tileWide: { flexBasis: '100%' },
  tileChanged: { borderColor: 'rgba(11,190,220,0.45)' },
  tileFocused: { borderColor: colors.cyan, backgroundColor: colors.white, boxShadow: '0px 0px 0px 4px rgba(11,190,220,0.14)' },
  tileError: { borderColor: colors.error },
  tileHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tileInput: { fontFamily: fonts.display, fontSize: 26, lineHeight: 32, color: colors.ink, paddingVertical: 4, paddingHorizontal: 0, fontVariant: ['tabular-nums'] },
  tileInputWide: { fontSize: 32, lineHeight: 38 },
  tip: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.lg, marginHorizontal: spacing.xs },
});
