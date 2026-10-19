/**
 * Root: fonts + splash, providers (gestures, safe area, auth/React Query, toasts) and the route guards:
 *   signed out                       → (auth)  welcome / sign-in / sign-up
 *   admin (staff) account            → admin   "use the web console"
 *   member, onboarding not finished  → onboarding
 *   member, onboarded                → (app)   tabs + feature screens
 * Guards are client-side routing only; the API enforces access on every request.
 */
import { DefaultTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/lib/auth';
import { useBrandFonts } from '@/lib/fonts';
import { installNotificationHandling } from '@/lib/notifications';
import { colors } from '@/theme';
import { Button, EmptyState, Screen, ToastHost } from '@/ui';

void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 320, fade: true });
// Foreground notification behaviour + the tap that launched the app, as early as possible (idempotent; the alarm
// adapters install it too). Medicine alarms and reminders are scheduled by the member area (`useAlarmSync`).
installNotificationHandling();

const navTheme: Theme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: colors.coral,
    background: colors.canvas,
    card: colors.canvas,
    text: colors.ink,
    border: colors.hairline,
    notification: colors.coral,
  },
};

export default function RootLayout() {
  const fontsReady = useBrandFonts();
  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <AuthProvider>
          <ThemeProvider value={navTheme}>
            <StatusBar style="dark" />
            {fontsReady ? <RootNavigator /> : null}
            <ToastHost />
          </ThemeProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { status, user, retry } = useAuth();
  const ready = status !== 'loading';

  useEffect(() => {
    if (ready) SplashScreen.hide();
  }, [ready]);

  if (!ready) return null;
  if (status === 'unreachable') {
    return (
      <Screen backdrop="orb" scroll={false} contentContainerStyle={styles.center}>
        <View>
          <EmptyState eyebrow="Offline" title="Can't reach ÖRZA" body="Check your internet connection, then try again. Your data is safe." />
          <Button label="Try again" icon="refresh-cw" onPress={retry} variant="primary" style={styles.retry} />
        </View>
      </Screen>
    );
  }

  const signedIn = status === 'signedIn' && !!user;
  const admin = signedIn && !!user?.is_admin;
  const member = signedIn && !admin;
  const onboarded = member && !!user?.onboarding_complete;

  return (
    <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: colors.canvas } }}>
      <Stack.Protected guard={onboarded}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={member && !onboarded}>
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
      </Stack.Protected>
      <Stack.Protected guard={admin}>
        <Stack.Screen name="admin" options={{ contentStyle: { backgroundColor: colors.hero } }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" options={{ contentStyle: { backgroundColor: colors.hero } }} />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  center: { justifyContent: 'center' },
  retry: { alignSelf: 'center', marginTop: -8 },
});
