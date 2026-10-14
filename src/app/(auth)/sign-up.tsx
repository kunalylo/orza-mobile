import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { FormBanner } from '@/components/auth/FormBanner';
import { ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { WEB_URL } from '@/lib/config';
import { haptics } from '@/lib/haptics';
import { passwordStrength, validateEmail, validateName, validateNewPassword } from '@/lib/validation';
import { colors, spacing } from '@/theme';
import { Button, Screen, ScreenHeader, Text, TextField } from '@/ui';

type Field = 'name' | 'email' | 'password';

const STRENGTH = [
  { label: 'At least 8 characters', color: colors.subtle },
  { label: 'Okay', color: colors.warning },
  { label: 'Good', color: colors.cyan700 },
  { label: 'Strong', color: colors.success },
];

function StrengthMeter({ password }: { password: string }) {
  const s = passwordStrength(password);
  return (
    <View style={styles.meter} accessibilityLabel={`Password strength: ${STRENGTH[s].label}`}>
      <View style={styles.bars}>
        {[1, 2, 3].map((i) => (
          <View key={i} style={[styles.bar, { backgroundColor: s >= i ? STRENGTH[s].color : colors.track }]} />
        ))}
      </View>
      <Text variant="caption" color={STRENGTH[s].color}>
        {STRENGTH[s].label}
      </Text>
    </View>
  );
}

export default function SignUp() {
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string | null>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  function clear(field: Field) {
    if (errors[field]) setErrors((s) => ({ ...s, [field]: null }));
  }

  async function submit() {
    if (busy) return;
    const next = { name: validateName(name), email: validateEmail(email), password: validateNewPassword(password) };
    setErrors(next);
    setFormError(null);
    if (next.name || next.email || next.password) {
      haptics.error();
      return;
    }
    setBusy(true);
    try {
      await signUp(name, email, password);
      // Guard sends a new member to onboarding.
    } catch (e) {
      haptics.error();
      if (e instanceof ApiError && e.code === 'email_taken') setErrors({ email: e.message });
      else if (e instanceof ApiError && (e.field === 'name' || e.field === 'email' || e.field === 'password')) setErrors({ [e.field]: e.message });
      else setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const openLegal = (path: string) => {
    void WebBrowser.openBrowserAsync(`${WEB_URL}${path}`, { toolbarColor: colors.canvas, controlsColor: colors.ink }).catch(() => {});
  };

  return (
    <Screen keyboard backdrop="orb">
      <ScreenHeader back eyebrow="Start free" title="Create your account" subtitle="Two minutes to a plan that fits your food, your culture and your day." />

      <Animated.View entering={FadeInDown.delay(80).springify().damping(18)} style={styles.form}>
        <TextField
          label="Your name"
          icon="user"
          value={name}
          onChangeText={(t) => {
            setName(t);
            clear('name');
          }}
          error={errors.name}
          placeholder="e.g. Asha Kapoor"
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => emailRef.current?.focus()}
          maxLength={60}
        />
        <TextField
          ref={emailRef}
          label="Email"
          icon="mail"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            clear('email');
          }}
          error={errors.email}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
          maxLength={254}
        />
        <View>
          <TextField
            ref={passwordRef}
            label="Password"
            icon="lock"
            secure
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              clear('password');
            }}
            error={errors.password}
            placeholder="At least 8 characters"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={submit}
            maxLength={128}
          />
          {!errors.password && password.length > 0 ? <StrengthMeter password={password} /> : null}
        </View>
        <FormBanner message={formError} />
        <Button label="Create account" variant="energy" size="lg" block loading={busy} onPress={submit} iconRight="arrow-right" />
        <Text variant="caption" tone="subtle" align="center">
          By continuing you agree to ÖRZA&apos;s{' '}
          <Text variant="caption" tone="cyan" accessibilityRole="link" onPress={() => openLegal('/terms')}>
            Terms
          </Text>{' '}
          and{' '}
          <Text variant="caption" tone="cyan" accessibilityRole="link" onPress={() => openLegal('/privacy')}>
            Privacy Policy
          </Text>
          . ÖRZA offers wellness guidance, not medical advice.
        </Text>
      </Animated.View>

      <View style={styles.footer}>
        <Text variant="small" tone="muted">
          Already have an account?
        </Text>
        <Pressable accessibilityRole="link" hitSlop={10} onPress={() => router.replace('/sign-in')}>
          <Text variant="small" weight="semibold" tone="cyan">
            Sign in
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  meter: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, marginLeft: 4 },
  bars: { flexDirection: 'row', gap: 4 },
  bar: { width: 28, height: 4, borderRadius: 2 },
  footer: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.xxl },
});
