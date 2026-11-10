/**
 * Mounted once in the member layout (`app/(app)/_layout.tsx`): binds the signed-in member to the AI consent gate
 * (`./consent`) and renders the one sheet it opens. Another member (or a sign-out) answers an open question "no" and
 * forgets what the last one declined.
 */
import { useEffect, useRef } from 'react';

import { useAuth } from '@/lib/auth';

import { AiConsentSheet } from './AiConsentSheet';
import { allowFromAiConsentSheet, bindAiConsentHost, declineAiConsentSheet, resetAiConsent, useAiConsentPrompt } from './consent';

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
    />
  );
}
