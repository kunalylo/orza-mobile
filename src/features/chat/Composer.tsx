/**
 * Chat composer: auto-growing input, voice (en-IN / hi-IN via @/lib/voice — hidden when the device can't
 * recognise speech) that drops the transcript in for review, and the send button.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState, type Ref } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { loadVoiceLang, saveVoiceLang, useVoiceInput, type VoiceLang } from '@/lib/voice';
import { colors, diagonal, fonts, gradients, radii, spacing } from '@/theme';
import { Icon, PressableScale, Text, toast } from '@/ui';

import { formatNumber } from './format';

export const MAX_MESSAGE = 2000;

const VOICE_LABEL: Record<VoiceLang, { short: string; long: string }> = {
  'en-IN': { short: 'EN', long: 'English (India)' },
  'hi-IN': { short: 'हिंदी', long: 'Hindi' },
};

function ListeningDot() {
  const reduce = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    t.set(withRepeat(withTiming(1, { duration: 1100 }), -1, false));
  }, [reduce, t]);
  const halo = useAnimatedStyle(() => ({ opacity: 0.55 * (1 - t.get()), transform: [{ scale: 1 + t.get() * 1.6 }] }));
  return (
    <View style={styles.dotWrap}>
      <Animated.View style={[styles.dotHalo, halo]} />
      <View style={styles.dotCore} />
    </View>
  );
}

export interface ComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  /** Validation message from the server (400 field "message"). */
  error?: string | null;
  defaultVoiceLang?: VoiceLang;
  inputRef?: Ref<TextInput>;
}

export function Composer({ value, onChange, onSend, busy, error, defaultVoiceLang = 'en-IN', inputRef }: ComposerProps) {
  const [voiceLang, setVoiceLang] = useState<VoiceLang>(defaultVoiceLang);
  const [focused, setFocused] = useState(false);

  // The member's last voice language — shared with the meal composer and kept across launches.
  useEffect(() => {
    let alive = true;
    void loadVoiceLang().then((saved) => {
      if (alive && saved) setVoiceLang(saved);
    });
    return () => {
      alive = false;
    };
  }, []);
  const valueRef = useRef(value);
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  const voice = useVoiceInput({
    onFinal: (text) => {
      const cur = valueRef.current;
      const next = cur && !/\s$/.test(cur) ? `${cur} ${text}` : cur + text;
      onChange(next.slice(0, MAX_MESSAGE));
      haptics.soft();
    },
  });

  const lastError = useRef<string | null>(null);
  useEffect(() => {
    if (voice.error && voice.error !== lastError.current && !voice.blocked) toast.error(voice.error);
    lastError.current = voice.error;
  }, [voice.error, voice.blocked]);

  const canSend = !!value.trim() && !busy && value.length <= MAX_MESSAGE;
  const other: VoiceLang = voiceLang === 'en-IN' ? 'hi-IN' : 'en-IN';

  function toggleMic() {
    if (voice.listening) {
      haptics.tap();
      voice.stop();
    } else {
      haptics.firm();
      voice.start(voiceLang).catch(() => {});
    }
  }

  function switchLang() {
    if (voice.listening) voice.cancel();
    haptics.select();
    saveVoiceLang(other);
    setVoiceLang(other);
  }

  return (
    <View>
      {voice.listening ? (
        <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.listening} accessibilityLiveRegion="polite">
          <ListeningDot />
          <Text variant="caption" tone="muted">
            Listening · {VOICE_LABEL[voiceLang].long}
          </Text>
          {voice.partial ? (
            <Text variant="caption" tone="subtle" numberOfLines={1} style={styles.partial}>
              {voice.partial}
            </Text>
          ) : null}
        </Animated.View>
      ) : null}

      {voice.blocked ? (
        <Pressable onPress={() => Linking.openSettings().catch(() => {})} style={styles.blocked} accessibilityRole="button">
          <Icon name="mic-off" size={14} color={colors.warning} />
          <Text variant="caption" tone="warning" style={styles.flex}>
            Microphone access is off for ÖRZA.
          </Text>
          <Text variant="caption" weight="semibold" tone="cyan">
            Open Settings
          </Text>
        </Pressable>
      ) : null}

      <View style={[styles.field, focused && styles.fieldFocused, !!error && styles.fieldError]}>
        {voice.available ? (
          <Pressable
            onPress={toggleMic}
            disabled={busy && !voice.listening}
            style={[styles.mic, voice.listening && styles.micOn]}
            accessibilityRole="button"
            accessibilityLabel={voice.listening ? 'Stop listening' : `Speak your message (${VOICE_LABEL[voiceLang].long})`}
            accessibilityState={{ selected: voice.listening }}
            hitSlop={4}
          >
            <Icon name={voice.listening ? 'square' : 'mic'} size={voice.listening ? 15 : 19} color={voice.listening ? colors.white : colors.muted} />
          </Pressable>
        ) : null}

        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          multiline
          maxLength={MAX_MESSAGE}
          placeholder={voice.listening ? 'Listening…' : 'Aaj kya khaya? Ask me anything…'}
          placeholderTextColor={colors.subtle}
          style={[styles.input, !voice.available && styles.inputNoMic]}
          accessibilityLabel="Message ÖRZA"
          accessibilityHint="Type in English, Hindi or Hinglish"
          autoCorrect
          textAlignVertical="center"
          maxFontSizeMultiplier={1.5}
        />

        <PressableScale
          onPress={onSend}
          disabled={!canSend}
          haptic="firm"
          style={styles.sendWrap}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !canSend, busy }}
        >
          {canSend || busy ? (
            <LinearGradient colors={gradients.energy} {...diagonal} style={[styles.send, busy && styles.sendBusy]}>
              {busy ? <ActivityIndicator size="small" color={colors.white} /> : <Icon name="arrow-up" size={19} color={colors.white} />}
            </LinearGradient>
          ) : (
            <View style={[styles.send, styles.sendOff]}>
              <Icon name="arrow-up" size={19} color={colors.subtle} />
            </View>
          )}
        </PressableScale>
      </View>

      {error || voice.available || value.length > MAX_MESSAGE - 400 ? (
        <View style={styles.meta}>
          {error ? (
            <Text variant="caption" tone="error" style={styles.flex} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : (
            <View style={styles.flex} />
          )}
          {value.length > MAX_MESSAGE - 400 ? (
            <Text variant="mono" tone={value.length >= MAX_MESSAGE ? 'error' : 'subtle'} style={styles.count}>
              {formatNumber(value.length)}/{formatNumber(MAX_MESSAGE)}
            </Text>
          ) : null}
          {voice.available ? (
            <Pressable
              onPress={switchLang}
              style={styles.lang}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Voice language: ${VOICE_LABEL[voiceLang].long}. Switch to ${VOICE_LABEL[other].long}.`}
            >
              <Icon name="mic" size={11} color={colors.muted} />
              <Text variant="mono" tone="muted" style={styles.langText}>
                {VOICE_LABEL[voiceLang].short}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  listening: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: 4, marginBottom: spacing.sm },
  partial: { flex: 1, fontStyle: 'italic' },
  dotWrap: { width: 10, height: 10, alignItems: 'center', justifyContent: 'center' },
  dotHalo: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: colors.coral },
  dotCore: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.coral },
  blocked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: spacing.sm,
    borderRadius: radii.sm,
    backgroundColor: colors.warningBg,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    padding: 5,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    backgroundColor: 'rgba(255,255,255,0.92)',
    boxShadow: '0px 8px 24px rgba(20,20,20,0.07)',
  },
  fieldFocused: { borderColor: colors.cyan, boxShadow: '0px 0px 0px 3px rgba(11,190,220,0.16)' },
  fieldError: { borderColor: colors.error },
  mic: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  micOn: { backgroundColor: colors.coral, boxShadow: '0px 8px 22px rgba(255,122,106,0.40)' },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    paddingHorizontal: 6,
    paddingTop: 10,
    paddingBottom: 10,
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 21,
    color: colors.ink,
  },
  inputNoMic: { paddingLeft: 12 },
  sendWrap: { borderRadius: 20 },
  send: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sendBusy: { opacity: 0.85 },
  sendOff: { backgroundColor: 'rgba(20,20,20,0.07)' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: 6, marginTop: 6, minHeight: 20 },
  count: { fontSize: 10 },
  lang: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.glassStrong,
  },
  langText: { fontSize: 10, letterSpacing: 1 },
});
