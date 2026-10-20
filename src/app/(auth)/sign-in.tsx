import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View, type TextInput } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { FormBanner } from '@/components/auth/FormBanner';
import { ApiError, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { validateEmail, validatePassword } from '@/lib/validation';
import { spacing } from '@/theme';
import { Button, Screen, ScreenHeader, Text, TextField } from '@/ui';

export default function SignIn() {
  const { signIn, sessionExpired, acknowledgeExpired } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string | null; password?: string | null }>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<TextInput>(null);
  const [notice] = useState(sessionExpired ? 'Your session ended. Please sign in again.' : null);

  useEffect(() => {
    if (sessionExpired) acknowledgeExpired();
  }, [sessionExpired, acknowledgeExpired]);

  async function submit() {
    if (busy) return;
    const next = { email: validateEmail(email), password: validatePassword(password) };
    setErrors(next);
    setFormError(null);
    if (next.email || next.password) {
      haptics.error();
      return;
    }
    setBusy(true);
    try {
      await signIn(email, password);
      // The route guard takes over (onboarding or tabs).
    } catch (e) {
      haptics.error();
      if (e instanceof ApiError && e.field === 'email') setErrors({ email: e.message });
      else if (e instanceof ApiError && e.field === 'password') setErrors({ password: e.message });
      else setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen keyboard backdrop="orb">
      <ScreenHeader back eyebrow="Welcome back" title="Sign in to ÖRZA" subtitle="Pick up right where you left off — meals, medicines and all." />

      <Animated.View entering={FadeInDown.delay(80).springify().damping(18).stiffness(100).mass(1)} style={styles.form}>
        <FormBanner message={notice} tone="info" />
        <TextField
          label="Email"
          icon="mail"
          value={email}
          onChangeText={(t) => {
            setEmail(t);
            if (errors.email) setErrors((s) => ({ ...s, email: null }));
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
        <TextField
          ref={passwordRef}
          label="Password"
          icon="lock"
          secure
          value={password}
          onChangeText={(t) => {
            setPassword(t);
            if (errors.password) setErrors((s) => ({ ...s, password: null }));
          }}
          error={errors.password}
          placeholder="Your password"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={submit}
          maxLength={128}
        />
        <FormBanner message={formError} />
        <Button label="Sign in" variant="energy" size="lg" block loading={busy} onPress={submit} iconRight="arrow-right" />
      </Animated.View>

      <View style={styles.footer}>
        <Text variant="small" tone="muted">
          New to ÖRZA?
        </Text>
        <Pressable accessibilityRole="link" hitSlop={10} onPress={() => router.replace('/sign-up')}>
          <Text variant="small" weight="semibold" tone="cyan">
            Create an account
          </Text>
        </Pressable>
      </View>
      <Text variant="caption" tone="subtle" align="center" style={styles.help}>
        Forgot your password? Contact ÖRZA support and we&apos;ll help you reset it.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.lg },
  footer: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: spacing.xxl },
  help: { marginTop: spacing.md, paddingHorizontal: spacing.lg },
});
