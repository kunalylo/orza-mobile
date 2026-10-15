/**
 * More tab — the account header (avatar, name, credit balance) and a grouped menu of everything that isn't a tab:
 * Coach · Progress · Care · Account. Pull to refresh re-reads the user (credits, name).
 * Entering animations follow the system Reduce Motion setting (Reanimated's default `ReduceMotion.System`).
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { AccountCard } from '@/features/more/AccountCard';
import { MENU } from '@/features/more/menu';
import { SettingsGroup, SettingsRow } from '@/features/settings/parts';
import { firstName, useAuth, useSignedInUser } from '@/lib/auth';
import { APP_VERSION } from '@/lib/config';
import { colors, spacing } from '@/theme';
import { Screen, ScreenHeader, Text, toast } from '@/ui';

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return 'Up late';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function More() {
  const user = useSignedInUser();
  const { refresh } = useAuth();
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refresh();
    } catch {
      toast.error("Couldn't refresh — check your connection.");
    } finally {
      setRefreshing(false);
    }
  };

  const name = firstName(user);

  return (
    <Screen
      backdrop="orb"
      tabBar
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.coral} colors={[colors.coral]} />}
    >
      <ScreenHeader eyebrow={name ? `${greeting()}, ${name}` : 'ÖRZA'} title="More" />

      <Animated.View entering={FadeInDown.springify().damping(18)}>
        <AccountCard user={user} />
      </Animated.View>

      {MENU.map((section, si) => (
        <SettingsGroup key={section.title} title={section.title} delay={80 + si * 60}>
          {section.items.map((item, i) => (
            <SettingsRow
              key={item.key}
              icon={item.icon}
              tint={item.tint}
              title={item.title}
              subtitle={item.subtitle}
              last={i === section.items.length - 1}
              onPress={() => router.push(item.href)}
            />
          ))}
        </SettingsGroup>
      ))}

      <View style={styles.footer}>
        <Text variant="eyebrow" tone="subtle" align="center">
          ÖRZA · v{APP_VERSION}
        </Text>
        <Text variant="caption" tone="subtle" align="center">
          Wellness guidance, not medical advice.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  footer: { marginTop: spacing.xxxl, gap: spacing.xs, alignItems: 'center' },
});
