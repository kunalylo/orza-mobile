/**
 * Settings › Privacy & data › "AI features" (`docs/notes/ai-consent.md` §3.5): the row shows the account's AI consent;
 * tapping it opens a sheet with the status, what is sent to OpenAI, the privacy link and one button.
 * - On: "Turn off AI features" → a confirm in the footer → `DELETE /api/settings/ai-consent` → a toast. The server then
 *   refuses the app's AI requests and keeps the phone's health data out of AI prompts; steps, logs, chats and plans stay.
 * - Off: "Allow AI features" — the consent sheet's Allow (the same points are on screen), `PUT`.
 * - An old server: no button, the unavailable line.
 */
import { useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { TINTS, SettingsRow } from '@/features/settings/parts';
import { AI_TOASTS, AI_TURN_OFF, AI_UNAVAILABLE, ALLOW_AI_LABEL, aiConsentState, aiSettingsSubtitle, aiStatusLine, consentCopy } from '@/lib/aiConsent';
import { useAuth, useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, Sheet, Text, toast } from '@/ui';

import { CONSENT_PLATFORM, ConsentError, ConsentPoints } from './AiConsentSheet';
import { allowAiConsent, consentSaveError, withdrawAiConsent } from './api';
import { clearAiDeclines } from './consent';

/** "Keep on" / "Turn off" at font scale 1 (label + padding), dp: below that the footer wraps instead of cutting a label. */
const FOOTER_BUTTON_MIN_WIDTH = 132;

export function AiFeaturesRow() {
  const user = useSignedInUser();
  const { setUser } = useAuth();
  const { fontScale } = useWindowDimensions();
  const state = aiConsentState(user);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = consentCopy('settings', CONSENT_PLATFORM);
  const status = aiStatusLine(user);
  const on = state === 'allowed';

  const allow = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { user: next } = await allowAiConsent();
      setUser(next, { aiConsent: true });
      clearAiDeclines();
      haptics.success();
      toast.success(AI_TOASTS.on);
      setOpen(false);
    } catch (e) {
      haptics.error();
      setError(consentSaveError(e));
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const { user: next } = await withdrawAiConsent();
      setUser(next, { aiConsent: true });
      haptics.success();
      toast.info(AI_TOASTS.off);
      setOpen(false);
    } catch (e) {
      haptics.error();
      setError(consentSaveError(e));
    } finally {
      setBusy(false);
    }
  };

  const half = [styles.half, { minWidth: FOOTER_BUTTON_MIN_WIDTH * fontScale }];
  let footer = null;
  if (state === 'ask') {
    footer = (
      <View style={styles.footer}>
        <ConsentError message={error} />
        <Button label={ALLOW_AI_LABEL} icon="check" variant="energy" size="lg" block loading={busy} haptic="firm" onPress={() => void allow()} />
      </View>
    );
  } else if (on && !confirming) {
    footer = (
      <View style={styles.footer}>
        <ConsentError message={error} />
        <Button
          label={AI_TURN_OFF.button}
          icon="power"
          variant="secondary"
          block
          onPress={() => {
            haptics.warning();
            setError(null);
            setConfirming(true);
          }}
        />
      </View>
    );
  } else if (on) {
    footer = (
      <View style={styles.footer}>
        <View style={styles.confirm} accessibilityLiveRegion="polite">
          <Text variant="label" tone="ink" accessibilityRole="header">
            {AI_TURN_OFF.title}
          </Text>
          <Text variant="small" tone="text">
            {AI_TURN_OFF.body}
          </Text>
        </View>
        <ConsentError message={error} />
        <View style={styles.row}>
          <Button label={AI_TURN_OFF.cancel} variant="ghost" onPress={() => setConfirming(false)} disabled={busy} style={half} />
          <Button label={AI_TURN_OFF.confirm} variant="danger" onPress={() => void turnOff()} loading={busy} style={half} />
        </View>
      </View>
    );
  }

  return (
    <>
      <SettingsRow
        icon="mci:creation"
        tint={TINTS.violet}
        title="AI features"
        subtitle={aiSettingsSubtitle(state)}
        accessibilityHint="Shows what ÖRZA’s AI features send to OpenAI, and turns them on or off"
        onPress={() => setOpen(true)}
      />
      <Sheet
        visible={open}
        onClose={() => setOpen(false)}
        onClosed={() => {
          setConfirming(false);
          setError(null);
        }}
        dismissible={!busy}
        eyebrow="Privacy & data"
        title="AI features"
        footer={footer}
      >
        <View style={styles.body}>
          <View style={[styles.status, on ? styles.statusOn : styles.statusOff]}>
            <View style={[styles.dot, on ? styles.dotOn : styles.dotOff]} />
            <Text variant="label" color={on ? colors.success : colors.muted} style={styles.statusText}>
              {status ?? AI_UNAVAILABLE}
            </Text>
          </View>
          <ConsentPoints copy={copy} />
        </View>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.lg },
  // Shrink (and wrap) only: `flex: 1` stretched the pill across the sheet, where it read as an empty input field.
  statusText: { flexShrink: 1 },
  status: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, alignSelf: 'flex-start', paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radii.pill },
  statusOn: { backgroundColor: colors.successBg },
  statusOff: { backgroundColor: colors.canvas2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { backgroundColor: colors.success },
  dotOff: { backgroundColor: colors.subtle },
  footer: { gap: spacing.sm },
  confirm: { gap: spacing.xs },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  // flexBasis 0 + a font-scaled minWidth: the row wraps on the minWidth, then each line shares its width equally.
  half: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
});
