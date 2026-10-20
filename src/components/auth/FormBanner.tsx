import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeOut } from 'react-native-reanimated';

import { colors, radii, spacing } from '@/theme';
import { Icon, Text } from '@/ui';

/** Inline form message (error or info) that springs in above the submit button. */
export function FormBanner({ message, tone = 'error' }: { message: string | null; tone?: 'error' | 'info' }) {
  if (!message) return null;
  const error = tone === 'error';
  return (
    <Animated.View
      entering={FadeInDown.springify().damping(18).stiffness(100).mass(1)}
      exiting={FadeOut.duration(150)}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
      style={[styles.banner, error ? styles.error : styles.info]}
    >
      <Icon name={error ? 'alert-circle' : 'info'} size={17} color={error ? colors.error : colors.cyan700} />
      <View style={styles.text}>
        <Text variant="small" color={error ? colors.errorInk : colors.cyan700}>
          {message}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: spacing.md, borderRadius: radii.md, borderWidth: 1 },
  error: { backgroundColor: colors.errorBg, borderColor: 'rgba(176,44,44,0.18)' },
  info: { backgroundColor: colors.cyan50, borderColor: 'rgba(11,143,166,0.2)' },
  text: { flex: 1 },
});
