/**
 * "Request more credits" — goes to the team from the signed-in account (POST /api/credits/request records the email and
 * balance server-side) and they top the account up. 429 `rate_limited` after 3 requests in 24 hours.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { formatNumber } from '@/features/goals/math';
import { ApiError, errorMessage } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, Icon, Sheet, Text, TextField, toast } from '@/ui';

import { useRequestCredits } from './api';
import { CREDIT_REQUEST_MESSAGE_MAX as MAX } from './options';

export function RequestCreditsSheet({ visible, onClose, email, credits }: { visible: boolean; onClose: () => void; email: string; credits: number }) {
  const send = useRequestCredits();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<string | null>(null);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setError(null);
      setFieldErr(null);
    }
  }

  const submit = () => {
    setError(null);
    setFieldErr(null);
    send.mutate(message.trim(), {
      onSuccess: () => {
        haptics.success();
        toast.success(`Request sent — thanks! We'll reply to ${email} soon.`, 5000);
        setMessage('');
        onClose();
      },
      onError: (e) => {
        haptics.error();
        if (e instanceof ApiError && e.status === 400 && /message/i.test(e.message)) setFieldErr(e.message.replace(/^message:\s*/i, ''));
        else setError(errorMessage(e));
      },
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={() => !send.isPending && onClose()}
      dismissible={!send.isPending}
      eyebrow="AI credits"
      title="Request more credits"
      footer={
        <View style={styles.footer}>
          <Button label="Cancel" variant="ghost" onPress={onClose} disabled={send.isPending} style={styles.flex} />
          <Button label="Send request" icon="send" variant="primary" loading={send.isPending} onPress={submit} style={styles.send} haptic="none" />
        </View>
      }
    >
      <Text variant="small" tone="muted">
        Need more credits? Tell us a little about how you use ÖRZA and we&apos;ll top up your account.
      </Text>

      <View style={styles.box}>
        <Icon name="mail" size={16} color={colors.muted} />
        <View style={styles.flex}>
          <Text variant="eyebrow" tone="subtle" style={styles.boxKey}>
            We&apos;ll reply to
          </Text>
          <Text variant="small" numberOfLines={1}>
            {email}
          </Text>
        </View>
        <View style={styles.balance}>
          <Text variant="eyebrow" tone="subtle" style={styles.boxKey}>
            Balance
          </Text>
          <Text variant="small" style={styles.tabular}>
            {formatNumber(credits)}
          </Text>
        </View>
      </View>

      <TextField
        label="Message (optional)"
        value={message}
        onChangeText={(t) => {
          setMessage(t.slice(0, MAX));
          if (fieldErr) setFieldErr(null);
        }}
        multiline
        maxLength={MAX}
        textAlignVertical="top"
        placeholder="e.g. I scan most of my meals and chat with ÖRZA daily — could I get more credits?"
        error={fieldErr}
        inputStyle={styles.textarea}
      />
      <View style={styles.hintRow}>
        <Text variant="caption" tone="subtle" style={styles.flex}>
          Your email and current balance are included automatically.
        </Text>
        <Text variant="caption" tone="subtle" style={styles.tabular}>
          {message.length}/{MAX}
        </Text>
      </View>

      {error ? (
        <View style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Icon name="alert-circle" size={14} color={colors.error} />
          <Text variant="small" tone="error" style={styles.flex}>
            {error}
          </Text>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footer: { flexDirection: 'row', gap: spacing.sm },
  send: { flex: 2 },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: 14,
    paddingVertical: spacing.md,
  },
  boxKey: { fontSize: 10 },
  balance: { alignItems: 'flex-end' },
  tabular: { fontVariant: ['tabular-nums'] },
  textarea: { minHeight: 120, maxHeight: 220, paddingTop: 14, paddingBottom: 14 },
  hintRow: { flexDirection: 'row', gap: spacing.md, marginTop: -spacing.xs },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, borderRadius: radii.xs, backgroundColor: colors.errorBg, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
