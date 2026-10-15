/** One reminder in the list: kind tile, title, schedule, channels + next time, and an on/off switch. Tap to edit. */
import { StyleSheet, View } from 'react-native';

import { colors, radii, spacing } from '@/theme';
import { PressableScale, Skeleton, Tag, Text } from '@/ui';

import { BrandSwitch, IconTile } from './parts';
import { describeNext, describeSchedule, KIND_ICON, KIND_LABEL, KIND_TONE } from './shared';
import type { ReminderView } from './types';

export function ReminderRow({
  reminder: r,
  tz,
  whatsapp,
  busy,
  onToggle,
  onEdit,
}: {
  reminder: ReminderView;
  tz: string;
  /** WhatsApp is configured for ÖRZA (otherwise its channel tag is hidden). */
  whatsapp: boolean;
  busy?: boolean;
  onToggle: (active: boolean) => void;
  onEdit: () => void;
}) {
  const next = r.active ? describeNext(r.next_at, tz) : '';
  const tone = KIND_TONE[r.kind];
  const schedule = describeSchedule(r.schedule);
  const state = !r.active ? 'Paused' : !r.next_at ? 'Schedule ended' : next ? `Next ${next}` : '';
  return (
    <View style={[styles.row, !r.active && styles.inactive]}>
      <PressableScale
        onPress={onEdit}
        haptic="tap"
        scaleTo={0.98}
        style={styles.main}
        accessibilityRole="button"
        accessibilityLabel={`${r.title}. ${KIND_LABEL[r.kind]} reminder, ${schedule}. ${state}`}
        accessibilityHint="Opens the reminder to edit it"
      >
        <IconTile icon={KIND_ICON[r.kind]} bg={tone.bg} fg={tone.fg} size={42} />
        <View style={styles.text}>
          <Text variant="title" numberOfLines={1}>
            {r.title}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {schedule}
          </Text>
          <View style={styles.tags}>
            {r.channels.push ? <Tag label="App" tone="energy" icon="smartphone" /> : null}
            {whatsapp && r.channels.whatsapp ? <Tag label="WhatsApp" tone="info" icon="message-circle" /> : null}
            {r.channels.calendar ? <Tag label="Calendar" tone="violet" icon="calendar" /> : null}
            {state ? (
              <Text variant="caption" tone={r.active && r.next_at ? 'subtle' : 'warning'} numberOfLines={1}>
                {state}
              </Text>
            ) : null}
          </View>
        </View>
      </PressableScale>
      <BrandSwitch value={r.active} onValueChange={onToggle} disabled={busy} accessibilityLabel={`${r.title} on`} />
    </View>
  );
}

export function ReminderRowSkeleton() {
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Skeleton width={42} height={42} radius={13} />
      <View style={[styles.text, styles.skelText]}>
        <Skeleton width="60%" height={16} />
        <Skeleton width="85%" height={12} />
        <Skeleton width="40%" height={18} radius={radii.pill} />
      </View>
      <Skeleton width={48} height={28} radius={radii.pill} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  inactive: { opacity: 0.62 },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, minWidth: 0 },
  text: { flex: 1, minWidth: 0, gap: 3 },
  skelText: { gap: 6 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 },
});
