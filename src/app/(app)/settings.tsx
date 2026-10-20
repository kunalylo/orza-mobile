/**
 * Settings hub — account summary, then rows into each sub-page (profile, targets, preferences, memory, password,
 * your data) plus sign out / sign out of all devices. Port of the web's /dashboard/settings sections.
 */
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';

import { useAccountSync } from '@/features/settings/api';
import { DIET_OPTIONS, formatNumber, labelOf } from '@/features/settings/options';
import { Avatar, Note, SettingsGroup, SettingsRow, TINTS, initialOf } from '@/features/settings/parts';
import { useAuth, useSignedInUser } from '@/lib/auth';
import { APP_VERSION, WEB_URL } from '@/lib/config';
import { haptics } from '@/lib/haptics';
import type { PublicUser } from '@/lib/types';
import { colors, radii, spacing } from '@/theme';
import { GlassCard, Icon, Screen, ScreenHeader, Text, toast } from '@/ui';

function memberSince(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function profileSummary(user: PublicUser): string {
  const p = user.profile || {};
  const bits = [p.age ? `${p.age} yrs` : null, labelOf(DIET_OPTIONS, p.diet) || null, p.region || null].filter(Boolean);
  return bits.length ? bits.join(' · ') : 'Body, food, region and household';
}

function targetsSummary(user: PublicUser): string {
  const t = user.targets;
  if (!t) return 'Calories, macros, water and steps';
  return `${formatNumber(t.calories)} kcal · ${t.protein_g} g protein · ${t.water_glasses} glasses`;
}

function preferencesSummary(user: PublicUser): string {
  const p = user.preferences;
  if (!p) return 'Units, reminders, tone and privacy';
  return [p.units === 'imperial' ? 'Imperial' : 'Metric', p.tone === 'direct' ? 'Direct tone' : 'Gentle tone', p.reminders ? 'Reminders on' : 'Reminders off'].join(' · ');
}

function AccountSummary({ user }: { user: PublicUser }) {
  const since = memberSince(user.created_at);
  return (
    <GlassCard tone="strong" glow padding={spacing.lg} style={styles.summary}>
      <View style={styles.summaryTop}>
        <Avatar initial={initialOf(user.name, user.email)} size={56} />
        <View style={styles.flex}>
          <Text variant="h3" numberOfLines={1}>
            {user.name || 'You'}
          </Text>
          <Text variant="small" tone="muted" numberOfLines={1}>
            {user.email}
          </Text>
          {since ? (
            <Text variant="caption" tone="subtle">
              Member since {since}
            </Text>
          ) : null}
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${formatNumber(user.credits ?? 0)} AI credits. Open AI credits`}
        onPress={() => {
          haptics.tap();
          router.push('/credits');
        }}
        style={({ pressed }) => [styles.credits, pressed && styles.pressed]}
      >
        <Icon name="zap" size={14} color={colors.energyInk} />
        <Text variant="label" color={colors.energyInk}>
          {formatNumber(user.credits ?? 0)} AI credits
        </Text>
        <Icon name="arrow-up-right" size={14} color={colors.energyInk} />
      </Pressable>
    </GlassCard>
  );
}

export default function Settings() {
  const user = useSignedInUser();
  const { signOut } = useAuth();
  const sync = useAccountSync();
  const [refreshing, setRefreshing] = useState(false);
  const [signingOut, setSigningOut] = useState<'here' | 'everywhere' | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const onRefresh = async () => {
    setRefreshing(true);
    await sync.refetch();
    setRefreshing(false);
  };

  const memoryCount = user.memory?.length ?? 0;
  const memorySubtitle = sync.isSuccess
    ? memoryCount === 0
      ? 'Nothing yet — facts from your chats appear here'
      : `${memoryCount} ${memoryCount === 1 ? 'thing' : 'things'} ÖRZA keeps in mind`
    : 'Facts from your chats you can review';

  const signOutHere = () => {
    haptics.warning();
    Alert.alert(
      'Sign out of ÖRZA?',
      'Medicine alarms on this phone stop until you sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => {
            setSigningOut('here');
            void signOut();
          },
        },
      ],
      // Android: the back button (or a tap outside) dismisses it like Cancel.
      { cancelable: true }
    );
  };

  const signOutEverywhere = () => {
    haptics.warning();
    Alert.alert(
      'Sign out of all devices?',
      'This ends every ÖRZA session — every browser and phone, including this one.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out everywhere',
          style: 'destructive',
          onPress: async () => {
            setSignOutError(null);
            setSigningOut('everywhere');
            try {
              await signOut({ everywhere: true });
              toast.success('Signed out on every device');
            } catch (e) {
              haptics.error();
              const msg = e instanceof Error && e.message ? e.message : "We couldn't reach ÖRZA.";
              setSignOutError(`${msg} You're still signed in — try again when you're online.`);
              setSigningOut(null);
            }
          },
        },
      ],
      { cancelable: true }
    );
  };

  const openWeb = (path: string) => {
    haptics.tap();
    void WebBrowser.openBrowserAsync(`${WEB_URL}${path}`, { toolbarColor: colors.canvas, controlsColor: colors.energyInk }).catch(() =>
      toast.error("Couldn't open the page. Please try again.")
    );
  };

  return (
    <Screen
      backdrop="orb"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.coral} colors={[colors.coral]} />}
    >
      <ScreenHeader
        back
        eyebrow="Settings"
        title="Your settings"
        subtitle="Tune ÖRZA to your body, your food and your pace. Everything here is private to you."
      />

      <Animated.View entering={FadeInDown.springify().damping(18).stiffness(100).mass(1)}>
        <AccountSummary user={user} />
      </Animated.View>

      {sync.isError && !sync.isFetching ? (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} style={styles.offline}>
          <Note icon="wifi-off" tint={TINTS.cyan}>
            Showing what’s saved on this phone. Pull down to refresh when you’re back online.
          </Note>
        </Animated.View>
      ) : null}

      <SettingsGroup title="You" delay={70}>
        <SettingsRow icon="user" tint={TINTS.energy} title="Profile" subtitle={profileSummary(user)} onPress={() => router.push('/account/profile')} />
        <SettingsRow icon="target" tint={TINTS.energy} title="Daily targets" subtitle={targetsSummary(user)} onPress={() => router.push('/account/targets')} />
        <SettingsRow icon="sliders" tint={TINTS.violet} title="Preferences" subtitle={preferencesSummary(user)} onPress={() => router.push('/account/preferences')} last />
      </SettingsGroup>

      <SettingsGroup title="Coach memory" delay={130}>
        <SettingsRow icon="mci:brain" tint={TINTS.violet} title="What ÖRZA remembers" subtitle={memorySubtitle} onPress={() => router.push('/account/memory')} last />
      </SettingsGroup>

      <SettingsGroup title="Security" delay={190}>
        <SettingsRow icon="key" tint={TINTS.energy} title="Change password" subtitle="Your other devices are signed out; this one stays" onPress={() => router.push('/account/password')} last />
      </SettingsGroup>

      <SettingsGroup title="Privacy & data" delay={250} footer="Your data is stored securely. We never share personal health information without your consent.">
        <SettingsRow icon="download" tint={TINTS.cyan} title="Export my data" subtitle="Everything ÖRZA stores about you, as a JSON file" onPress={() => router.push('/account/data')} />
        <SettingsRow icon="shield" tint={TINTS.cyan} title="Privacy policy" chevron={false} trailing={<Icon name="arrow-up-right" size={16} color={colors.subtle} />} onPress={() => openWeb('/privacy')} />
        <SettingsRow icon="mci:shield-check-outline" tint={TINTS.cyan} title="Trust & safety" chevron={false} trailing={<Icon name="arrow-up-right" size={16} color={colors.subtle} />} onPress={() => openWeb('/trust')} />
        <SettingsRow
          icon="alert-triangle"
          tint={TINTS.danger}
          title="Delete account"
          subtitle="Permanently delete your account and all of your data"
          destructive
          onPress={() => router.push({ pathname: '/account/data', params: { confirm: 'delete' } })}
          last
        />
      </SettingsGroup>

      <SettingsGroup
        title="Session"
        delay={310}
        footer="Lost a phone or used a shared computer? “Sign out of all devices” ends every ÖRZA session, including this one."
      >
        <SettingsRow icon="log-out" title="Sign out" subtitle={`Signed in as ${user.email}`} chevron={false} loading={signingOut === 'here'} onPress={signOutHere} />
        <SettingsRow
          icon="mci:cellphone-link-off"
          title="Sign out of all devices"
          subtitle="Every browser and phone, including this one"
          chevron={false}
          loading={signingOut === 'everywhere'}
          onPress={signOutEverywhere}
          last
        />
      </SettingsGroup>

      {signOutError ? (
        <Animated.View entering={FadeIn.duration(180)} accessibilityLiveRegion="polite" style={styles.signOutError}>
          <Note icon="alert-circle" tint={TINTS.danger}>
            <Text variant="small" color={colors.error}>
              {signOutError}
            </Text>
          </Note>
        </Animated.View>
      ) : null}

      <Text variant="eyebrow" tone="subtle" align="center" style={styles.version}>
        ÖRZA · v{APP_VERSION}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  summary: { gap: spacing.md },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  credits: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: spacing.lg,
    paddingVertical: 9,
    borderRadius: radii.pill,
    backgroundColor: colors.energyBg,
    borderWidth: 1,
    borderColor: 'rgba(255,122,106,0.28)',
  },
  pressed: { opacity: 0.75 },
  offline: { marginTop: spacing.lg },
  signOutError: { marginTop: spacing.md },
  version: { marginTop: spacing.xxxl },
});
