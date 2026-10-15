/** The three ways to log / ask: Snap a meal, Type or speak, Ask ÖRZA. */
import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/theme';
import { Icon, PressableScale, Text, type IconName } from '@/ui';

type Action = { key: string; label: string; hint: string; icon: IconName; bg: string; fg: string; onPress: () => void };

export function QuickActions({ onSnap, onType, onAsk }: { onSnap: () => void; onType: () => void; onAsk: () => void }) {
  const actions: Action[] = [
    { key: 'snap', label: 'Snap a meal', hint: 'AI estimates calories & macros', icon: 'camera', bg: colors.energyBg, fg: colors.energyInk, onPress: onSnap },
    { key: 'type', label: 'Type or speak', hint: 'English, Hindi or Hinglish', icon: 'mic', bg: colors.cyan50, fg: colors.cyan700, onPress: onType },
    { key: 'ask', label: 'Ask ÖRZA', hint: 'Your wellness companion', icon: 'message-circle', bg: colors.violet50, fg: colors.violet600, onPress: onAsk },
  ];
  return (
    <View style={styles.row}>
      {actions.map((a) => (
        <PressableScale
          key={a.key}
          onPress={a.onPress}
          haptic="tap"
          accessibilityRole="button"
          accessibilityLabel={a.label}
          accessibilityHint={a.hint}
          style={styles.tile}
        >
          <View style={[styles.icon, { backgroundColor: a.bg }]}>
            <Icon name={a.icon} size={18} color={a.fg} />
          </View>
          <Text variant="label" tone="ink" numberOfLines={2} style={styles.label}>
            {a.label}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={2} style={styles.hint}>
            {a.hint}
          </Text>
        </PressableScale>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    minWidth: 0,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.glass,
    boxShadow: '0px 8px 22px rgba(20,20,20,0.05)',
  },
  icon: { width: 38, height: 38, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
  label: { marginTop: spacing.md },
  hint: { marginTop: 2, fontSize: 11.5, lineHeight: 15 },
});
