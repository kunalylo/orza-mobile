/** Small inline states for the medicine screens: an error panel with retry (offline-aware) and a calm dashed note. */
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { ApiError, errorMessage } from '@/lib/api';
import { colors, fonts, radii, spacing } from '@/theme';
import { Button, Icon, Text } from '@/ui';

export function ErrorPanel({ error, onRetry, retrying, style }: { error: unknown; onRetry: () => void; retrying?: boolean; style?: StyleProp<ViewStyle> }) {
  const offline = error instanceof ApiError && error.isNetwork;
  return (
    <View style={[styles.error, style]} accessibilityRole="alert">
      <View style={styles.errorRow}>
        <Icon name={offline ? 'wifi-off' : 'alert-triangle'} size={18} color={colors.errorInk} />
        <Text variant="small" color={colors.errorInk} style={styles.flex}>
          {errorMessage(error)}
        </Text>
      </View>
      <Button label="Try again" icon="refresh-cw" variant="secondary" size="sm" onPress={onRetry} loading={retrying} style={styles.retry} />
    </View>
  );
}

export function DashedNote({ title, body, style }: { title?: string; body: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.note, style]}>
      {title ? (
        <Text variant="title" align="center" style={styles.noteTitle}>
          {title}
        </Text>
      ) : null}
      <Text variant="small" tone="muted" align="center">
        {body}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  error: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.errorBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(176,44,44,0.22)',
  },
  errorRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  retry: { alignSelf: 'flex-start' },
  note: {
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.glassSubtle,
  },
  noteTitle: { fontFamily: fonts.display, marginBottom: spacing.xs },
});
