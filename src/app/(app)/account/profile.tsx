/**
 * Settings → Profile ("About you"): name, age, sex, height, weight, activity, diet, region, language, household,
 * allergies and routine. Units follow Preferences (kg/cm or lb/ft-in). Only changed fields are sent; changing a
 * target driver (age, sex, height, weight, activity) recalculates daily targets, shown in a callout.
 */
import { router, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, View, type TextInput } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';

import { splitFieldError, useAccountSync, useSaveProfile } from '@/features/settings/api';
import {
  ACTIVITY_OPTIONS,
  ALLERGY_SUGGESTIONS,
  DIET_OPTIONS,
  GOAL_LABELS,
  HOUSEHOLD_OPTIONS,
  LANGUAGE_OPTIONS,
  LIFESTYLE_SUGGESTIONS,
  PROFILE_LIMITS as L,
  SEX_OPTIONS,
} from '@/features/settings/options';
import { ChoiceList, FieldGroup, SaveBar } from '@/features/settings/parts';
import { LB_PER_KG, buildPatch, draftErrorKey, draftKey, rebaseDraft, toDraft, type DraftErrors, type ProfileDraft } from '@/features/settings/profileDraft';
import { RegionSheet } from '@/features/settings/RegionSheet';
import { TargetsCallout } from '@/features/settings/TargetsCallout';
import { useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import type { Targets } from '@/lib/types';
import { colors, radii, spacing } from '@/theme';
import { Button, Chip, GlassCard, Icon, Screen, ScreenHeader, Text, TextField, toast } from '@/ui';

const digits = (s: string, max: number) => s.replace(/[^\d]/g, '').slice(0, max);
const decimal = (s: string, max: number) => s.replace(',', '.').replace(/[^\d.]/g, '').slice(0, max);

function FormCard({ eyebrow, children, delay }: { eyebrow: string; children: ReactNode; delay: number }) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).springify().damping(18).stiffness(100).mass(1)} style={styles.section}>
      <Text variant="eyebrow" tone="subtle" style={styles.sectionTitle} accessibilityRole="header">
        {eyebrow}
      </Text>
      <GlassCard padding={spacing.lg} style={styles.card}>
        {children}
      </GlassCard>
    </Animated.View>
  );
}

export default function ProfileSettings() {
  const user = useSignedInUser();
  const navigation = useNavigation();
  const sync = useAccountSync();
  const save = useSaveProfile();

  const units = user.preferences?.units === 'imperial' ? 'imperial' : 'metric';
  const baseline = toDraft(user, units);
  const baseKey = draftKey(baseline);

  const [draft, setDraft] = useState<ProfileDraft>(baseline);
  // The server copy the draft is edited from, always in the draft's units: Save sends only what differs from it.
  const [base, setBase] = useState<ProfileDraft>(baseline);
  const [seenBase, setSeenBase] = useState(baseKey);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [allergyInput, setAllergyInput] = useState('');
  const [regionOpen, setRegionOpen] = useState(false);
  const [updatedTargets, setUpdatedTargets] = useState<Targets | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const ageRef = useRef<TextInput>(null);

  // Follow outside changes (a refresh, a weigh-in logged from Goals, a units switch). Untouched fields take the fresh
  // value and unsaved edits stay, so Save never puts back a stale copy of a field that wasn't edited here. A draft
  // without edits simply adopts the new copy (in the new units).
  if (seenBase !== baseKey) {
    setSeenBase(baseKey);
    const fresh = draft.units === units ? baseline : toDraft(user, draft.units);
    const next = rebaseDraft(draft, base, fresh);
    const clean = draftKey(next) === draftKey(fresh);
    setDraft(clean ? baseline : next);
    setBase(clean ? baseline : fresh);
  }

  const dirty = draftKey(draft) !== draftKey(base);
  const imperial = draft.units === 'imperial';
  const saving = save.isPending;

  usePreventRemove(dirty || saving, ({ data }) => {
    if (saving) return;
    haptics.warning();
    Alert.alert('Discard changes?', "Your profile changes haven't been saved.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  const set = <K extends keyof ProfileDraft>(key: K, value: ProfileDraft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    const errKey = key === 'height_cm' || key === 'height_ft' || key === 'height_in' ? 'height' : key;
    setErrors((e) => (e[errKey as keyof DraftErrors] ? { ...e, [errKey]: undefined } : e));
  };

  const toggleAllergy = (value: string) => {
    const v = value.trim().toLowerCase();
    if (!draft.allergies.includes(v) && draft.allergies.length >= L.allergies.maxItems) {
      setErrors((e) => ({ ...e, allergies: `You can save up to ${L.allergies.maxItems}` }));
      return;
    }
    haptics.select();
    set('allergies', draft.allergies.includes(v) ? draft.allergies.filter((a) => a !== v) : [...draft.allergies, v]);
  };

  const addAllergy = () => {
    const v = allergyInput.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!v) return;
    if (v.length > L.allergies.maxLength) {
      setErrors((e) => ({ ...e, allergies: `Keep each one under ${L.allergies.maxLength} characters` }));
      return;
    }
    if (draft.allergies.length >= L.allergies.maxItems) {
      setErrors((e) => ({ ...e, allergies: `You can save up to ${L.allergies.maxItems}` }));
      return;
    }
    haptics.tap();
    if (!draft.allergies.includes(v)) set('allergies', [...draft.allergies, v]);
    setAllergyInput('');
  };

  const addLifestyle = (s: string) => {
    const cur = draft.lifestyle.trim();
    if (cur.toLowerCase().includes(s.toLowerCase())) return;
    const next = cur ? `${cur}, ${s}` : s;
    if (next.length <= L.lifestyle.maxLength) {
      haptics.select();
      set('lifestyle', next);
    }
  };

  const discard = () => {
    haptics.soft();
    setDraft(baseline);
    setBase(baseline);
    setErrors({});
    setAllergyInput('');
  };

  const onSave = () => {
    if (saving) return;
    const { patch, errors: errs, changed } = buildPatch(draft, base);
    if (Object.values(errs).some(Boolean)) {
      setErrors(errs);
      haptics.error();
      toast.error('Please check the highlighted fields');
      return;
    }
    if (!changed) return;
    const sent = draft;
    save.mutate(patch, {
      onSuccess: (res) => {
        haptics.success();
        // The saved copy replaces what was sent (tidied by the server); anything edited while saving stays as typed.
        // If the draft already moved to other units it had no edits left and has adopted the fresh copy itself.
        const saved = toDraft(res.user, sent.units);
        setDraft((d) => (d.units === sent.units ? rebaseDraft(d, sent, saved) : d));
        setBase((b) => (b.units === sent.units ? saved : b));
        setErrors({});
        if (res.targets_recomputed) {
          setUpdatedTargets(res.user.targets);
          toast.success('Profile saved — your daily targets were recalculated.');
        } else {
          toast.success('Profile saved');
        }
      },
      onError: (e) => {
        haptics.error();
        const split = splitFieldError(e);
        const key = draftErrorKey(split?.field);
        if (key && split) setErrors((prev) => ({ ...prev, [key]: split.message }));
        else toast.error(split?.message || "We couldn't save your profile. Please try again.");
      },
    });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await sync.refetch();
    setRefreshing(false);
  };

  const customAllergies = draft.allergies.filter((a) => !ALLERGY_SUGGESTIONS.some((s) => s.value === a));
  const goal = user.profile?.goal;
  const targetWeight = user.profile?.target_weight_kg;

  return (
    <Screen
      keyboard
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.coral} colors={[colors.coral]} />}
      footer={
        <SaveBar
          dirty={dirty}
          saving={saving}
          onSave={onSave}
          onDiscard={discard}
          label="Save profile"
          idleNote="Changing age, sex, height, weight or activity recalculates your daily targets."
        />
      }
    >
      <ScreenHeader
        back
        large={false}
        eyebrow="Profile"
        title="About you"
        subtitle="ÖRZA uses these details to set your daily targets and to suggest food that fits your diet, region and routine."
      />

      {goal ? (
        <Animated.View entering={FadeInDown.springify().damping(18).stiffness(100).mass(1)}>
          <GlassCard tone="energy" padding={spacing.lg} onPress={() => router.push('/goals')} accessibilityLabel={`Current goal: ${GOAL_LABELS[goal]}. Change goal`} style={styles.goal}>
            <View style={styles.flex}>
              <Text variant="eyebrow" tone="energy">
                Current goal
              </Text>
              <Text variant="title" style={styles.goalTitle}>
                {GOAL_LABELS[goal]}
                {goal !== 'maintain' && targetWeight != null ? (
                  <Text variant="callout" tone="muted">
                    {' '}
                    · target {imperial ? `${Math.round(targetWeight * LB_PER_KG)} lb` : `${targetWeight} kg`}
                  </Text>
                ) : null}
              </Text>
            </View>
            <View style={styles.goalLink}>
              <Text variant="label" tone="energy">
                Change goal
              </Text>
              <Icon name="arrow-up-right" size={14} color={colors.energyInk} />
            </View>
          </GlassCard>
        </Animated.View>
      ) : null}

      {updatedTargets ? <TargetsCallout targets={updatedTargets} onDismiss={() => setUpdatedTargets(null)} /> : null}

      <FormCard eyebrow="Basics" delay={60}>
        <TextField
          label="Name"
          value={draft.name}
          maxLength={L.name.maxLength}
          autoComplete="name"
          textContentType="name"
          autoCapitalize="words"
          returnKeyType="next"
          onSubmitEditing={() => ageRef.current?.focus()}
          onChangeText={(v) => set('name', v)}
          error={errors.name}
        />
        <TextField label="Email" value={user.email} editable={false} hint="Used to sign in. It can't be changed here." icon="mail" />
        <TextField
          ref={ageRef}
          label="Age"
          value={draft.age}
          keyboardType="number-pad"
          placeholder="e.g. 32"
          suffix="years"
          onChangeText={(v) => set('age', digits(v, 3))}
          error={errors.age}
        />
        <FieldGroup label="Sex" error={errors.sex}>
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Sex">
            {SEX_OPTIONS.map((o) => (
              <Chip key={o.value} label={o.label} role="radio" selected={draft.sex === o.value} onPress={() => set('sex', o.value)} />
            ))}
          </View>
        </FieldGroup>
      </FormCard>

      <FormCard eyebrow="Body" delay={110}>
        {imperial ? (
          <FieldGroup label="Height" error={errors.height}>
            <View style={styles.pair}>
              <TextField
                value={draft.height_ft}
                keyboardType="number-pad"
                suffix="ft"
                accessibilityLabel="Height, feet"
                onChangeText={(v) => set('height_ft', digits(v, 1))}
                containerStyle={styles.flex}
              />
              <TextField
                value={draft.height_in}
                keyboardType="decimal-pad"
                suffix="in"
                accessibilityLabel="Height, inches"
                onChangeText={(v) => set('height_in', decimal(v, 4))}
                containerStyle={styles.flex}
              />
            </View>
          </FieldGroup>
        ) : (
          <TextField
            label="Height"
            value={draft.height_cm}
            keyboardType="decimal-pad"
            placeholder="e.g. 165"
            suffix="cm"
            onChangeText={(v) => set('height_cm', decimal(v, 5))}
            error={errors.height}
          />
        )}
        <TextField
          label="Weight"
          value={draft.weight}
          keyboardType="decimal-pad"
          placeholder={imperial ? 'e.g. 150' : 'e.g. 68'}
          suffix={imperial ? 'lb' : 'kg'}
          onChangeText={(v) => set('weight', decimal(v, 6))}
          error={errors.weight}
          hint="Changing it also logs today's weigh-in."
        />
        <Text variant="caption" tone="subtle">
          Showing {imperial ? 'pounds and feet' : 'kilograms and centimetres'} — switch units in Preferences.
        </Text>
      </FormCard>

      <FormCard eyebrow="Activity" delay={160}>
        <ChoiceList label="Activity" options={ACTIVITY_OPTIONS} value={draft.activity_level} onChange={(v) => set('activity_level', v)} />
      </FormCard>

      <FormCard eyebrow="Food & place" delay={210}>
        <FieldGroup label="Diet">
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Diet">
            {DIET_OPTIONS.map((o) => (
              <Chip key={o.value} label={o.label} role="radio" selected={draft.diet === o.value} onPress={() => set('diet', o.value)} />
            ))}
          </View>
        </FieldGroup>

        <FieldGroup label="Region" error={errors.region} hint="Your state helps ÖRZA suggest familiar dishes.">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={draft.region ? `Region: ${draft.region}. Change region` : 'Choose your region'}
            onPress={() => {
              haptics.tap();
              setRegionOpen(true);
            }}
            style={({ pressed }) => [styles.select, errors.region && styles.selectError, pressed && styles.pressed]}
          >
            <Icon name="map-pin" size={17} color={draft.region ? colors.energyInk : colors.subtle} />
            <Text variant="body" tone={draft.region ? 'ink' : 'subtle'} style={styles.flex} numberOfLines={1}>
              {draft.region || 'e.g. Maharashtra'}
            </Text>
            <Icon name="chevron-down" size={18} color={colors.subtle} />
          </Pressable>
        </FieldGroup>

        <FieldGroup label="Language">
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Language">
            {LANGUAGE_OPTIONS.map((o) => (
              <Chip key={o.value} label={o.label} role="radio" selected={draft.language === o.value} onPress={() => set('language', o.value)} />
            ))}
          </View>
        </FieldGroup>
      </FormCard>

      <FormCard eyebrow="Household" delay={260}>
        <ChoiceList label="Household" options={HOUSEHOLD_OPTIONS} value={draft.household_mode} onChange={(v) => set('household_mode', v)} />
      </FormCard>

      <FormCard eyebrow="Allergies" delay={310}>
        <FieldGroup
          label="Allergies & foods you avoid"
          error={errors.allergies}
          hint={draft.allergies.length ? null : 'No allergies saved — ÖRZA will suggest anything that fits your diet.'}
        >
          <Animated.View layout={LinearTransition.springify().damping(20).stiffness(100).mass(1)} style={styles.chips}>
            {ALLERGY_SUGGESTIONS.map((o) => {
              const on = draft.allergies.includes(o.value);
              return <Chip key={o.value} label={o.label} role="checkbox" selected={on} icon={on ? 'check' : undefined} onPress={() => toggleAllergy(o.value)} />;
            })}
            {customAllergies.map((a) => (
              <Animated.View key={a} entering={FadeIn.duration(180)}>
                <Chip label={a} selected icon="x" accessibilityHint="Removes it from your list" onPress={() => toggleAllergy(a)} />
              </Animated.View>
            ))}
          </Animated.View>
        </FieldGroup>
        <View style={styles.addRow}>
          <TextField
            value={allergyInput}
            maxLength={L.allergies.maxLength}
            onChangeText={setAllergyInput}
            onSubmitEditing={addAllergy}
            submitBehavior="submit"
            returnKeyType="done"
            placeholder="Add another, e.g. mushrooms"
            accessibilityLabel="Add another allergy or food you avoid"
            containerStyle={styles.flex}
          />
          <Button label="Add" icon="plus" variant="secondary" onPress={addAllergy} disabled={!allergyInput.trim()} accessibilityLabel="Add allergy" />
        </View>
      </FormCard>

      <FormCard eyebrow="Routine" delay={360}>
        <TextField
          label="Routine (optional)"
          value={draft.lifestyle}
          maxLength={L.lifestyle.maxLength}
          multiline
          onChangeText={(v) => set('lifestyle', v)}
          placeholder="e.g. Desk job, gym three evenings a week"
          error={errors.lifestyle}
          inputStyle={styles.multiline}
        />
        <View style={styles.chips} accessibilityLabel="Routine suggestions">
          {LIFESTYLE_SUGGESTIONS.map((s) => (
            <Chip key={s} label={s} size="sm" icon="plus" onPress={() => addLifestyle(s)} accessibilityHint="Adds it to your routine" />
          ))}
        </View>
      </FormCard>

      <RegionSheet visible={regionOpen} value={draft.region} onClose={() => setRegionOpen(false)} onSelect={(r) => set('region', r)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  section: { marginTop: spacing.xxl },
  sectionTitle: { marginBottom: spacing.sm, marginLeft: spacing.xs },
  card: { gap: spacing.lg },
  goal: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  goalTitle: { marginTop: 2 },
  goalLink: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pair: { flexDirection: 'row', gap: spacing.md },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  select: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 54,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    borderWidth: 1.5,
    borderColor: colors.hairline,
    backgroundColor: colors.glassStrong,
  },
  selectError: { borderColor: colors.error },
  pressed: { opacity: 0.8 },
});
