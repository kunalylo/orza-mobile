/**
 * Settings → "What ÖRZA remembers": the short facts the coach keeps from your chats. View, add, forget one (with
 * Undo) or forget everything. Editing waits for a fresh copy from the server — the saved phone snapshot leaves memory
 * out, and PUT /api/settings/memory replaces the whole list.
 */
import { useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';

import { useAccountSync, useSaveMemory } from '@/features/settings/api';
import { MEMORY_MAX_ITEMS, MEMORY_MAX_LENGTH } from '@/features/settings/options';
import { Note, TINTS } from '@/features/settings/parts';
import { useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { colors, radii, spacing } from '@/theme';
import { Button, EmptyState, GlassCard, Icon, IconButton, ProgressBar, Screen, ScreenHeader, Skeleton, Text, TextField, toast, useLayoutTransition } from '@/ui';

interface UndoState {
  message: string;
  previous: string[];
}

function LoadingList() {
  return (
    <GlassCard padding={spacing.lg} style={styles.skeleton} accessibilityLabel="Loading what ÖRZA remembers">
      {[0.9, 0.7, 0.8].map((w, i) => (
        <View key={i} style={styles.skeletonRow}>
          <Skeleton circle width={8} height={8} />
          <Skeleton width={`${w * 100}%`} height={14} />
        </View>
      ))}
    </GlassCard>
  );
}

export default function MemorySettings() {
  const layoutTransition = useLayoutTransition();
  const user = useSignedInUser();
  const sync = useAccountSync();
  const saveMemory = useSaveMemory();

  const memory = user.memory || [];
  const ready = sync.isSuccess;
  const busy = saveMemory.isPending;
  const full = memory.length >= MEMORY_MAX_ITEMS;

  const [adding, setAdding] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 6000);
    return () => clearTimeout(t);
  }, [undo]);

  const save = async (next: string[]): Promise<boolean> => {
    try {
      await saveMemory.mutateAsync(next);
      return true;
    } catch (e) {
      haptics.error();
      toast.error(e instanceof Error && e.message ? e.message : "We couldn't update ÖRZA's memory. Please try again.");
      return false;
    }
  };

  const add = async () => {
    const fact = adding.replace(/\s+/g, ' ').trim();
    if (!fact || busy) return;
    if (fact.length > MEMORY_MAX_LENGTH) return setAddError(`Keep it under ${MEMORY_MAX_LENGTH} characters`);
    if (memory.some((m) => m.toLowerCase() === fact.toLowerCase())) return setAddError('ÖRZA already remembers that');
    if (full) return setAddError(`ÖRZA can remember up to ${MEMORY_MAX_ITEMS} things — forget one first`);
    setAddError(null);
    if (await save([...memory, fact])) {
      haptics.success();
      setAdding('');
      toast.success('ÖRZA will remember that');
    }
  };

  const forget = async (index: number) => {
    if (busy) return;
    const previous = memory;
    haptics.soft();
    if (await save(memory.filter((_, i) => i !== index))) setUndo({ message: 'Forgotten', previous });
  };

  const forgetEverything = () => {
    haptics.warning();
    Alert.alert('Forget everything?', 'ÖRZA will clear every note it keeps about you. Your meals, goals and history stay as they are.', [
      { text: 'Keep them', style: 'cancel' },
      {
        text: 'Forget everything',
        style: 'destructive',
        onPress: async () => {
          const previous = memory;
          if (await save([])) {
            haptics.success();
            setUndo({ message: "ÖRZA's memory is cleared", previous });
          }
        },
      },
    ]);
  };

  const restore = async () => {
    if (!undo || busy) return;
    const previous = undo.previous;
    setUndo(null);
    if (await save(previous)) {
      haptics.success();
      toast.success('Restored');
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await sync.refetch();
    setRefreshing(false);
  };

  return (
    <Screen
      keyboard
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.coral} colors={[colors.coral]} />}
    >
      <ScreenHeader
        back
        large={false}
        eyebrow="Memory"
        title="What ÖRZA remembers"
        subtitle="As you chat, ÖRZA keeps short notes — like your diet, routine or favourite foods — so its advice fits your life. You're in control: remove anything, any time."
      />

      {!ready && sync.isError ? (
        <Animated.View entering={FadeIn.duration(200)}>
          <EmptyState
            icon="wifi-off"
            title="Couldn't load ÖRZA's memory"
            body={`${sync.error instanceof Error && sync.error.message ? sync.error.message : 'Check your connection.'} Your notes are safe — try again in a moment.`}
            actionLabel="Try again"
            onAction={() => void sync.refetch()}
            actionVariant="secondary"
          />
        </Animated.View>
      ) : !ready ? (
        <LoadingList />
      ) : (
        <>
          <Animated.View entering={FadeInDown.springify().damping(18).stiffness(100).mass(1)}>
            <GlassCard tone="strong" padding={spacing.lg} style={styles.meter}>
              <View style={styles.meterHead}>
                <View style={styles.meterIcon}>
                  <Icon name="mci:brain" size={20} color={colors.violet600} />
                </View>
                <View style={styles.flex}>
                  <Text variant="title">
                    {memory.length}/{MEMORY_MAX_ITEMS} saved
                  </Text>
                  <Text variant="caption" tone="muted">
                    {full ? 'Memory is full — forget something to add more.' : 'Short facts ÖRZA keeps in mind when it helps you.'}
                  </Text>
                </View>
              </View>
              <ProgressBar value={memory.length / MEMORY_MAX_ITEMS} accessibilityLabel={`${memory.length} of ${MEMORY_MAX_ITEMS} notes saved`} />
            </GlassCard>
          </Animated.View>

          {undo ? (
            <Animated.View key={`${undo.message}-${undo.previous.length}`} entering={FadeInDown.springify().damping(16).stiffness(100).mass(1)} exiting={FadeOut.duration(180)} style={styles.undo} accessibilityLiveRegion="polite">
              <Icon name="check-circle" size={16} color={colors.success} />
              <Text variant="label" tone="ink" style={styles.flex}>
                {undo.message}
              </Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Undo" onPress={() => void restore()} hitSlop={8} style={({ pressed }) => [styles.undoBtn, pressed && styles.pressed]}>
                <Icon name="rotate-ccw" size={14} color={colors.energyInk} />
                <Text variant="label" tone="energy">
                  Undo
                </Text>
              </Pressable>
            </Animated.View>
          ) : null}

          {memory.length === 0 ? (
            <Animated.View entering={FadeIn.duration(220)} style={styles.empty}>
              <EmptyState
                icon="mci:brain"
                title="Nothing saved yet"
                body="Chat with ÖRZA and it will note helpful details here. You can also add something yourself below."
              />
            </Animated.View>
          ) : (
            <GlassCard padding={0} style={styles.list} accessibilityLabel="Things ÖRZA remembers">
              {memory.map((fact, i) => (
                <Animated.View
                  key={`${fact}-${i}`}
                  entering={FadeInDown.delay(Math.min(i, 8) * 30).springify().damping(18).stiffness(100).mass(1)}
                  exiting={FadeOut.duration(160)}
                  layout={layoutTransition}
                  style={[styles.fact, i < memory.length - 1 && styles.divider]}
                >
                  <View style={styles.bullet} />
                  <Text variant="callout" tone="ink" style={styles.flex}>
                    {fact}
                  </Text>
                  <IconButton icon="x" variant="plain" size={36} iconSize={16} color={colors.muted} accessibilityLabel={`Forget: ${fact}`} disabled={busy} onPress={() => void forget(i)} />
                </Animated.View>
              ))}
            </GlassCard>
          )}

          <Animated.View entering={FadeInDown.delay(80).springify().damping(18).stiffness(100).mass(1)} style={styles.addCard}>
            <Text variant="eyebrow" tone="subtle" style={styles.addTitle}>
              Add a note
            </Text>
            <View style={styles.addRow}>
              <TextField
                value={adding}
                maxLength={MEMORY_MAX_LENGTH}
                onChangeText={(v) => {
                  setAdding(v);
                  if (addError) setAddError(null);
                }}
                onSubmitEditing={() => void add()}
                // Wraps (and grows) instead of one scrolling line: a note can run to 200 characters, and Android wraps
                // a long placeholder of a single-line field onto a clipped second line. Enter still adds the note.
                multiline
                submitBehavior="submit"
                textAlignVertical="center"
                inputStyle={styles.addInput}
                returnKeyType="done"
                placeholder={full ? 'Memory is full — forget something first' : "e.g. I don't eat onion or garlic on Tuesdays"}
                editable={!full}
                accessibilityLabel="Something ÖRZA should remember"
                error={addError}
                containerStyle={styles.flex}
              />
              <Button label="Add" icon="plus" variant="secondary" onPress={() => void add()} disabled={!adding.trim() || busy || full} loading={busy && !!adding.trim()} style={styles.addBtn} />
            </View>
          </Animated.View>

          {memory.length > 0 ? (
            <Button label="Forget everything" icon="trash-2" variant="ghost" onPress={forgetEverything} disabled={busy} style={styles.clear} />
          ) : null}
        </>
      )}

      <Note icon="lock" tint={TINTS.violet} style={styles.note}>
        These notes are private to your account and only used to personalise ÖRZA for you. We never share personal health information without your consent.
      </Note>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  skeleton: { gap: spacing.lg },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  meter: { gap: spacing.md },
  meterHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  meterIcon: { width: 40, height: 40, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.violet50 },
  undo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.successBg,
    borderWidth: 1,
    borderColor: 'rgba(18,122,86,0.18)',
  },
  undoBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radii.pill, backgroundColor: colors.white },
  pressed: { opacity: 0.7 },
  empty: { marginTop: spacing.lg },
  list: { marginTop: spacing.lg },
  fact: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingLeft: spacing.lg, paddingRight: spacing.xs, paddingVertical: spacing.sm, minHeight: 56 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairlineStrong },
  bullet: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.violet },
  addCard: { marginTop: spacing.xxl },
  addTitle: { marginBottom: spacing.sm, marginLeft: spacing.xs },
  addRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  addBtn: { marginTop: 3 },
  addInput: { maxHeight: 132 },
  clear: { marginTop: spacing.lg, alignSelf: 'center' },
  note: { marginTop: spacing.xxl },
});
