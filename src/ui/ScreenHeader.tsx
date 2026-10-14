import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { gutter, spacing } from '@/theme';

import { IconButton } from './IconButton';
import { Text } from './Text';

export interface ScreenHeaderProps {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  /** Show a back button (pops the stack, or goes Home when there is nothing to pop). */
  back?: boolean;
  /** `close` shows an × (modals). */
  backIcon?: 'back' | 'close';
  right?: ReactNode;
  tone?: 'light' | 'hero';
  /** Large serif title (tab roots) vs compact (pushed screens). */
  large?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function goBackOrHome() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

/** In-page header: optional back / close, eyebrow, serif title, subtitle and a right-side accessory. */
export function ScreenHeader({ title, eyebrow, subtitle, back, backIcon = 'back', right, tone = 'light', large = true, style }: ScreenHeaderProps) {
  const hero = tone === 'hero';
  return (
    <View style={[styles.wrap, style]}>
      {back || right ? (
        <View style={styles.bar}>
          {back ? (
            <IconButton
              icon={backIcon === 'close' ? 'x' : 'arrow-left'}
              accessibilityLabel={backIcon === 'close' ? 'Close' : 'Go back'}
              onPress={goBackOrHome}
              variant={hero ? 'hero' : 'glass'}
              size={40}
            />
          ) : (
            <View />
          )}
          {right}
        </View>
      ) : null}
      {eyebrow ? (
        <Text variant="eyebrow" tone={hero ? 'heroSubtle' : 'subtle'} style={styles.eyebrow}>
          {eyebrow}
        </Text>
      ) : null}
      <Text variant={large ? 'h1' : 'h2'} tone={hero ? 'inverse' : 'ink'} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? (
        <Text variant="callout" tone={hero ? 'heroMuted' : 'muted'} style={styles.subtitle}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: spacing.md, paddingBottom: spacing.xl },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg, marginHorizontal: -gutter / 4 },
  eyebrow: { marginBottom: 6 },
  subtitle: { marginTop: 6 },
});
