/**
 * Ask ÖRZA — chat with the coach (English, Hindi, Hinglish; text or voice). Conversations live in a bottom sheet;
 * `?session=<id>` opens one, `?q=<text>` pre-fills the composer. See src/features/chat.
 */
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Keyboard, Platform, StyleSheet, View, type ListRenderItem } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChatWelcome, QuickActionStrip } from '@/features/chat/ChatWelcome';
import { Composer } from '@/features/chat/Composer';
import { dayKey, dayLabel } from '@/features/chat/format';
import { AssistantBubble, DaySeparator, TypingIndicator, UserBubble } from '@/features/chat/MessageBubble';
import { SessionsSheet, confirmDeleteSession } from '@/features/chat/SessionsSheet';
import type { UIMessage } from '@/features/chat/types';
import { useConversation } from '@/features/chat/useConversation';
import { firstName } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { colors, gutter, spacing } from '@/theme';
import { EmptyState, Icon, IconButton, Orb, PressableScale, Screen, Skeleton, Text, goBackOrHome } from '@/ui';

type Row = { kind: 'msg'; key: string; message: UIMessage } | { kind: 'day'; key: string; label: string };

function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setVisible(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

function HistorySkeleton() {
  return (
    <View style={styles.skeleton} accessibilityLabel="Loading conversation">
      <Skeleton width="55%" height={46} radius={22} style={styles.right} />
      <Skeleton width="80%" height={112} radius={22} />
      <Skeleton width="42%" height={40} radius={22} style={styles.right} />
      <Skeleton width="68%" height={78} radius={22} />
    </View>
  );
}

export default function AskOrza() {
  const params = useLocalSearchParams<{ session?: string; q?: string }>();
  const chat = useConversation({
    initialSessionId: typeof params.session === 'string' && params.session ? params.session : undefined,
    initialDraft: typeof params.q === 'string' ? params.q : undefined,
  });
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const listRef = useRef<FlatList<Row>>(null);

  const { messages, historyState, showTyping, busy, activeId } = chat;
  const memoryCount = chat.user?.memory?.length ?? 0;
  const defaultVoiceLang = chat.user?.profile?.language === 'hi' ? 'hi-IN' : 'en-IN';

  // Oldest → newest with day separators, then reversed for the inverted list (newest at the bottom).
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    messages.forEach((m, i) => {
      const prev = messages[i - 1];
      if (!prev || dayKey(prev.created_at) !== dayKey(m.created_at)) out.push({ kind: 'day', key: `day-${m.id}`, label: dayLabel(m.created_at) });
      out.push({ kind: 'msg', key: m.id, message: m });
    });
    return out.reverse();
  }, [messages]);

  // A different conversation starts at its latest message.
  useEffect(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: false });
  }, [activeId]);

  const renderItem: ListRenderItem<Row> = ({ item }) => {
    if (item.kind === 'day') return <DaySeparator label={item.label} />;
    const m = item.message;
    return m.role === 'user' ? (
      <UserBubble message={m} onRetry={busy ? undefined : chat.retry} onGetCredits={() => router.push('/credits')} />
    ) : (
      <AssistantBubble message={m} />
    );
  };

  function newChat() {
    haptics.tap();
    setSheetOpen(false);
    setShowJump(false);
    chat.startNew();
    requestAnimationFrame(() => chat.inputRef.current?.focus());
  }

  const header = (
    <View style={styles.header}>
      <IconButton icon="arrow-left" accessibilityLabel="Go back" onPress={goBackOrHome} size={40} />
      <View style={styles.headerTitle}>
        <View style={styles.avatar}>
          <Orb size={58} tone="light" orbits={false} active={busy} style={styles.avatarOrb} />
        </View>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Text variant="title" accessibilityRole="header">
              Ask ÖRZA
            </Text>
            <View style={styles.online} />
          </View>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {chat.activeSession?.title || 'Your wellness companion'}
          </Text>
        </View>
      </View>
      <IconButton icon="message-square" accessibilityLabel="Your conversations" onPress={() => setSheetOpen(true)} size={40} />
      <IconButton icon="edit" accessibilityLabel="New chat" onPress={newChat} size={40} />
    </View>
  );

  let body;
  if (historyState === 'loading') {
    body = <HistorySkeleton />;
  } else if (historyState === 'error') {
    body = (
      <View style={styles.center}>
        <EmptyState
          icon="wifi-off"
          title="Couldn't load this conversation"
          body="Check your connection and try again — your messages are safe."
          actionLabel="Try again"
          onAction={chat.retryHistory}
        />
      </View>
    );
  } else if (!messages.length && !showTyping) {
    body = <ChatWelcome firstName={firstName(chat.user)} onPick={chat.pickStarter} onQuickAction={chat.runQuickAction} busy={busy} />;
  } else {
    body = (
      <View style={styles.flex}>
        <FlatList
          ref={listRef}
          inverted
          data={rows}
          keyExtractor={(r) => r.key}
          renderItem={renderItem}
          ListHeaderComponent={showTyping ? <TypingIndicator /> : null}
          ListFooterComponent={
            <Text variant="caption" tone="subtle" align="center" style={styles.note}>
              Wellness guidance, not medical advice. For medical concerns, please consult your doctor.
            </Text>
          }
          contentContainerStyle={styles.log}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          showsVerticalScrollIndicator={false}
          onScroll={(e) => {
            const away = e.nativeEvent.contentOffset.y > 320;
            if (away !== showJump) setShowJump(away);
          }}
          scrollEventThrottle={64}
          accessibilityLabel="Conversation with ÖRZA"
          initialNumToRender={14}
          maxToRenderPerBatch={10}
          windowSize={11}
        />
        {showJump ? (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} style={styles.jumpWrap} pointerEvents="box-none">
            <PressableScale
              onPress={() => {
                listRef.current?.scrollToOffset({ offset: 0, animated: true });
                setShowJump(false);
              }}
              haptic="soft"
              style={styles.jump}
              accessibilityRole="button"
              accessibilityLabel="Jump to the latest message"
            >
              <Icon name="arrow-down" size={14} />
              <Text variant="caption" weight="semibold">
                Latest
              </Text>
            </PressableScale>
          </Animated.View>
        ) : null}
      </View>
    );
  }

  const footer = (
    <View style={[styles.footer, { paddingBottom: keyboardVisible ? spacing.sm : Math.max(insets.bottom, spacing.md) }]}>
      {messages.length > 0 && historyState === 'idle' ? <QuickActionStrip onAction={chat.runQuickAction} busy={busy} /> : null}
      <Composer
        value={chat.input}
        onChange={chat.setInput}
        onSend={chat.sendInput}
        busy={busy}
        error={chat.composerError}
        defaultVoiceLang={defaultVoiceLang}
        inputRef={chat.inputRef}
      />
    </View>
  );

  return (
    <Screen backdrop="orb" scroll={false} keyboard padded={false} edges={['top']} header={header} footer={footer}>
      {body}
      <SessionsSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        sessions={chat.sessions}
        loading={chat.sessionsLoading}
        error={chat.sessionsError}
        onRetry={chat.refetchSessions}
        activeId={activeId}
        memoryCount={memoryCount}
        onSelect={(id) => {
          setSheetOpen(false);
          setShowJump(false);
          chat.openSession(id);
        }}
        onNew={newChat}
        onDelete={(s) => confirmDeleteSession(s, () => void chat.removeSession(s))}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: gutter - 4,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  headerTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 2 },
  avatar: { width: 40, height: 40, borderRadius: 20, overflow: 'hidden', backgroundColor: colors.white, borderWidth: 1, borderColor: colors.hairline },
  avatarOrb: { margin: -10 },
  headerText: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  online: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.success },
  skeleton: { flex: 1, gap: spacing.lg, paddingHorizontal: gutter, paddingTop: spacing.xl },
  right: { alignSelf: 'flex-end' },
  log: { paddingHorizontal: gutter, paddingTop: spacing.md, paddingBottom: spacing.lg },
  note: { marginBottom: spacing.lg, paddingHorizontal: spacing.lg },
  jumpWrap: { position: 'absolute', bottom: spacing.md, left: 0, right: 0, alignItems: 'center' },
  jump: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.glassSolid,
    borderWidth: 1,
    borderColor: colors.hairline,
    boxShadow: '0px 10px 30px rgba(20,20,20,0.12)',
  },
  footer: {
    paddingHorizontal: gutter - 4,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: 'rgba(251,247,241,0.94)',
  },
});
