/**
 * Scan a prescription — take or choose a photo, ÖRZA's AI reads it (scan line over the photo), then the editable review
 * opens. Manual entry when AI is off / out of credits / the member prefers typing. History of past prescriptions below.
 */
import { router, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useState } from 'react';
import { Alert, RefreshControl, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from 'react-native-reanimated';

import { useAiStatus } from '@/features/meals/api';
import { FALLBACK_COSTS, formatNumber } from '@/features/meals/utils';
import { useLocalToday, useMedsTimezone } from '@/features/meds/api';
import { usePrescriptions, useScanPrescription } from '@/features/rx/api';
import { HistoryList } from '@/features/rx/HistoryList';
import { pickRxPhoto, type RxPhoto } from '@/features/rx/photo';
import { rxProblem, type RxProblem } from '@/features/rx/problem';
import { ProblemPanel } from '@/features/rx/ProblemPanel';
import { rxPhotoDraft } from '@/features/rx/rows';
import { Viewfinder } from '@/features/rx/Viewfinder';
import { errorMessage } from '@/lib/api';
import { useSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { PhotoError, type PhotoSource } from '@/lib/image';
import { colors, radii, spacing } from '@/theme';
import { Button, GlassCard, Icon, Screen, ScreenHeader, SectionHeader, Text, toast } from '@/ui';

const TIPS = [
  'Lay the prescription flat in daylight; avoid shadows and glare.',
  'Fit the whole page in the frame — dosage columns are often at the edge.',
  'Handwriting is fine. Anything hard to read is flagged for you to check.',
  'One prescription per photo. Scan each page separately.',
];

export default function PrescriptionScan() {
  const user = useSignedInUser();
  const tz = useMedsTimezone();
  const today = useLocalToday(tz);
  const year = Number(today.slice(0, 4));
  const aiStatus = useAiStatus();
  const aiOff = aiStatus?.ai_enabled === false;
  const cost = aiStatus?.costs?.scan ?? FALLBACK_COSTS.scan;
  const history = usePrescriptions();
  const scan = useScanPrescription();
  const navigation = useNavigation();

  const [photo, setPhoto] = useState<RxPhoto | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState<RxProblem | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const scanning = scan.isPending;
  const busy = preparing || scanning;

  // Leaving mid-read is fine — the result still lands in "Your prescriptions" — but say so first.
  usePreventRemove(scanning, ({ data }) => {
    haptics.warning();
    Alert.alert('Still reading your prescription', 'If you leave now, the result appears under “Your prescriptions” when it is ready.', [
      { text: 'Stay', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  async function choose(source: PhotoSource) {
    if (busy) return;
    try {
      const picked = await pickRxPhoto(source, () => setPreparing(true));
      if (picked) {
        setPhoto(picked);
        setProblem(null);
        haptics.soft();
      }
    } catch (e) {
      haptics.error();
      toast.error(e instanceof PhotoError ? e.message : "We couldn't read that photo. Please try another.");
    } finally {
      setPreparing(false);
    }
  }

  function read() {
    if (!photo || scanning) return;
    setProblem(null);
    scan.mutate(photo.dataUrl, {
      onSuccess: (res) => {
        haptics.success();
        const found = res.prescription.medicines.length;
        if (found) toast.success(`Found ${found} medicine${found === 1 ? '' : 's'} — please check them`);
        setPhoto(null);
        // A push doesn't remove this screen, so the leave guard above doesn't get in the way.
        router.push({ pathname: '/rx/review', params: { id: res.prescription.id } });
      },
      onError: (e) => {
        haptics.error();
        setProblem(rxProblem(e));
      },
    });
  }

  function typeInstead() {
    if (scanning) return;
    rxPhotoDraft.set(photo?.dataUrl ?? null);
    setProblem(null);
    router.push('/rx/review');
  }

  async function onRefresh() {
    haptics.soft();
    setRefreshing(true);
    try {
      const r = await history.refetch();
      if (r.isError && r.data !== undefined) toast.error(errorMessage(r.error));
    } finally {
      setRefreshing(false);
    }
  }

  const credits = user.credits ?? 0;

  return (
    <Screen
      backdrop="orb"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.coral} colors={[colors.coral]} progressBackgroundColor={colors.canvas} />}
    >
      <ScreenHeader
        back
        large={false}
        eyebrow="Care · Prescriptions"
        title="Scan a prescription"
        subtitle="Take a photo of your doctor's prescription. ÖRZA reads every medicine — brand names, 1-0-1, BD, TDS, SOS, after food, x 5 days — and sets the alarms for you to review."
      />

      <Animated.View entering={FadeInDown.delay(40).springify().damping(18)}>
        <GlassCard tone="strong" padding={spacing.md} style={styles.card}>
          <Viewfinder uri={photo?.uri ?? null} scanning={scanning} />

          <Animated.View layout={LinearTransition.springify().damping(20)} style={styles.controls}>
            {problem ? <ProblemPanel problem={problem} onManual={typeInstead} onRetry={photo ? read : undefined} retrying={scanning} /> : null}

            {aiOff && !problem ? (
              <Animated.View entering={FadeIn} style={styles.aiOff}>
                <Icon name="info" size={16} color={colors.cyan700} />
                <Text variant="small" color={colors.cyan700} style={styles.flex}>
                  Automatic reading isn&apos;t available right now. Type the medicines from your prescription — it takes a minute, and you can attach the photo for reference.
                </Text>
              </Animated.View>
            ) : null}

            {scanning ? (
              <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.reading} accessibilityLiveRegion="polite">
                <Button label="Reading your prescription…" variant="energy" size="lg" block loading />
                <Text variant="caption" tone="muted" align="center">
                  Usually 10–30 seconds. Handwriting can take a little longer.
                </Text>
              </Animated.View>
            ) : photo && !aiOff ? (
              <View style={styles.actions}>
                <Button
                  label={`Read prescription · ${cost} credits`}
                  icon="mci:line-scan"
                  variant="energy"
                  size="lg"
                  block
                  haptic="firm"
                  onPress={read}
                  disabled={preparing}
                  accessibilityHint={`Uses ${cost} AI credits. You have ${formatNumber(credits)}.`}
                />
                <View style={styles.row}>
                  <Button label="Retake" icon="camera" variant="secondary" onPress={() => void choose('camera')} disabled={busy} style={styles.flex} />
                  <Button label="Gallery" icon="image" variant="ghost" accessibilityLabel="Choose another photo from your gallery" onPress={() => void choose('library')} disabled={busy} style={styles.flex} />
                </View>
                <Text variant="caption" tone="subtle" align="center">
                  {formatNumber(credits)} credits left · resized on your phone before upload
                </Text>
              </View>
            ) : (
              <View style={styles.row}>
                <Button
                  label="Take photo"
                  icon="camera"
                  variant={aiOff ? 'secondary' : 'energy'}
                  size="lg"
                  loading={preparing}
                  disabled={busy}
                  onPress={() => void choose('camera')}
                  style={styles.flex}
                />
                <Button label="Upload" icon="image" variant="secondary" size="lg" disabled={busy} onPress={() => void choose('library')} style={styles.flex} />
              </View>
            )}

            <Button
              label={aiOff ? (photo ? 'Type the medicines' : 'Type the medicines instead') : 'Prefer typing? Enter medicines manually'}
              icon="edit-3"
              variant={aiOff ? 'primary' : 'ghost'}
              size={aiOff ? 'lg' : 'sm'}
              block={aiOff}
              onPress={typeInstead}
              disabled={scanning}
              style={aiOff ? undefined : styles.manual}
            />
          </Animated.View>
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(100).springify().damping(18)}>
        <GlassCard padding={spacing.lg} style={styles.card}>
          <View style={styles.tipHead}>
            <Icon name="mci:lightbulb-on-outline" size={15} color={colors.subtle} />
            <Text variant="eyebrow" tone="subtle">
              For the best read
            </Text>
          </View>
          {TIPS.map((t) => (
            <View key={t} style={styles.tip}>
              <View style={styles.bullet} />
              <Text variant="small" tone="muted" style={styles.flex}>
                {t}
              </Text>
            </View>
          ))}
          <View style={styles.privacy}>
            <View style={styles.shield}>
              <Icon name="shield" size={16} color={colors.cyan700} />
            </View>
            <Text variant="caption" tone="muted" style={styles.flex}>
              Your photo is stored privately in your account. It&apos;s shown on each medicine&apos;s alarm until you add a photo of the actual strip or bottle.
            </Text>
          </View>
        </GlassCard>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(160).springify().damping(18)} style={styles.history}>
        <SectionHeader title="Your prescriptions" />
        <HistoryList
          items={history.data}
          isPending={history.isPending}
          error={history.error}
          onRetry={() => void history.refetch()}
          retrying={history.isFetching}
          year={year}
          tz={tz}
        />
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { marginTop: spacing.lg },
  controls: { marginTop: spacing.md, gap: spacing.md },
  aiOff: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.infoBg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(11,143,166,0.22)',
  },
  reading: { gap: spacing.sm },
  actions: { gap: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm },
  manual: { alignSelf: 'center' },
  tipHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  tip: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginBottom: spacing.sm },
  bullet: { width: 5, height: 5, borderRadius: 3, marginTop: 8, backgroundColor: colors.coral },
  privacy: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  shield: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cyan50 },
  history: { marginTop: spacing.xxl },
});
