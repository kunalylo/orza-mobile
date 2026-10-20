/**
 * Settings → Change password: current + new + confirm (same rules as the web). Other devices are signed out; this
 * phone stays signed in. A wrong current password is shown on that field; an expired session signs out normally.
 */
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useRef, useState } from 'react';
import { Alert, StyleSheet, View, type TextInput } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { PasswordChangeError, useChangePassword } from '@/features/settings/api';
import { PASSWORD_MAX, PASSWORD_MIN } from '@/features/settings/options';
import { Note, TINTS } from '@/features/settings/parts';
import { useAuth, useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { colors, spacing } from '@/theme';
import { Button, GlassCard, Icon, Screen, ScreenHeader, Text, TextField, goBackOrHome, toast } from '@/ui';

type Field = 'current' | 'next' | 'confirm';
type Values = Record<Field, string>;
type Errors = Partial<Record<Field, string>>;

const EMPTY: Values = { current: '', next: '', confirm: '' };

function validate(v: Values): Errors {
  const e: Errors = {};
  if (!v.current) e.current = 'Enter your current password.';
  if (!v.next) e.next = 'Choose a new password.';
  else if (v.next.length < PASSWORD_MIN) e.next = `Use at least ${PASSWORD_MIN} characters.`;
  else if (v.next.length > PASSWORD_MAX) e.next = `Keep it to ${PASSWORD_MAX} characters or fewer.`;
  else if (v.current && v.next === v.current) e.next = "Pick a password that's different from your current one.";
  if (!v.confirm) e.confirm = 'Type the new password again.';
  else if (v.next && v.confirm !== v.next) e.confirm = "The passwords don't match.";
  return e;
}

export default function PasswordSettings() {
  const user = useSignedInUser();
  const { refresh } = useAuth();
  const navigation = useNavigation();
  const change = useChangePassword();

  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const currentRef = useRef<TextInput>(null);
  const nextRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);
  const focus = (f: Field) => (f === 'current' ? currentRef : f === 'next' ? nextRef : confirmRef).current?.focus();

  const saving = change.isPending;
  const dirty = values.current !== '' || values.next !== '' || values.confirm !== '';
  const longEnough = values.next.length >= PASSWORD_MIN;

  usePreventRemove(dirty && !done, ({ data }) => {
    if (saving) return;
    haptics.warning();
    Alert.alert('Discard changes?', "Your password hasn't been changed.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  const set = (f: Field) => (v: string) => {
    setValues((s) => ({ ...s, [f]: v }));
    setFormError(null);
    // Clear this field's error, and the confirm error once the two passwords line up again.
    setErrors((e) => {
      const next: Errors = { ...e, [f]: undefined };
      if (f === 'next' || f === 'confirm') next.confirm = undefined;
      return next;
    });
  };

  const submit = () => {
    if (saving) return;
    const errs = validate(values);
    setErrors(errs);
    setFormError(null);
    const first = (['current', 'next', 'confirm'] as Field[]).find((f) => errs[f]);
    if (first) {
      haptics.error();
      focus(first);
      return;
    }
    change.mutate(
      { current: values.current, next: values.next },
      {
        onSuccess: () => {
          haptics.success();
          setDone(true);
          setValues(EMPTY);
          toast.success("Password changed — you're still signed in here. Your other devices have been signed out.", 5000);
        },
        onError: (err) => {
          haptics.error();
          if (err instanceof PasswordChangeError && err.expired) {
            toast.error(err.message);
            void refresh(); // the server ended this session — let the normal sign-out run
            return;
          }
          const message = err instanceof Error && err.message ? err.message : "We couldn't change your password. Please try again.";
          const field = err instanceof PasswordChangeError ? err.field : undefined;
          if (field) {
            setErrors({ [field]: message });
            focus(field);
          } else {
            setFormError(message);
          }
        },
      }
    );
  };

  if (done) {
    return (
      <Screen backdrop="orb">
        <ScreenHeader back large={false} eyebrow="Security" title="Password changed" />
        <Animated.View entering={FadeInDown.springify().damping(16).stiffness(100).mass(1)}>
          <GlassCard tone="strong" glow padding={spacing.xl} style={styles.done}>
            <View style={styles.doneIcon}>
              <Icon name="check" size={28} color={colors.success} />
            </View>
            <Text variant="h3" align="center">
              You’re all set
            </Text>
            <Text variant="callout" tone="muted" align="center">
              You’re still signed in on this phone. Your other devices have been signed out — sign in there with your new password.
            </Text>
            <Button label="Done" variant="primary" block onPress={goBackOrHome} style={styles.doneBtn} />
          </GlassCard>
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen
      keyboard
      footer={
        <View style={styles.footer}>
          <View style={styles.footerRow}>
            {dirty ? (
              <Animated.View entering={FadeIn.duration(160)}>
                <Button
                  label="Clear"
                  variant="ghost"
                  disabled={saving}
                  haptic="soft"
                  onPress={() => {
                    setValues(EMPTY);
                    setErrors({});
                    setFormError(null);
                  }}
                />
              </Animated.View>
            ) : null}
            <Button label="Update password" variant="energy" icon="key" block loading={saving} disabled={!dirty} onPress={submit} style={styles.flex} />
          </View>
        </View>
      }
    >
      <ScreenHeader back large={false} eyebrow="Security" title="Change password" subtitle="Choose a new password for signing in to ÖRZA." />

      <Animated.View entering={FadeInDown.springify().damping(18).stiffness(100).mass(1)}>
        <GlassCard padding={spacing.lg} style={styles.card}>
          <TextField
            label="Email"
            value={user.email}
            editable={false}
            icon="mail"
            autoComplete="username"
            textContentType="username"
            accessibilityLabel={`Signed in as ${user.email}`}
          />
          <TextField
            ref={currentRef}
            label="Current password"
            value={values.current}
            onChangeText={set('current')}
            secure
            autoComplete="current-password"
            textContentType="password"
            placeholder="Enter your current password"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => focus('next')}
            error={errors.current}
          />
          <View>
            <TextField
              ref={nextRef}
              label="New password"
              value={values.next}
              onChangeText={set('next')}
              secure
              autoComplete="new-password"
              textContentType="newPassword"
              passwordRules={`minlength: ${PASSWORD_MIN};`}
              placeholder={`At least ${PASSWORD_MIN} characters`}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => focus('confirm')}
              error={errors.next}
            />
            {!errors.next ? (
              <View style={styles.rule} accessibilityLabel={`At least ${PASSWORD_MIN} characters${longEnough ? ', done' : ''}`}>
                <View style={!longEnough && styles.dim}>
                  <Icon name="check" size={13} color={longEnough ? colors.success : colors.subtle} />
                </View>
                <Text variant="caption" color={longEnough ? colors.success : colors.subtle}>
                  At least {PASSWORD_MIN} characters
                </Text>
              </View>
            ) : null}
          </View>
          <TextField
            ref={confirmRef}
            label="Confirm new password"
            value={values.confirm}
            onChangeText={set('confirm')}
            secure
            autoComplete="new-password"
            textContentType="newPassword"
            placeholder="Type it again"
            returnKeyType="done"
            onSubmitEditing={submit}
            error={errors.confirm}
          />
        </GlassCard>
      </Animated.View>

      {formError ? (
        <Animated.View entering={FadeIn.duration(180)} accessibilityLiveRegion="assertive" style={styles.formError}>
          <Note icon="alert-circle" tint={TINTS.danger}>
            <Text variant="small" color={colors.error}>
              {formError}
            </Text>
          </Note>
        </Animated.View>
      ) : null}

      <Note icon="smartphone" tint={TINTS.cyan} style={styles.note}>
        Changing your password signs you out on your other devices. You stay signed in here.
      </Note>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  card: { gap: spacing.lg },
  rule: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 7, marginLeft: 4 },
  dim: { opacity: 0.5 },
  formError: { marginTop: spacing.lg },
  note: { marginTop: spacing.lg },
  footer: {
    paddingHorizontal: 20,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: 'rgba(251,247,241,0.94)',
  },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  done: { alignItems: 'center', gap: spacing.md },
  doneIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.successBg },
  doneBtn: { marginTop: spacing.sm, alignSelf: 'stretch' },
});
