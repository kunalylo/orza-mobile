/**
 * Root: fonts + splash, providers (gestures, safe area, auth/React Query, toasts) and the route guards:
 *   signed out                       → (auth)  welcome / sign-in / sign-up
 *   admin (staff) account            → admin   "use the web console"
 *   member, onboarding not finished  → onboarding
 *   member, onboarded                → (app)   tabs + feature screens
 * Guards are client-side routing only; the API enforces access on every request.
 * A development build without a valid EXPO_PUBLIC_API_URL shows "API URL not configured" instead (lib/config.ts).
 */
import { DefaultTheme, Stack, ThemeProvider, type Theme } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform, StyleSheet, Text as RNText, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from '@/lib/auth';
import { API_CONFIG_ERROR } from '@/lib/config';
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
  // A development build without a valid API URL must not run at all (it would otherwise talk to the wrong server).
  return API_CONFIG_ERROR ? <ApiUrlNotConfigured message={API_CONFIG_ERROR} /> : <App />;
}

/** Development builds only (see `lib/config.ts`): blocks the app until EXPO_PUBLIC_API_URL is set. */
function ApiUrlNotConfigured({ message }: { message: string }) {
  useEffect(() => {
    SplashScreen.hide();
    console.error(`[ÖRZA] API URL not configured: ${message}`);
  }, [message]);
  return (
    <View style={styles.configError} accessibilityRole="alert">
      <RNText style={styles.configTitle}>API URL not configured</RNText>
      <RNText style={styles.configBody}>{message}</RNText>
      <RNText style={styles.configBody}>
        Development builds never fall back to the live site. Create .env.local in the app folder — for the Android emulator and the
        local web test server (iOS simulator: http://localhost:3100):
      </RNText>
      <RNText style={styles.configCode}>EXPO_PUBLIC_API_URL=http://10.0.2.2:3100</RNText>
      <RNText style={styles.configBody}>then restart Metro with a cleared cache (npx expo start --dev-client --clear).</RNText>
    </View>
  );
}

function App() {
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
  configError: { flex: 1, justifyContent: 'center', padding: 24, gap: 12, backgroundColor: colors.canvas },
  configTitle: { fontSize: 22, fontWeight: '700', color: colors.error },
  configBody: { fontSize: 15, lineHeight: 21, color: colors.text },
  configCode: { fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), fontSize: 14, color: colors.ink, backgroundColor: colors.canvas2, padding: 10, borderRadius: 8 },
  center: { justifyContent: 'center' },
  retry: { alignSelf: 'center', marginTop: -8 },
});
