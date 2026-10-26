import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View, type TextInput } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';

import { ApiError, errorMessage, validationField } from '@/lib/api';
import { useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { loadVoiceLang, saveVoiceLang, useVoiceInput, type VoiceLang } from '@/lib/voice';
import { colors, diagonal, gradients, radii, shadows, spacing } from '@/theme';
import { Button, Chip, GlassCard, Icon, Segmented, Text, TextField, toast } from '@/ui';

import { useLogMealText } from './api';
import type { AiStatus, MealType, TextLogResponse } from './types';
import { FALLBACK_COSTS, MEAL_SINGULAR, MEAL_TYPES, formatNumber } from './utils';

const MAX_CHARS = 500;

/** The log request got no answer, but the server may have finished it — so check the list before retrying. */
const NO_ANSWER_MESSAGE = {
  timeout: 'ÖRZA took too long to answer, but it may still have logged this meal. Check your list below before trying again.',
  network: 'The connection dropped before ÖRZA answered. If the meal went through, it will show in your list below — check before trying again.',
} as const;

/** Real sentences people type — English, Hindi and Hinglish, with Indian portions. */
const EXAMPLES = [
  'Aaj maine breakfast mein do paratha aur dahi khaya',
  '2 roti, 1 katori dal and half plate rice',
  'aaj poha aur chai',
  'Masala dosa from a restaurant',
  'Ek katori rajma aur ek plate chawal',
];

const LANGS: { value: VoiceLang; label: string }[] = [
  { value: 'en-IN', label: 'English' },
  { value: 'hi-IN', label: 'हिंदी' },
];

export type ComposerMealType = MealType | 'auto';

export interface MealComposerHandle {
  focus: () => void;
  /** Start listening right away (no-op when voice isn't available). */
  startVoice: () => void;
}

/** "Tell ÖRZA what you ate" — type or speak a meal; ÖRZA parses and logs it. */
export function MealComposer({
  ref,
  date,
  isToday,
  dayLabel,
  mealType,
  onMealTypeChange,
  aiStatus,
  onLogged,
  onOpenFoodList,
}: {
  ref?: Ref<MealComposerHandle>;
  date: string;
  isToday: boolean;
  dayLabel: string;
  mealType: ComposerMealType;
  onMealTypeChange: (t: ComposerMealType) => void;
  aiStatus: AiStatus | null;
  onLogged: (res: TextLogResponse) => void;
  onOpenFoodList: () => void;
}) {
  const user = useSignedInUser();
  const [text, setText] = useState('');
  const [lang, setLang] = useState<VoiceLang>(user.profile?.language === 'hi' ? 'hi-IN' : 'en-IN');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<{ message: string; code: string } | null>(null);
  const usedVoice = useRef(false);
  const inputRef = useRef<TextInput>(null);
  const logText = useLogMealText();
  const submitting = logText.isPending;
  /**
   * Synchronous guard: `isPending` only flips on the next render, and a hardware Enter key fires the editor action on
   * key-down and key-up — two submits in one tick logged the meal twice (two AI calls, two credits).
   */
  const inFlight = useRef(false);

  // Remember the voice language (Hindi speakers shouldn't have to switch every time) — shared with Ask ÖRZA.
  useEffect(() => {
    let alive = true;
    void loadVoiceLang().then((saved) => {
      if (alive && saved) setLang(saved);
    });
    return () => {
      alive = false;
    };
  }, []);

  const chooseLang = (l: VoiceLang) => {
    setLang(l);
    saveVoiceLang(l);
  };

  const voice = useVoiceInput({
    onFinal: (heard) => {
      usedVoice.current = true;
      setFieldError(null);
      setText((prev) => (prev.trim() ? `${prev.trimEnd()} ${heard}` : heard).slice(0, MAX_CHARS));
      haptics.soft();
    },
  });

  const startVoice = () => {
    if (!voice.available || submitting) return;
    setFormError(null);
    haptics.firm();
    void voice.start(lang);
  };

  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
    // No speech recognition on this phone → fall back to the keyboard.
    startVoice: () => (voice.available ? startVoice() : inputRef.current?.focus()),
  }));

  const toggleMic = () => {
    if (voice.listening) {
      haptics.tap();
      voice.stop();
    } else {
      inputRef.current?.blur();
      startVoice();
    }
  };

  const submit = () => {
    const value = text.trim();
    if (submitting || inFlight.current) return;
    if (value.length < 2) {
      haptics.error();
      setFieldError('Tell ÖRZA what you ate — e.g. “2 roti and 1 katori dal”.');
      // The send key keeps focus (`submitBehavior="submit"`), so the keyboard stays up to fix it.
      inputRef.current?.focus();
      return;
    }
    // Valid: put the keyboard away so the "Understanding…" state and the logged card are visible.
    inputRef.current?.blur();
    if (voice.listening) voice.cancel();
    setFieldError(null);
    setFormError(null);
    haptics.firm();
    inFlight.current = true;
    logText.mutate(
      { text: value, date, meal_type: mealType === 'auto' ? undefined : mealType, source: usedVoice.current ? 'voice' : 'text' },
      {
        onSuccess: (res) => {
          haptics.success();
          toast.success(`Logged to ${MEAL_SINGULAR[res.meal.meal_type].toLowerCase()} — ${formatNumber(res.meal.totals.calories)} kcal`);
          setText('');
          usedVoice.current = false;
          inputRef.current?.blur();
          onLogged(res);
        },
        onError: (e) => {
          haptics.error();
          // The server's zod 400 reads "text: Tell ÖRZA a little more…" (no `field`).
          const invalid = validationField(e);
          if (invalid?.field === 'text') setFieldError(invalid.message);
          else if (e instanceof ApiError && e.code === 'no_items') setFieldError(e.message);
          // No answer: the server may still log it (the day is being refetched) — a blind retry could log it twice.
          else if (e instanceof ApiError && e.isNetwork) setFormError({ message: NO_ANSWER_MESSAGE[e.code === 'timeout' ? 'timeout' : 'network'], code: e.code });
          else setFormError({ message: errorMessage(e), code: e instanceof ApiError ? (e.status === 402 ? 'no_credits' : e.code) : 'unknown' });
        },
        onSettled: () => {
          inFlight.current = false;
        },
      }
    );
  };

  const applyExample = (ex: string) => {
    usedVoice.current = false;
    setFieldError(null);
    setText(ex);
    inputRef.current?.focus();
  };

  const cost = aiStatus?.costs?.meal_text ?? FALLBACK_COSTS.meal_text;
  const costHint =
    aiStatus == null
      ? null
      : !aiStatus.ai_enabled
        ? "Free · ÖRZA's built-in Indian food list"
        : user.credits < cost
          ? // The server then logs it free with the built-in list (and says so) — "1 credit · 0 left" read like a dead end.
            "No AI credits left · logs free with ÖRZA's built-in food list"
          : `AI estimate · ${cost} credit${cost === 1 ? '' : 's'} · ${formatNumber(user.credits)} left`;

  return (
    <GlassCard tone="strong" glow padding={spacing.lg + 2}>
      <View style={styles.head}>
        <LinearGradient colors={gradients.energy} start={diagonal.start} end={diagonal.end} style={styles.tile}>
          <Icon name="mci:creation" size={18} color={colors.white} />
        </LinearGradient>
        <View style={styles.headText}>
          <Text variant="eyebrow" tone="energy">
            Type or speak
          </Text>
          <Text variant="h2" tone="ink" accessibilityRole="header" style={styles.title}>
            Tell ÖRZA what you ate
          </Text>
          <Text variant="small" tone="muted">
            In English, Hindi or Hinglish — “ek katori”, “half plate”, “do roti” all work.
          </Text>
        </View>
      </View>

      {!isToday ? (
        <View style={styles.dayNote}>
          <Icon name="clock" size={14} color={colors.violet600} />
          <Text variant="caption" color={colors.violet600} style={styles.flex}>
            Logging for <Text variant="caption" weight="semibold" color={colors.violet600}>{dayLabel}</Text> — new entries go to that day.
          </Text>
        </View>
      ) : null}

      <View style={styles.field}>
        <TextField
          ref={inputRef}
          value={text}
          onChangeText={(t) => {
            setText(t);
            if (!t.trim()) usedVoice.current = false;
            if (fieldError) setFieldError(null);
          }}
          editable={!submitting}
          multiline
          maxLength={MAX_CHARS}
          placeholder={voice.listening ? 'Listening…' : '“aaj poha aur chai” or “2 roti with dal”'}
          accessibilityLabel="What did you eat?"
          error={fieldError}
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={submit}
          inputStyle={styles.input}
        />
        <Text variant="mono" tone="subtle" style={styles.counter} accessibilityElementsHidden importantForAccessibility="no">
          {text.length}/{MAX_CHARS}
        </Text>
      </View>

      {voice.available ? (
        <View style={styles.voiceRow}>
          <MicButton listening={voice.listening} disabled={submitting} onPress={toggleMic} />
          <Segmented
            accessibilityLabel="Voice language"
            size="sm"
            value={lang}
            onChange={chooseLang}
            options={LANGS}
            style={styles.langs}
          />
        </View>
      ) : null}

      {voice.available ? (
        <View style={styles.status} accessibilityLiveRegion="polite">
          {voice.listening ? (
            <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.statusRow}>
              <PulseDot />
              <Text variant="small" tone={voice.partial ? 'text' : 'ink'} italic={!!voice.partial} numberOfLines={2} style={styles.flex}>
                {voice.partial || 'Listening — speak now, tap ■ when done'}
              </Text>
            </Animated.View>
          ) : voice.error ? (
            <View style={styles.statusRow}>
              <Icon name="alert-triangle" size={14} color={colors.warning} />
              <View style={styles.flex}>
                <Text variant="small" tone="warning">
                  {voice.error}
                </Text>
                {voice.blocked ? (
                  <Pressable onPress={() => void Linking.openSettings()} accessibilityRole="link" hitSlop={8} style={styles.settingsLink}>
                    <Text variant="small" weight="semibold" tone="cyan">
                      Open Settings
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
          ) : (
            <Text variant="caption" tone="subtle">
              Tap the mic and say it the way you would to a friend.
            </Text>
          )}
        </View>
      ) : null}

      <View style={styles.examples}>
        <Text variant="eyebrow" tone="subtle">
          Try saying
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          style={styles.bleed}
          keyboardShouldPersistTaps="handled"
        >
          {EXAMPLES.map((ex) => (
            <Chip key={ex} label={ex} size="sm" onPress={() => applyExample(ex)} disabled={submitting || voice.listening} />
          ))}
        </ScrollView>
      </View>

      <View style={styles.divider} />

      <Text variant="label" tone="ink" style={styles.mealLabel} nativeID="composer-meal">
        Meal
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} style={styles.bleed} accessibilityRole="radiogroup">
        {(['auto', ...MEAL_TYPES] as ComposerMealType[]).map((t) => (
          <Chip
            key={t}
            role="radio"
            size="sm"
            label={t === 'auto' ? 'Auto' : MEAL_SINGULAR[t]}
            icon={t === 'auto' ? 'mci:auto-fix' : undefined}
            selected={mealType === t}
            onPress={() => onMealTypeChange(t)}
            accessibilityHint={t === 'auto' ? 'ÖRZA picks the meal from what you said or the time of day' : undefined}
          />
        ))}
      </ScrollView>

      {formError ? (
        <Animated.View entering={FadeIn.duration(180)} style={styles.formError} accessibilityLiveRegion="polite">
          <Icon name="alert-circle" size={15} color={colors.error} />
          <View style={styles.flex}>
            <Text variant="small" color={colors.errorInk}>
              {formError.message}
            </Text>
            {formError.code === 'no_credits' ? (
              <Pressable onPress={() => router.push('/credits')} accessibilityRole="link" hitSlop={8} style={styles.settingsLink}>
                <Text variant="small" weight="semibold" tone="energy">
                  Get more credits →
                </Text>
              </Pressable>
            ) : null}
          </View>
        </Animated.View>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={submitting ? 'Understanding…' : 'Log meal'}
          variant="energy"
          size="lg"
          block
          icon={submitting ? undefined : 'check'}
          loading={submitting}
          disabled={!text.trim() || voice.listening}
          onPress={submit}
          haptic="none"
        />
        <Button label="Add from food list" variant="secondary" block icon="list" onPress={onOpenFoodList} disabled={submitting} />
        {costHint ? (
          <Text variant="caption" tone="subtle" align="center">
            {costHint}
          </Text>
        ) : null}
      </View>
    </GlassCard>
  );
}

/* ───────────────────────────── Mic ───────────────────────────── */

function MicButton({ listening, disabled, onPress }: { listening: boolean; disabled?: boolean; onPress: () => void }) {
  const reduce = useReducedMotion();
  const pulse = useSharedValue(0);

  useEffect(() => {
    if (listening && !reduce) {
      pulse.set(0);
      pulse.set(withRepeat(withTiming(1, { duration: 1400, easing: Easing.out(Easing.quad) }), -1, false));
    } else {
      cancelAnimation(pulse);
      pulse.set(0);
    }
  }, [listening, reduce, pulse]);

  const ring = useAnimatedStyle(() => ({
    opacity: 0.45 * (1 - pulse.get()),
    transform: [{ scale: 1 + pulse.get() * 0.7 }],
  }));

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={listening ? 'Stop listening' : 'Speak your meal'}
      accessibilityState={{ selected: listening, disabled }}
      hitSlop={6}
      style={({ pressed }) => [styles.micWrap, (pressed || disabled) && styles.dim]}
    >
      {listening ? <Animated.View pointerEvents="none" style={[styles.micRing, ring]} /> : null}
      {listening ? (
        <LinearGradient colors={gradients.energy} start={diagonal.start} end={diagonal.end} style={[styles.mic, shadows.energy]}>
          <View style={styles.stopSquare} />
        </LinearGradient>
      ) : (
        <View style={[styles.mic, styles.micIdle]}>
          <Icon name="mic" size={20} color={colors.ink} />
        </View>
      )}
    </Pressable>
  );
}

function PulseDot() {
  const reduce = useReducedMotion();
  const v = useSharedValue(1);
  useEffect(() => {
    if (reduce) return;
    v.set(withRepeat(withTiming(0.35, { duration: 700 }), -1, true));
    return () => cancelAnimation(v);
  }, [reduce, v]);
  const style = useAnimatedStyle(() => ({ opacity: v.get() }));
  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  tile: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  headText: { flex: 1, gap: 4 },
  title: { marginTop: 2 },
  dayNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: 'rgba(135,87,242,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(135,87,242,0.2)',
  },
  field: { marginTop: spacing.lg },
  input: { minHeight: 108, maxHeight: 180, textAlignVertical: 'top', paddingTop: 14, paddingBottom: 14 },
  counter: { alignSelf: 'flex-end', marginTop: 4, marginRight: 4, fontSize: 10 },
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  langs: { flex: 1, maxWidth: 220 },
  status: { marginTop: spacing.sm, minHeight: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  settingsLink: { marginTop: 4, alignSelf: 'flex-start' },
  examples: { marginTop: spacing.lg, gap: spacing.sm },
  bleed: { marginHorizontal: -(spacing.lg + 2) },
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg + 2 },
  divider: { height: 1, backgroundColor: colors.divider, marginVertical: spacing.lg },
  mealLabel: { marginBottom: spacing.sm },
  formError: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.errorBg,
    borderWidth: 1,
    borderColor: 'rgba(176,44,44,0.18)',
  },
  actions: { marginTop: spacing.lg, gap: spacing.sm },
  micWrap: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  mic: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  micIdle: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairlineStrong, ...shadows.soft },
  micRing: { position: 'absolute', width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,122,106,0.45)' },
  stopSquare: { width: 14, height: 14, borderRadius: 3, backgroundColor: colors.white },
  dim: { opacity: 0.6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.coral, marginTop: 6 },
});
