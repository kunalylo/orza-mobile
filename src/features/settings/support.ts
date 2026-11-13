/**
 * "Contact support": a new email to the team in the phone's mail app (App Review 1.5). No mail app (or no account in
 * it): a toast with the address, so the member can still write from anywhere.
 */
import { Linking } from 'react-native';

import { SUPPORT_EMAIL } from '@/lib/config';
import { toast } from '@/ui';

export async function contactSupport(subject = 'ÖRZA app'): Promise<void> {
  try {
    await Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`);
  } catch {
    toast.info(`Email us at ${SUPPORT_EMAIL}`, 6000);
  }
}
