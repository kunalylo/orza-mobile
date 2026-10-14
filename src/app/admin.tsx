import * as WebBrowser from 'expo-web-browser';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { useSignedInUser, useAuth } from '@/lib/auth';
import { WEB_URL } from '@/lib/config';
import { colors, spacing } from '@/theme';
import { Button, GlassCard, Orb, Screen, Tag, Text, toast } from '@/ui';

/** Staff accounts never use the member app — they run the admin console on the web. */
export default function AdminNotice() {
  const user = useSignedInUser();
  const { signOut } = useAuth();
  const { height } = useWindowDimensions();
  const [busy, setBusy] = useState(false);

  const openConsole = () => {
    WebBrowser.openBrowserAsync(`${WEB_URL}/dashboard/admin`, { toolbarColor: colors.hero, controlsColor: colors.heroText }).catch(() =>
      toast.error("Couldn't open the browser. Visit the ÖRZA website on a computer.")
    );
  };

  return (
    <Screen backdrop="hero" contentContainerStyle={styles.content}>
      <StatusBar style="light" />
      <View style={styles.top}>
        <Orb size={Math.min(240, height * 0.3)} tone="dark" />
      </View>
      <Animated.View entering={FadeInDown.springify().damping(18)} style={styles.copy}>
        <Tag label={user.admin_role === 'super' ? 'Super admin' : 'Admin'} tone="hero" icon="shield" />
        <Text variant="h1" tone="inverse" accessibilityRole="header" style={styles.title}>
          Admins use the web console
        </Text>
        <Text variant="callout" tone="heroMuted">
          You&apos;re signed in as {user.email}. Staff accounts manage members, credits and the team from the ÖRZA admin console in a browser — the
          phone app is for members.
        </Text>
      </Animated.View>
      <GlassCard tone="dark" style={styles.card}>
        <Text variant="eyebrow" tone="heroSubtle">
          Console address
        </Text>
        <Text variant="title" tone="inverse" selectable style={styles.url}>
          {WEB_URL.replace(/^https?:\/\//, '')}/dashboard/admin
        </Text>
      </GlassCard>
      <View style={styles.actions}>
        <Button label="Open the web console" icon="external-link" variant="hero" size="lg" block onPress={openConsole} />
        <Button
          label="Sign out"
          icon="log-out"
          variant="heroOutline"
          size="lg"
          block
          loading={busy}
          onPress={async () => {
            setBusy(true);
            await signOut();
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { justifyContent: 'space-between' },
  top: { alignItems: 'center', marginTop: spacing.xl },
  copy: { gap: spacing.md, marginTop: spacing.xl },
  title: { marginTop: spacing.xs },
  card: { marginTop: spacing.xl, gap: 6 },
  url: { fontSize: 15 },
  actions: { gap: spacing.md, marginTop: spacing.xxl },
});
