/** Conversations list in a bottom sheet: new chat, switch, delete (with a native confirm). */
import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition, useReducedMotion } from 'react-native-reanimated';

import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, EmptyState, Icon, IconButton, PressableScale, Sheet, Skeleton, Text } from '@/ui';

import { sessionStamp } from './format';
import type { ChatSession } from './types';

export interface SessionsSheetProps {
  visible: boolean;
  onClose: () => void;
  sessions: ChatSession[] | undefined;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  activeId: string | null;
  memoryCount: number;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (s: ChatSession) => void;
  /** The sheet has finished closing (see Sheet `onClosed`). */
  onClosed?: () => void;
}

export function confirmDeleteSession(s: ChatSession, onConfirm: () => void) {
  haptics.warning();
  Alert.alert(
    'Delete this conversation?',
    `“${s.title || 'New chat'}” and its messages will be removed. Meals ÖRZA logged stay in your meal log.`,
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: onConfirm },
    ],
    { cancelable: true },
  );
}

export function SessionsSheet({ visible, onClose, sessions, loading, error, onRetry, activeId, memoryCount, onSelect, onNew, onDelete, onClosed }: SessionsSheetProps) {
  const reduce = useReducedMotion();

  let body;
  if (loading && !sessions) {
    body = (
      <View style={styles.skeletons} accessibilityLabel="Loading conversations">
        {[0, 1, 2, 3, 4].map((i) => (
          <View key={i} style={styles.skeletonRow}>
            <Skeleton width="72%" height={14} radius={7} />
            <Skeleton width="30%" height={10} radius={5} />
          </View>
        ))}
      </View>
    );
  } else if (error && !sessions?.length) {
    body = <EmptyState icon="wifi-off" title="Couldn't load your chats" body={error} actionLabel="Try again" onAction={onRetry} />;
  } else if (!sessions?.length) {
    body = (
      <EmptyState
        icon="mci:message-text-outline"
        title="No conversations yet"
        body="Say hello, or tell ÖRZA what you ate — your chats will appear here."
      />
    );
  } else {
    body = (
      <View style={styles.list} accessibilityLabel="Your conversations">
        {sessions.map((s, i) => {
          const active = s.id === activeId;
          const title = s.title || 'New chat';
          return (
            <Animated.View
              key={s.id}
              entering={reduce ? undefined : FadeInDown.delay(Math.min(i, 8) * 30).springify().damping(20).stiffness(100).mass(1)}
              layout={reduce ? undefined : LinearTransition.springify().damping(20).stiffness(100).mass(1)}
              style={[styles.row, active && styles.rowActive]}
            >
              <PressableScale
                onPress={() => onSelect(s.id)}
                haptic="select"
                scaleTo={0.98}
                style={styles.rowMain}
                accessibilityRole="button"
                accessibilityLabel={`${title}, ${sessionStamp(s.updated_at)}`}
                accessibilityState={{ selected: active }}
              >
                <View style={[styles.rowIcon, active && styles.rowIconActive]}>
                  <Icon name="message-square" size={15} color={active ? colors.white : colors.muted} />
                </View>
                <View style={styles.rowText}>
                  <Text variant="small" weight={active ? 'semibold' : 'medium'} numberOfLines={1}>
                    {title}
                  </Text>
                  <Text variant="mono" tone="subtle" style={styles.stamp}>
                    {sessionStamp(s.updated_at)}
                  </Text>
                </View>
              </PressableScale>
              <IconButton
                icon="trash-2"
                variant="plain"
                size={40}
                iconSize={16}
                color={colors.subtle}
                accessibilityLabel={`Delete conversation “${title}”`}
                onPress={() => onDelete(s)}
              />
            </Animated.View>
          );
        })}
      </View>
    );
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      onClosed={onClosed}
      eyebrow="Ask ÖRZA"
      title="Conversations"
      full
      footer={
        <Pressable
          onPress={() => {
            onClose();
            router.push('/account/memory');
          }}
          style={styles.memory}
          accessibilityRole="link"
          accessibilityHint="Opens what ÖRZA remembers, where you can see and edit it"
        >
          <Icon name="mci:bookmark-check" size={17} color={colors.violet600} />
          <Text variant="caption" tone="muted" style={styles.memoryText}>
            {memoryCount > 0 ? `ÖRZA remembers ${memoryCount} ${memoryCount === 1 ? 'thing' : 'things'} about you` : 'ÖRZA learns your preferences as you chat'}
          </Text>
          <Text variant="caption" weight="semibold">
            Manage
          </Text>
        </Pressable>
      }
    >
      <Button label="New chat" icon="edit" variant="primary" block onPress={onNew} />
      {body}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  skeletons: { gap: spacing.sm, marginTop: spacing.sm },
  skeletonRow: { gap: 8, paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  list: { gap: 4, marginTop: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: radii.md, borderWidth: 1, borderColor: colors.transparent, paddingRight: 2 },
  rowActive: { backgroundColor: colors.white, borderColor: colors.hairline, boxShadow: '0px 6px 18px rgba(20,20,20,0.06)' },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 10, paddingLeft: 10, minHeight: 56 },
  rowIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(20,20,20,0.05)' },
  rowIconActive: { backgroundColor: colors.ink },
  rowText: { flex: 1, gap: 2 },
  stamp: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 1 },
  memory: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44 },
  memoryText: { flex: 1 },
});
