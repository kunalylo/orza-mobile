import { Stack } from 'expo-router';

import { AlarmPermissionPrompt } from '@/features/alarms/AlarmPermissionPrompt';
import { useAlarmSync } from '@/lib/alarms/useAlarmSync';
import { useHealthAutoSync } from '@/lib/health/sync';
import { colors } from '@/theme';

export const unstable_settings = { initialRouteName: '(tabs)' };

/** Member area: the tabs plus pushed feature screens, the medicine form and the full-screen alarm. */
export default function AppLayout() {
  // Apple Health / Health Connect: sync on launch and on every return to the foreground (throttled inside;
  // skips admins and members who haven't connected).
  useHealthAutoSync();
  // Medicine alarms + reminders on this phone: plan, schedule and keep them current (offline, app killed, locked).
  useAlarmSync();

  return (
    <>
      <MemberStack />
      {/* "Let your medicine alarms ring" — after the first alarm medicine / a prescription, when a permission is missing. */}
      <AlarmPermissionPrompt />
    </>
  );
}

function MemberStack() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
      {/*
        The add / edit medicine form slides up as a modal. Full screen rather than an iOS page sheet so the shared
        Screen's safe-area and keyboard handling stay exact, and so it can open on top of the alarm ("Add a photo") —
        an ordinary push from a modal would land underneath it on iOS. Its unsaved-changes guard still applies.
      */}
      <Stack.Screen name="med/edit" options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom' }} />
      <Stack.Screen
        name="alarm"
        options={{ presentation: 'fullScreenModal', animation: 'slide_from_bottom', gestureEnabled: false, contentStyle: { backgroundColor: colors.hero } }}
      />
    </Stack>
  );
}
