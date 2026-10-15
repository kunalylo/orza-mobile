/** "Notifications on this phone" — permission status with a one-tap enable (or Settings when blocked). */
import { StyleSheet, View } from 'react-native';

import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, Skeleton, Tag, Text } from '@/ui';

import type { NotificationPermission } from './notifications';
import { CardHeader } from './parts';

const STATUS: Record<NotificationPermission, { label: string; tone: 'success' | 'warning' | 'neutral' | 'error' }> = {
  granted: { label: 'On', tone: 'success' },
  undetermined: { label: 'Not set', tone: 'neutral' },
  denied: { label: 'Off', tone: 'warning' },
  blocked: { label: 'Blocked', tone: 'error' },
  unsupported: { label: 'Unavailable', tone: 'neutral' },
};

export function NotificationsCard({
  status,
  asking,
  onEnable,
  browserCount,
}: {
  status: NotificationPermission | null;
  asking: boolean;
  onEnable: () => void;
  /** Browsers with ÖRZA web notifications on (GET /api/integrations → push.subscriptions). */
  browserCount: number;
}) {
  const meta = status ? STATUS[status] : null;
  return (
    <GlassCard padding={spacing.lg}>
      <CardHeader
        icon="mci:bell-ring-outline"
        tone="energy"
        eyebrow="This phone"
        title="Notifications"
        right={meta ? <Tag label={meta.label} tone={meta.tone} dot /> : <Skeleton width={56} height={22} radius={radii.pill} />}
      />

      {status === null ? (
        <View style={styles.skel}>
          <Skeleton width="92%" height={12} />
          <Skeleton width="70%" height={12} />
        </View>
      ) : status === 'granted' ? (
        <Text variant="small" tone="muted" style={styles.body}>
          ÖRZA can show notifications on this phone. Your reminders and medicine alarms currently arrive from ÖRZA&apos;s server, so they
          can come up to a minute after their time.
        </Text>
      ) : status === 'unsupported' ? (
        <Text variant="small" tone="muted" style={styles.body}>
          Notifications aren&apos;t available here. Reminders still reach you on your other devices and in your calendar.
        </Text>
      ) : (
        <>
          <Text variant="small" tone="muted" style={styles.body}>
            {status === 'blocked'
              ? 'Notifications are turned off for ÖRZA. Turn them on in Settings so reminders and medicine alarms can reach this phone.'
              : 'Allow notifications so reminders and medicine alarms can reach this phone. Reminders currently arrive from ÖRZA’s server.'}
          </Text>
          <Button
            label={status === 'blocked' ? 'Open Settings' : 'Turn on notifications'}
            icon={status === 'blocked' ? 'settings' : 'bell'}
            variant="energy"
            loading={asking}
            onPress={() => {
              haptics.firm();
              onEnable();
            }}
            style={styles.cta}
          />
        </>
      )}

      {browserCount > 0 ? (
        <View style={styles.note}>
          <Icon name="monitor" size={14} color={colors.subtle} />
          <Text variant="caption" tone="subtle" style={styles.flex}>
            Web notifications are also on in {browserCount} browser{browserCount === 1 ? '' : 's'}.
          </Text>
        </View>
      ) : null}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { marginTop: spacing.md },
  skel: { marginTop: spacing.md, gap: 8 },
  cta: { marginTop: spacing.lg, alignSelf: 'flex-start' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
});
