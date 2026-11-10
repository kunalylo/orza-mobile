/**
 * Mounted once in the member layout (`app/(app)/_layout.tsx`): binds the signed-in member to the AI consent gate
 * (`./consent`) and renders the one sheet it opens. Another member (or a sign-out) answers an open question "no" and
 * forgets what the last one declined.
 */
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { useAuth } from '@/lib/auth';

import { AiConsentSheet } from './AiConsentSheet';
import { aiConsentSheetClosed, allowFromAiConsentSheet, bindAiConsentHost, declineAiConsentSheet, resetAiConsent, useAiConsentPrompt } from './consent';

/** iPhone: what follows the sheet (the camera, the gallery) waits this long after it has gone (one modal at a time). */
const AFTER_SHEET_MS = Platform.OS === 'ios' ? 300 : 0;

export function AiConsentHost() {
  const { user, refresh, setUser } = useAuth();
  const prompt = useAiConsentPrompt();
  const userRef = useRef(user);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => bindAiConsentHost({ user: () => userRef.current, refresh, setUser }), [refresh, setUser]);

  const id = user?.id ?? null;
  useEffect(() => () => resetAiConsent(), [id]);

  return (
    <AiConsentSheet
      visible={prompt.visible}
      context={prompt.feature}
      saving={prompt.saving}
      error={prompt.error}
      onAllow={() => void allowFromAiConsentSheet()}
      onNotNow={declineAiConsentSheet}
      onClosed={() => setTimeout(aiConsentSheetClosed, AFTER_SHEET_MS)}
    />
  );
}
