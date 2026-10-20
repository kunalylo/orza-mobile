import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, BackHandler, Linking, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { ApiError, errorMessage, validationField } from '@/lib/api';
import { useAuth, useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { pickPhotos, toUploadDataUrl, type PhotoSource } from '@/lib/image';
import { colors, gutter, radii, spacing } from '@/theme';
import { Button, Icon, IconButton, Screen, ScreenHeader, Text, TextField, toast, useTabBarSpace } from '@/ui';

import { useAiStatus } from '@/features/meals/api';
import { draftsValid, fromDraft, toDraft, type DraftItem } from '@/features/meals/ItemEditor';
import type { Meal, MealType } from '@/features/meals/types';
import { DEFAULT_TZ, FALLBACK_COSTS, MEAL_SINGULAR, formatDayLabel, formatNumber, guessMealType, isMealType, isRealDay, todayInTz } from '@/features/meals/utils';
import { scanProblem, useConfirmScan, useScanMeal } from '@/features/snap/api';
import {
  AiDisabledPanel,
  AnalysingPanel,
  LoggedPanel,
  NoCreditsPanel,
  PermissionPanel,
  ScanErrorPanel,
  SlowDownPanel,
  SnapTips,
} from '@/features/snap/Panels';
import { ScanReview } from '@/features/snap/ScanReview';
import type { Scan, ScanPhase, ScanProblem } from '@/features/snap/types';
import { NOTE_MAX, SCAN_PHOTO } from '@/features/snap/utils';
import { Viewfinder } from '@/features/snap/Viewfinder';

type Params = { date?: string; meal_type?: string };
type Photo = { uri: string; dataUrl: string };

/**
 * Snap & Know — take or choose a photo of a meal → ÖRZA's AI estimate → review / edit the items → log.
 * Route params (from Meals / Today): `date=YYYY-MM-DD` (a past day to log to) and `meal_type=…`.
 */
export default function Snap() {
  const user = useSignedInUser();
  const { setUser, refresh } = useAuth();
  const tz = user.profile?.timezone || DEFAULT_TZ;
  const params = useLocalSearchParams<Params>();
  const tabSpace = useTabBarSpace();
  const reduce = useReducedMotion();
  const aiStatus = useAiStatus();
  const scanMut = useScanMeal();
  const confirmMut = useConfirmScan();

  const [today, setToday] = useState(() => todayInTz(tz));
  /** A past day chosen via params; null = the user's today. */
  const [pastDay, setPastDay] = useState<string | null>(null);
  const [mealType, setMealType] = useState<MealType>(() => guessMealType(tz));
  const [photo, setPhoto] = useState<Photo | null>(null);
  /** The source being picked / prepared (its button shows the spinner); null = idle. */
  const [preparing, setPreparing] = useState<PhotoSource | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [scan, setScan] = useState<Scan | null>(null);
  const [rows, setRows] = useState<DraftItem[]>([]);
  const [problem, setProblem] = useState<ScanProblem | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [logged, setLogged] = useState<Meal | null>(null);

  const scrollRef = useRef<ScrollView>(null);
  const sideY = useRef(0);
  /** Until when a move of the side panel re-runs the requested scroll to it (see `scrollToSide`). */
  const sideScrollUntil = useRef(0);
  const sideScrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const date = pastDay && pastDay < today ? pastDay : today;
  const isToday = date === today;
  const dayLabel = formatDayLabel(date, today);

  // Leaving the tab with nothing in progress: the next visit starts on today with a fresh meal-type guess
  // (a past day / meal type only sticks while a photo or review is in hand). See the blur handler below.
  const onBlur = useRef<() => void>(() => {});
  useFocusEffect(
    useCallback(() => {
      setToday(todayInTz(tz));
      return () => onBlur.current();
    }, [tz])
  );

  // Params from Meals / Today are applied once, then cleared so revisiting the tab starts clean.
  const { date: qDate, meal_type: qType } = params;
  const paramKey = `${qDate ?? ''}|${qType ?? ''}`;
  const [seenParams, setSeenParams] = useState('|');
  if (paramKey !== seenParams) {
    setSeenParams(paramKey);
    if (qDate !== undefined) setPastDay(isRealDay(qDate) && qDate < today ? qDate : null);
    if (isMealType(qType)) setMealType(qType);
  }
  useEffect(() => {
    if (qDate === undefined && qType === undefined) return;
    router.setParams({ date: undefined, meal_type: undefined });
  }, [qDate, qType]);

  const aiOff = aiStatus?.ai_enabled === false || problem?.kind === 'ai_disabled';
  const scanCost = aiStatus?.costs?.scan ?? FALLBACK_COSTS.scan;
  const scanning = phase === 'scanning';
  const busy = preparing !== null || scanning;
  const logging = confirmMut.isPending;

  const scrollTop = () => scrollRef.current?.scrollTo({ y: 0, animated: !reduce });
  const scrollToSideNow = () => scrollRef.current?.scrollTo({ y: Math.max(0, sideY.current - spacing.md), animated: !reduce });
  const scrollToSide = () => {
    // The panel moves when the controls above it change — results drop the note + Analyse block (~300 dp) — and its
    // new position arrives a little after the state change: scrolling to the old one opened the review past its dish
    // name and totals. Scroll now-ish, and again whenever the panel reports a new position during the next second.
    sideScrollUntil.current = Date.now() + 1000;
    clearTimeout(sideScrollTimer.current);
    sideScrollTimer.current = setTimeout(scrollToSideNow, 120);
  };
  useEffect(() => () => clearTimeout(sideScrollTimer.current), []);

  const reset = (keepNote = false) => {
    setPhoto(null);
    if (!keepNote) setNote('');
    setNoteError(null);
    setScan(null);
    setRows([]);
    setPhase('idle');
    setProblem(null);
    setLogged(null);
    setShowErrors(false);
  };

  /* ─── photo ─── */

  // Synchronous guards: a second tap (or a hardware Enter's key-down + key-up) can arrive before `busy` re-renders —
  // that would open two pickers, or send the photo twice and spend the scan's credits twice.
  const picking = useRef(false);
  const scanSent = useRef(false);

  const pick = async (source: PhotoSource) => {
    if (busy || logging || picking.current) return;
    picking.current = true;
    setPreparing(source);
    try {
      const picked = await pickPhotos(source);
      if (!picked.length) return; // cancelled — keep whatever was there
      const { dataUrl } = await toUploadDataUrl(picked[0].uri, SCAN_PHOTO);
      reset(true);
      setPhoto({ uri: picked[0].uri, dataUrl });
      setPhase('ready');
      haptics.soft();
    } catch (e) {
      const p = scanProblem(e);
      if (p.kind === 'permission') {
        haptics.warning();
        setProblem(p);
        scrollToSide();
      } else {
        toast.error(p.message);
      }
    } finally {
      picking.current = false;
      setPreparing(null);
    }
  };

  /* ─── analyse ─── */

  const analyse = () => {
    console.log("[D1-TEMP] analyse", !!photo, busy, scanSent.current);
    if (!photo || busy || scanSent.current) return;
    scanSent.current = true;
    setPhase('scanning');
    setProblem(null);
    setNoteError(null);
    scanMut.mutate(
      { image: photo.dataUrl, note },
      {
        onSuccess: (res) => {
          if (typeof res.credits === 'number') setUser({ ...user, credits: res.credits });
          setScan(res.scan);
          setRows(res.scan.items.map(toDraft));
          setShowErrors(false);
          setPhase('result');
          haptics.success();
          scrollToSide();
        },
        onError: (e) => {
          setPhase('ready');
          haptics.error();
          // A photo with no food can still use credits once the daily refunds are used up — resync the balance.
          if (e instanceof ApiError && (e.code === 'no_food' || e.status === 402)) void refresh().catch(() => null);
          // The server's zod 400 reads "note: Keep the note under 200 characters" (no `field`).
          const invalid = validationField(e);
          if (invalid?.field === 'note') {
            setNoteError(invalid.message);
            return;
          }
          setProblem(scanProblem(e));
          scrollToSide();
        },
        onSettled: () => {
          scanSent.current = false;
        },
      }
    );
  };

  /* ─── log ─── */

  const logMeal = () => {
    if (!scan || logging) return;
    setShowErrors(true);
    if (!draftsValid(rows)) {
      toast.error(rows.length ? 'Please check the highlighted fields.' : 'Add at least one item before logging.');
      return;
    }
    confirmMut.mutate(
      { id: scan.id, items: rows.map(fromDraft), meal_type: mealType, date },
      {
        onSuccess: ({ meal }) => {
          setLogged(meal);
          setPhase('logged');
          toast.success(`Logged to ${MEAL_SINGULAR[meal.meal_type].toLowerCase()} — ${formatNumber(meal.totals.calories)} kcal`);
          scrollTop();
        },
        onError: (e) => {
          if (e instanceof ApiError && e.code === 'already_confirmed') {
            toast.info('This scan is already in your meal log.');
            reset();
            scrollTop();
          } else if (e instanceof ApiError && e.status === 404) {
            // The scan expired — the photo is still here, so it can be analysed again.
            toast.error(e.message);
            setScan(null);
            setRows([]);
            setPhase('ready');
          } else {
            toast.error(errorMessage(e));
          }
        },
      }
    );
  };

  const scanAnother = () => {
    reset();
    scrollTop();
  };

  /* ─── Android back: don't silently throw away a paid, unsaved estimate ─── */

  const reviewing = phase === 'result';
  const discardRef = useRef(scanAnother);
  useEffect(() => {
    discardRef.current = scanAnother;
    onBlur.current = () => {
      const idle = phase === 'logged' || (phase === 'idle' && !photo);
      if (!idle) return;
      if (phase === 'logged') reset();
      setPastDay(null);
      setMealType(guessMealType(tz));
    };
  });
  useFocusEffect(
    useCallback(() => {
      if (!reviewing) return;
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        // Back (or a tap outside) on the dialog keeps the review — the safe choice.
        Alert.alert(
          'Discard this scan?',
          "The items ÖRZA found haven't been logged yet.",
          [
            { text: 'Keep reviewing', style: 'cancel' },
            { text: 'Discard', style: 'destructive', onPress: () => discardRef.current() },
          ],
          { cancelable: true }
        );
        return true;
      });
      return () => sub.remove();
    }, [reviewing])
  );

  /* ─── navigation ─── */

  const openMeals = (compose = false) => {
    // Always name the day (today included): the Meals tab stays mounted and keeps whatever day it was left on.
    const p: Record<string, string> = { date };
    if (compose) p.compose = '1';
    router.navigate({ pathname: '/meals', params: p });
  };
  const openCredits = () => router.push('/credits');

  /* ─── side panel ─── */

  let side: ReactNode;
  if (aiOff) side = <AiDisabledPanel message={problem?.kind === 'ai_disabled' ? problem.message : undefined} onTypeInstead={() => openMeals(true)} />;
  else if (phase === 'logged' && logged) side = <LoggedPanel meal={logged} onViewLog={() => openMeals()} onScanAnother={scanAnother} />;
  else if (phase === 'result' && scan)
    side = (
      <ScanReview
        scan={scan}
        rows={rows}
        onRowsChange={setRows}
        mealType={mealType}
        onMealTypeChange={setMealType}
        dayLabel={dayLabel}
        showErrors={showErrors}
        logging={logging}
        onLog={logMeal}
        onReset={scanAnother}
      />
    );
  else if (scanning) side = <AnalysingPanel />;
  else if (problem?.kind === 'no_credits') side = <NoCreditsPanel onCredits={openCredits} onLogFree={() => openMeals()} onRetry={photo ? analyse : undefined} />;
  else if (problem?.kind === 'rate_limited') side = <SlowDownPanel message={problem.message} onRetry={photo ? analyse : undefined} onTypeInstead={() => openMeals(true)} />;
  else if (problem?.kind === 'permission') {
    const source = problem.source;
    const other: PhotoSource = source === 'camera' ? 'library' : 'camera';
    side = (
      <PermissionPanel
        message={problem.message}
        blocked={problem.blocked}
        source={source}
        onOpenSettings={() => void Linking.openSettings()}
        onTryAgain={() => void pick(source)}
        onOtherSource={() => void pick(other)}
      />
    );
  } else if (problem?.kind === 'error')
    side = <ScanErrorPanel message={problem.message} onRetry={problem.retry && photo ? analyse : undefined} onPickAnother={() => void pick('library')} />;
  else side = <SnapTips scanCost={scanCost} />;

  /* ─── controls under the viewfinder ─── */

  let controls: ReactNode = null;
  if (!photo || phase === 'idle') {
    controls = (
      <View style={styles.gap}>
        <Button
          label="Take photo"
          icon="camera"
          variant="energy"
          size="lg"
          block
          loading={preparing === 'camera'}
          disabled={aiOff || busy}
          onPress={() => void pick('camera')}
        />
        <Button
          label="Choose from gallery"
          icon="image"
          variant="secondary"
          block
          loading={preparing === 'library'}
          disabled={aiOff || busy}
          onPress={() => void pick('library')}
        />
      </View>
    );
  } else if (phase === 'ready' || phase === 'scanning') {
    controls = (
      <View style={styles.gap}>
        <TextField
          label="Add a note (optional)"
          value={note}
          onChangeText={(t) => {
            setNote(t);
            if (noteError) setNoteError(null);
          }}
          maxLength={NOTE_MAX}
          editable={!scanning && !aiOff}
          placeholder="e.g. homemade, less oil · restaurant · shared"
          hint="Tell ÖRZA what the camera can't see — it changes the oil and portion estimate."
          error={noteError}
          returnKeyType="go"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={analyse}
        />
        <Button
          label={scanning ? 'Analysing your plate…' : `Analyse photo · ${scanCost} credits`}
          icon="maximize"
          variant="energy"
          size="lg"
          block
          loading={scanning}
          disabled={aiOff || preparing !== null}
          onPress={analyse}
          haptic="firm"
        />
        <View style={styles.subRow}>
          <View style={styles.subActions}>
            <Button label="Retake" icon="camera" variant="ghost" size="sm" loading={preparing === 'camera'} disabled={busy} onPress={() => void pick('camera')} />
            <Button label="Gallery" icon="image" variant="ghost" size="sm" loading={preparing === 'library'} disabled={busy} onPress={() => void pick('library')} />
          </View>
          <Text variant="caption" tone="subtle" style={styles.credits}>
            {scanning ? 'Usually 5–20 seconds' : `${formatNumber(user.credits)} credits left`}
          </Text>
        </View>
      </View>
    );
  } else if (phase === 'result' && note.trim()) {
    controls = (
      <Text variant="small" tone="muted">
        Your note:{' '}
        <Text variant="small" tone="ink">
          “{note.trim()}”
        </Text>
      </Text>
    );
  }

  return (
    <Screen scroll={false} padded={false} keyboard backdrop="orb" edges={['top']} contentContainerStyle={styles.noPad}>
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={[styles.content, { paddingBottom: tabSpace }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          eyebrow="Snap & Know"
          title="Snap your plate. Know your meal."
          subtitle="Photograph your meal — ÖRZA estimates calories, protein, carbs and fat from any cuisine. Review it, fix anything, then log."
          right={<IconButton icon="book-open" accessibilityLabel="Open the meal log" onPress={() => openMeals()} />}
        />

        {!isToday ? (
          <Animated.View entering={FadeIn.duration(220)} style={styles.dayBanner}>
            <Icon name="calendar" size={15} color={colors.violet600} />
            <Text variant="small" color={colors.violet600} style={styles.flexShrink}>
              Scans will be logged to{' '}
              <Text variant="small" weight="semibold" color={colors.violet600}>
                {dayLabel}
              </Text>
              .
            </Text>
            <Button label="Use today" variant="ghost" size="sm" onPress={() => setPastDay(null)} disabled={logging} />
          </Animated.View>
        ) : null}

        <Animated.View entering={reduce ? undefined : FadeInDown.delay(40).springify().damping(18).stiffness(100).mass(1)}>
          <Viewfinder imageUri={photo?.uri ?? null} phase={phase} confidence={scan?.confidence} dishName={scan?.dish_name}>
            {controls}
          </Viewfinder>
        </Animated.View>

        <View
          style={styles.side}
          onLayout={(e) => {
            const moved = e.nativeEvent.layout.y !== sideY.current;
            sideY.current = e.nativeEvent.layout.y;
            if (moved && Date.now() < sideScrollUntil.current) scrollToSideNow();
          }}
        >
          <Animated.View key={sideKey(phase, problem, aiOff)} entering={reduce ? undefined : FadeInDown.delay(60).springify().damping(18).stiffness(100).mass(1)}>
            {side}
          </Animated.View>
        </View>

        <Text variant="caption" tone="subtle" align="center" style={styles.disclaimer}>
          ÖRZA offers wellness guidance, not medical advice. Calorie estimates are approximate.
        </Text>
      </ScrollView>
    </Screen>
  );
}

/** Re-run the entrance animation only when the panel itself changes (not on every edit inside it). */
function sideKey(phase: ScanPhase, problem: ScanProblem | null, aiOff: boolean): string {
  if (aiOff) return 'ai-off';
  if (phase === 'logged' || phase === 'result' || phase === 'scanning') return phase;
  return problem ? `problem-${problem.kind}` : 'tips';
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flex: 1, minWidth: 0 },
  noPad: { paddingBottom: 0 },
  content: { paddingHorizontal: gutter, flexGrow: 1 },
  gap: { gap: spacing.md },
  subRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  subActions: { flexDirection: 'row', gap: spacing.xs },
  credits: { flexShrink: 1 },
  dayBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.lg,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: 'rgba(135,87,242,0.22)',
    backgroundColor: 'rgba(135,87,242,0.06)',
  },
  side: { marginTop: spacing.xl },
  disclaimer: { marginTop: spacing.xxl, paddingHorizontal: spacing.lg },
});
