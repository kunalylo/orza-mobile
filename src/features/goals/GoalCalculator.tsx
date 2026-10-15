/**
 * Goal planner: goal type, weights, a safe pace and the profile details that drive BMR/TDEE — with a live
 * calorie preview (pure `planGoal`, the same maths as the server). Weights and height are typed in the
 * member's units (Settings → Units) and always sent as kg / cm.
 */
import { useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';

import { errorMessage } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import type { ActivityLevel, GoalType, Profile, Sex, Targets } from '@/lib/types';
import { colors, radii, spacing } from '@/theme';
import { Button, Chip, GlassCard, Icon, Segmented, Text, TextField, toast } from '@/ui';

import { fieldError, useCalculateGoal } from './api';
import {
  ACTIVITY_OPTIONS,
  GAIN_PACES,
  KG_PER_LB,
  LOSS_PACES,
  MAX_HEIGHT_CM,
  MAX_WEIGHT_KG,
  MIN_HEIGHT_CM,
  MIN_WEIGHT_KG,
  cmToFeetInches,
  feetInchesToCm,
  formatPace,
  goalInputError,
  healthyFloorKg,
  kgToUnit,
  nearestPace,
  parseNum,
  planGoal,
  signedRate,
  unitToKg,
  weightRange,
  weightUnit,
} from './math';
import { PlanPreview } from './PlanPreview';
import type { Goal, GoalCalculateResponse } from './types';

const valid = (n: number, lo: number, hi: number) => Number.isFinite(n) && n >= lo && n <= hi;
const digits = (t: string, max = 6) => t.replace(/[^0-9.,]/g, '').slice(0, max);

type FieldKey = 'current' | 'target' | 'height' | 'age';
const SERVER_FIELD: Record<string, FieldKey> = { current_weight_kg: 'current', target_weight_kg: 'target', height_cm: 'height', age: 'age' };

const SEX_OPTIONS: { value: Sex | ''; label: string }[] = [
  { value: '', label: 'Prefer not to say' },
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'other', label: 'Other' },
];

export function GoalCalculator({
  goal: active,
  profile,
  latestWeight,
  currentTargets,
  today,
  imperial,
  onSaved,
}: {
  goal: Goal | null;
  profile: Profile;
  /** Latest weigh-in (kg); "Current weight" follows it when a new weigh-in is logged on the screen. */
  latestWeight: number | null;
  currentTargets: Targets;
  today: string;
  imperial: boolean;
  onSaved: (res: GoalCalculateResponse) => void;
}) {
  const save = useCalculateGoal(today);
  const unit = weightUnit(imperial);
  const range = weightRange(imperial);

  const initialGoal: GoalType = active?.goal || profile.goal || 'lose';
  const [goal, setGoal] = useState<GoalType>(initialGoal);
  const [current, setCurrent] = useState(() => {
    const w = latestWeight ?? profile.weight_kg;
    return w ? String(kgToUnit(w, imperial)) : '';
  });
  const [target, setTarget] = useState(() => {
    const t = active && active.goal !== 'maintain' ? active.target_weight_kg : profile.target_weight_kg;
    return t ? String(kgToUnit(t, imperial)) : '';
  });
  const [pace, setPace] = useState<number>(() => nearestPace(initialGoal, active?.weekly_rate_kg));
  const [height, setHeight] = useState(profile.height_cm ? String(profile.height_cm) : '');
  const [heightFt, setHeightFt] = useState(() => (profile.height_cm ? String(cmToFeetInches(profile.height_cm).ft) : ''));
  const [heightIn, setHeightIn] = useState(() => (profile.height_cm ? String(cmToFeetInches(profile.height_cm).inches) : ''));
  // Until ft/in are edited, keep the stored centimetres exactly (whole-inch rounding would drift them).
  const [heightEdited, setHeightEdited] = useState(false);
  const [age, setAge] = useState(profile.age ? String(profile.age) : '');
  const [sex, setSex] = useState<Sex | ''>(profile.sex || '');
  const [activity, setActivity] = useState<ActivityLevel>(profile.activity_level || 'light');
  const [serverErrors, setServerErrors] = useState<Partial<Record<FieldKey, string>>>({});

  // A weigh-in logged on this screen is the freshest number — follow it, so saving never writes an older weight.
  const [seenLatest, setSeenLatest] = useState(latestWeight);
  if (latestWeight !== seenLatest) {
    setSeenLatest(latestWeight);
    if (latestWeight != null) setCurrent(String(kgToUnit(latestWeight, imperial)));
  }

  const targetRef = useRef<TextInput>(null);
  const ageRef = useRef<TextInput>(null);
  const inchesRef = useRef<TextInput>(null);

  const changeGoal = (g: GoalType) => {
    setGoal(g);
    setPace((p) => (g === 'gain' ? 0.25 : g === 'lose' ? (LOSS_PACES.some((o) => o.rate === p) ? p : 0.5) : p));
  };
  const clearServer = (k: FieldKey) => {
    if (serverErrors[k]) setServerErrors((e) => ({ ...e, [k]: undefined }));
  };

  /* ─── derived ─── */
  const curInput = parseNum(current);
  const cur = Number.isFinite(curInput) ? unitToKg(curInput, imperial) : NaN;
  const tgtInput = parseNum(target);
  const tgt = goal === 'maintain' ? cur : Number.isFinite(tgtInput) ? unitToKg(tgtInput, imperial) : NaN;
  const ftN = parseNum(heightFt);
  const inN = heightIn.trim() === '' ? 0 : parseNum(heightIn);
  const h = !imperial
    ? parseNum(height)
    : !heightEdited && profile.height_cm
      ? profile.height_cm
      : Number.isInteger(ftN) && ftN >= 0 && Number.isFinite(inN) && inN >= 0 && inN < 12
        ? feetInchesToCm(ftN, inN)
        : NaN;
  const a = parseNum(age);
  const curOk = valid(cur, MIN_WEIGHT_KG, MAX_WEIGHT_KG);
  const tgtOk = valid(tgt, MIN_WEIGHT_KG, MAX_WEIGHT_KG);
  const hOk = valid(h, MIN_HEIGHT_CM, MAX_HEIGHT_CM);
  const heightTyped = imperial ? heightFt.trim() !== '' || heightIn.trim() !== '' : height.trim() !== '';
  const aOk = valid(a, 13, 100) && Number.isInteger(a);
  const rate = signedRate(goal, pace);

  const fieldErrors: Record<FieldKey, string | null> = {
    current: serverErrors.current ?? (current && !curOk ? `Enter a weight between ${range.min} and ${range.max} ${unit}.` : null),
    target: serverErrors.target ?? (goal !== 'maintain' && target && !tgtOk ? `Enter a target between ${range.min} and ${range.max} ${unit}.` : null),
    height: serverErrors.height ?? (heightTyped && !hOk ? (imperial ? 'Enter a height between 3 ft 4 in and 8 ft 2 in.' : 'Height between 100 and 250 cm.') : null),
    age: serverErrors.age ?? (age && !aOk ? 'ÖRZA goal planning is for ages 13–100.' : null),
  };

  const ready = curOk && tgtOk && hOk && aOk;
  const inputError = ready ? goalInputError({ goal, current: cur, target: tgt, rate, heightCm: h, imperial }) : null;

  const plan = useMemo(() => {
    if (!ready) return null;
    const merged: Profile = { ...profile, height_cm: h, age: a, ...(sex ? { sex } : {}), activity_level: activity, weight_kg: cur, goal };
    return planGoal({ profile: merged, goal, current: cur, target: tgt, rate, today });
  }, [ready, profile, h, a, sex, activity, cur, goal, tgt, rate, today]);

  const blocker = inputError || plan?.blocker || null;
  const missing = [!curOk && 'current weight', goal !== 'maintain' && !tgtOk && 'target weight', !hOk && 'height', !aOk && 'age'].filter(Boolean) as string[];

  const submit = () => {
    if (!plan || blocker) {
      haptics.warning();
      toast.error(blocker || `Add your ${missing.join(', ')} to see your plan.`);
      return;
    }
    setServerErrors({});
    save.mutate(
      {
        goal,
        current_weight_kg: cur,
        target_weight_kg: tgt,
        weekly_rate_kg: rate,
        height_cm: Math.round(h * 10) / 10,
        age: a,
        ...(sex ? { sex } : {}),
        activity_level: activity,
      },
      {
        onSuccess: (res) => {
          haptics.success();
          onSaved(res);
        },
        onError: (e) => {
          haptics.error();
          const f = fieldError(e);
          const key = f ? SERVER_FIELD[f.field] : undefined;
          if (f && key) setServerErrors({ [key]: f.message });
          else toast.error(errorMessage(e));
        },
      },
    );
  };

  const paces = goal === 'gain' ? GAIN_PACES : LOSS_PACES;
  const floorKg = hOk ? healthyFloorKg(h) : null;
  const activityHint = ACTIVITY_OPTIONS.find((o) => o.value === activity)?.hint;

  return (
    <View style={styles.wrap}>
      <GlassCard tone="strong">
        <Text variant="label" tone="text">
          What would you like to do?
        </Text>
        <Segmented<GoalType>
          accessibilityLabel="Goal type"
          value={goal}
          onChange={changeGoal}
          options={[
            { value: 'lose', label: 'Lose' },
            { value: 'maintain', label: 'Maintain' },
            { value: 'gain', label: 'Gain' },
          ]}
          style={styles.segmented}
        />

        <View style={styles.pair}>
          <TextField
            label="Current weight"
            suffix={unit}
            value={current}
            onChangeText={(t) => {
              setCurrent(digits(t));
              clearServer('current');
            }}
            keyboardType="decimal-pad"
            inputMode="decimal"
            placeholder={imperial ? 'e.g. 160' : 'e.g. 72.5'}
            returnKeyType="next"
            onSubmitEditing={() => (goal === 'maintain' ? ageRef.current?.focus() : targetRef.current?.focus())}
            error={fieldErrors.current}
            containerStyle={styles.half}
          />
          {goal === 'maintain' ? (
            <TextField
              label="Target weight"
              value={curOk ? `${kgToUnit(cur, imperial)} ${unit}` : 'Same as current'}
              editable={false}
              hint="ÖRZA will help you hold steady around here."
              containerStyle={styles.half}
            />
          ) : (
            <TextField
              ref={targetRef}
              label="Target weight"
              suffix={unit}
              value={target}
              onChangeText={(t) => {
                setTarget(digits(t));
                clearServer('target');
              }}
              keyboardType="decimal-pad"
              inputMode="decimal"
              placeholder={goal === 'lose' ? (imperial ? 'e.g. 145' : 'e.g. 66') : imperial ? 'e.g. 132' : 'e.g. 60'}
              error={fieldErrors.target}
              hint={goal === 'lose' && floorKg ? `The healthy range for your height starts around ${imperial ? `${Math.ceil(floorKg / KG_PER_LB)} lb` : `${floorKg} kg`}.` : undefined}
              containerStyle={styles.half}
            />
          )}
        </View>

        {goal !== 'maintain' ? (
          <View style={styles.section}>
            <Text variant="label" tone="text">
              Pace
            </Text>
            <View style={styles.paces} accessibilityRole="radiogroup" accessibilityLabel="Weekly pace">
              {paces.map((p) => {
                const selected = pace === p.rate;
                return (
                  <Pressable
                    key={p.rate}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={`${p.label}, ${formatPace(p.rate, imperial)} a week. ${p.note}`}
                    onPress={() => {
                      if (selected) return;
                      haptics.select();
                      setPace(p.rate);
                    }}
                    style={({ pressed }) => [styles.pace, selected && styles.paceSelected, pressed && styles.pressed]}
                  >
                    <View style={styles.paceTop}>
                      <Text variant="label" numberOfLines={1}>
                        {p.label}
                      </Text>
                      {selected ? <Icon name="check" size={14} color="#E0593F" /> : null}
                    </View>
                    <Text variant="mono" tone="muted" style={styles.paceRate} numberOfLines={1}>
                      {formatPace(p.rate, imperial)}/wk
                    </Text>
                    <Text variant="caption" tone="subtle" numberOfLines={2}>
                      {p.note}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text variant="caption" tone="subtle">
              {goal === 'lose'
                ? `ÖRZA keeps weight loss at ${imperial ? 'about 2.2 lb' : '1 kg'} a week or less, and never plans below a safe calorie floor.`
                : `ÖRZA keeps weight gain to ${imperial ? 'about 1.1 lb' : '0.5 kg'} a week or less so it stays lean.`}
            </Text>
          </View>
        ) : null}

        <View style={styles.about}>
          <Text variant="eyebrow" tone="subtle">
            About you
          </Text>
          <Text variant="small" tone="muted" style={styles.aboutBody}>
            Used to estimate your energy needs. Prefilled from your profile — update anything that&apos;s changed.
          </Text>

          <View style={[styles.pair, imperial && styles.stack]}>
            {imperial ? (
              <View>
                <Text variant="label" tone="text" style={styles.fieldLabel}>
                  Height
                </Text>
                <View style={styles.ftIn}>
                  <TextField
                    accessibilityLabel="Height, feet"
                    suffix="ft"
                    value={heightFt}
                    onChangeText={(t) => {
                      setHeightFt(t.replace(/[^0-9]/g, '').slice(0, 1));
                      setHeightEdited(true);
                      clearServer('height');
                    }}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    placeholder="5"
                    returnKeyType="next"
                    onSubmitEditing={() => inchesRef.current?.focus()}
                    containerStyle={styles.flex}
                  />
                  <TextField
                    ref={inchesRef}
                    accessibilityLabel="Height, inches"
                    suffix="in"
                    value={heightIn}
                    onChangeText={(t) => {
                      setHeightIn(digits(t, 4));
                      setHeightEdited(true);
                      clearServer('height');
                    }}
                    keyboardType="decimal-pad"
                    inputMode="decimal"
                    placeholder="6"
                    containerStyle={styles.flex}
                  />
                </View>
                {fieldErrors.height ? (
                  <Text variant="caption" tone="error" style={styles.inlineError}>
                    {fieldErrors.height}
                  </Text>
                ) : null}
              </View>
            ) : (
              <TextField
                label="Height"
                suffix="cm"
                value={height}
                onChangeText={(t) => {
                  setHeight(digits(t, 5));
                  clearServer('height');
                }}
                keyboardType="decimal-pad"
                inputMode="decimal"
                placeholder="e.g. 165"
                returnKeyType="next"
                onSubmitEditing={() => ageRef.current?.focus()}
                error={fieldErrors.height}
                containerStyle={styles.half}
              />
            )}
            <TextField
              ref={ageRef}
              label="Age"
              suffix="yrs"
              value={age}
              onChangeText={(t) => {
                setAge(t.replace(/[^0-9]/g, '').slice(0, 3));
                clearServer('age');
              }}
              keyboardType="number-pad"
              inputMode="numeric"
              placeholder="e.g. 30"
              error={fieldErrors.age}
              containerStyle={imperial ? styles.ageImperial : styles.half}
            />
          </View>

          <Text variant="label" tone="text" style={styles.groupLabel}>
            Sex
          </Text>
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Sex">
            {SEX_OPTIONS.map((o) => (
              <Chip key={o.value || 'none'} label={o.label} size="sm" role="radio" selected={sex === o.value} onPress={() => setSex(o.value)} />
            ))}
          </View>

          <Text variant="label" tone="text" style={styles.groupLabel}>
            Activity
          </Text>
          <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Activity level">
            {ACTIVITY_OPTIONS.map((o) => (
              <Chip key={o.value} label={o.label} size="sm" role="radio" selected={activity === o.value} accessibilityHint={o.hint} onPress={() => setActivity(o.value)} />
            ))}
          </View>
          {activityHint ? (
            <Text variant="caption" tone="subtle" style={styles.activityHint}>
              {activityHint}
            </Text>
          ) : null}
        </View>
      </GlassCard>

      <PlanPreview
        plan={plan}
        blocker={blocker}
        missing={missing}
        goal={goal}
        imperial={imperial}
        currentTargets={currentTargets}
        footer={
          <>
            <Button
              label={active ? 'Save & update my targets' : 'Set my goal'}
              icon="zap"
              variant="hero"
              size="lg"
              block
              loading={save.isPending}
              disabled={!!blocker}
              onPress={submit}
              haptic="firm"
            />
            <Text variant="caption" tone="heroSubtle" align="center">
              AI-powered planning adapts to your lifestyle and progress. Wellness guidance, not medical advice.
            </Text>
          </>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.lg },
  flex: { flex: 1 },
  segmented: { marginTop: spacing.sm },
  pair: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
  half: { flex: 1, minWidth: 0 },
  stack: { flexDirection: 'column', gap: spacing.lg },
  ageImperial: { width: '50%', paddingRight: spacing.sm / 2 },
  section: { marginTop: spacing.xl, gap: spacing.sm },
  paces: { flexDirection: 'row', gap: spacing.sm },
  pace: {
    flex: 1,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: 'rgba(255,255,255,0.6)',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: 2,
    minHeight: 92,
  },
  paceSelected: { borderColor: 'rgba(255,122,106,0.45)', backgroundColor: '#FFF6F1', boxShadow: '0px 8px 24px rgba(255,122,106,0.12)' },
  pressed: { opacity: 0.85 },
  paceTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  paceRate: { fontSize: 11 },
  about: { marginTop: spacing.xxl, paddingTop: spacing.xl, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairlineStrong },
  aboutBody: { marginTop: spacing.xs },
  fieldLabel: { marginBottom: 8, marginLeft: 4 },
  ftIn: { flexDirection: 'row', gap: spacing.sm },
  inlineError: { marginTop: 7, marginLeft: 4 },
  groupLabel: { marginTop: spacing.xl, marginBottom: spacing.sm, marginLeft: 4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  activityHint: { marginTop: spacing.sm, marginLeft: 4 },
});
