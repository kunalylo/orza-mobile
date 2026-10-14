/**
 * Conversational onboarding (same flow and API as the website's /onboarding): ÖRZA asks, the member answers
 * with chips, numbers, multi-select or text; the plan summary is confirmed; then the guard opens the app.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { Bubble, Typing, type ChatItem } from '@/components/onboarding/ChatBits';
import { Composer } from '@/components/onboarding/Composer';
import { errorMessage } from '@/lib/api';
import { firstName, useAuth } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { onboardingApi, type Answer, type ChatLine, type OnboardingProgress, type OnboardingStepResult, type StepPrompt } from '@/lib/onboarding';
import { colors, gutter, spacing } from '@/theme';
import { EmptyState, IconButton, Orb, ProgressBar, Screen, Skeleton, Text, toast, Button } from '@/ui';

const TYPING_MS = 650;
const DONE_REDIRECT_MS = 2200;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let seq = 0;
const nextId = () => `m${++seq}`;

function historyItems(history: ChatLine[]): ChatItem[] {
  return history.map((h) => ({ id: nextId(), role: h.role, content: h.content, instant: true }));
}

function promptItem(prompt: StepPrompt, instant = false): ChatItem {
  if (prompt.summary) return { id: nextId(), role: 'assistant', content: prompt.ack ?? '', summary: prompt.summary, instant };
  return { id: nextId(), role: 'assistant', content: prompt.message, instant };
}

export default function Onboarding() {
  const { user, setUser, refresh, signOut } = useAuth();
  const { height } = useWindowDimensions();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [items, setItems] = useState<ChatItem[]>([]);
  const [prompt, setPrompt] = useState<StepPrompt | null>(null);
  const [progress, setProgress] = useState<OnboardingProgress>({ index: 0, total: 14, value: 0 });
  const [answered, setAnswered] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [round, setRound] = useState(0);
  const inflight = useRef(false);
  const scrollRef = useRef<ScrollView>(null);
  const doneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Fetch the saved conversation; returns a canceller (state is only touched in the promise callbacks). */
  const load = useCallback(() => {
    let cancelled = false;
    onboardingApi.state().then(
      (data) => {
        if (cancelled) return;
        if (data.done || !data.prompt) {
          void refresh(); // already finished elsewhere — the route guard moves on
          return;
        }
        setItems([...historyItems(data.history), promptItem(data.prompt, data.history.length > 0)]);
        setPrompt(data.prompt);
        setProgress(data.progress);
        setAnswered(Object.keys(data.answers || {}).length);
        setStatus('ready');
      },
      (e: unknown) => {
        if (cancelled) return;
        setLoadError(errorMessage(e));
        setStatus('error');
      }
    );
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => load(), [load]);

  useEffect(
    () => () => {
      if (doneTimer.current) clearTimeout(doneTimer.current);
    },
    []
  );

  function applyResult(res: OnboardingStepResult) {
    if (res.answers) setAnswered(Object.keys(res.answers).length);
    if (res.progress) setProgress(res.progress);

    if (res.done) {
      setItems((s) => [...s, { id: nextId(), role: 'assistant', content: res.reply }]);
      setPrompt(null);
      setDone(true);
      haptics.success();
      doneTimer.current = setTimeout(() => {
        if (res.user) setUser(res.user);
        else void refresh();
      }, DONE_REDIRECT_MS);
      return;
    }
    const p = res.prompt;
    if (!p) {
      toast.error('Something went wrong. Please try again.');
      return;
    }
    if (res.resync) {
      setItems([...historyItems(res.history ?? []), promptItem(p)]);
    } else if (res.restarted) {
      setItems([promptItem(p)]);
      setAnswered(0);
    } else if (res.valid === false) {
      haptics.warning();
      setItems((s) => [...s, { id: nextId(), role: 'assistant', content: res.reply, tone: 'hint' }]);
    } else {
      setItems((s) => [...s, promptItem(p)]);
    }
    setPrompt(p);
    setRound((r) => r + 1);
  }

  async function answer(value: Answer, display: string) {
    if (!prompt || inflight.current || done) return;
    inflight.current = true;
    const mine: ChatItem = { id: nextId(), role: 'user', content: display };
    setItems((s) => [...s, mine]);
    setBusy(true);
    try {
      const [res] = await Promise.all([onboardingApi.answer(prompt.step, value), wait(TYPING_MS)]);
      applyResult(res);
    } catch (e) {
      setItems((s) => s.filter((i) => i.id !== mine.id));
      toast.error(errorMessage(e));
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  }

  function confirmRestart() {
    haptics.warning();
    Alert.alert('Start over?', "Your answers so far will be cleared and we'll begin again from the first question.", [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Start over',
        style: 'destructive',
        onPress: async () => {
          if (inflight.current) return;
          inflight.current = true;
          setBusy(true);
          try {
            const res = await onboardingApi.restart();
            if (res.done || !res.prompt) {
              await refresh();
              return;
            }
            setItems([promptItem(res.prompt)]);
            setPrompt(res.prompt);
            setProgress(res.progress);
            setAnswered(0);
            setRound((r) => r + 1);
            toast.success('Starting fresh');
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            inflight.current = false;
            setBusy(false);
          }
        },
      },
    ]);
  }

  function confirmSignOut() {
    haptics.warning();
    Alert.alert('Sign out?', 'Your answers so far are saved — you can continue next time you sign in.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
    ]);
  }

  const total = Math.max(1, progress.total);
  const stepNo = Math.min(progress.index + 1, total);
  const pct = done ? 1 : Math.max(progress.value, 0.02);
  const canRestart = status === 'ready' && !done && answered > 0;

  const header = (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <View style={styles.brand}>
          <Orb size={44} tone="light" orbits={false} active={busy} />
          <View>
            <Text variant="title">ÖRZA</Text>
            <Text variant="eyebrow" tone="subtle" style={styles.stepLabel}>
              {done ? 'All set' : status === 'ready' ? `Step ${stepNo} of ${total}` : 'Getting ready'}
            </Text>
          </View>
        </View>
        <View style={styles.headerActions}>
          {canRestart ? <IconButton icon="rotate-ccw" accessibilityLabel="Start over" onPress={confirmRestart} size={40} disabled={busy} /> : null}
          <IconButton icon="log-out" accessibilityLabel="Sign out" onPress={confirmSignOut} size={40} />
        </View>
      </View>
      <ProgressBar value={status === 'ready' || done ? pct : 0} height={5} accessibilityLabel="Onboarding progress" style={styles.progress} />
    </View>
  );

  if (status === 'error') {
    return (
      <Screen backdrop="orb" scroll={false} header={header} contentContainerStyle={styles.center}>
        <EmptyState icon="wifi-off" title="We couldn't load your setup" body={loadError ?? undefined} />
        <Button
          label="Try again"
          icon="refresh-cw"
          style={styles.retry}
          onPress={() => {
            setStatus('loading');
            load();
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen
      backdrop="orb"
      scroll={false}
      keyboard
      padded={false}
      header={header}
      footer={
        prompt && status === 'ready' && !done ? (
          <Animated.View key={`${prompt.step}-${round}`} entering={FadeInDown.springify().damping(20)} style={styles.composer}>
            <ScrollView
              style={{ maxHeight: Math.round(height * 0.44) }}
              contentContainerStyle={styles.composerContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              <Composer prompt={prompt} busy={busy} onAnswer={answer} />
            </ScrollView>
          </Animated.View>
        ) : null
      }
    >
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.log}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        <Animated.View entering={FadeIn.duration(400)} style={styles.intro}>
          <Text variant="eyebrow" tone="subtle" align="center">
            Let&apos;s get to know you
          </Text>
          <Text variant="h2" align="center" style={styles.introTitle}>
            Hi {firstName(user)} — a few quick questions
          </Text>
          <Text variant="small" tone="muted" align="center">
            Under two minutes. Your answers shape your targets, suggestions and chat — and stay private to you.
          </Text>
        </Animated.View>

        {status === 'loading' ? (
          <View style={styles.skeletons}>
            <Skeleton width="78%" height={64} radius={22} />
            <Skeleton width="56%" height={44} radius={22} />
          </View>
        ) : null}

        {items.map((item) => (
          <Bubble key={item.id} item={item} />
        ))}
        {busy && !done ? <Typing /> : null}
        {done ? (
          <Animated.View entering={FadeInDown.delay(300).springify()} style={styles.doneOrb}>
            <Orb size={150} tone="light" active />
            <Text variant="caption" tone="subtle" align="center">
              Opening your day…
            </Text>
          </Animated.View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { justifyContent: 'center' },
  retry: { alignSelf: 'center' },
  header: { paddingHorizontal: gutter, paddingTop: spacing.sm, paddingBottom: spacing.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginLeft: -6 },
  stepLabel: { marginTop: 1 },
  headerActions: { flexDirection: 'row', gap: spacing.sm },
  progress: { marginTop: spacing.md },
  log: { paddingHorizontal: gutter, paddingTop: spacing.lg, paddingBottom: spacing.lg, flexGrow: 1, justifyContent: 'flex-end' },
  intro: { alignItems: 'center', gap: 6, paddingHorizontal: spacing.lg, marginBottom: spacing.xxl },
  introTitle: { marginBottom: 2 },
  skeletons: { gap: spacing.md },
  doneOrb: { alignItems: 'center', marginTop: spacing.lg, gap: spacing.sm },
  composerContent: { paddingHorizontal: gutter, paddingTop: spacing.lg, paddingBottom: spacing.lg },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairlineStrong,
    backgroundColor: 'rgba(251,247,241,0.94)',
  },
});
