/**
 * Check and create alarms — the editable review of a scanned prescription (`?id=`), or manual entry (no id: type the
 * medicines, optional photo + doctor). Include / edit / remove each medicine, pick the start date and who they're for,
 * then POST /prescriptions/[id]/apply. Nothing is saved until "Create alarms".
 */
import { Image } from 'expo-image';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown, LinearTransition } from 'react-native-reanimated';

import { useLocalToday, useMedications, useMedsTimezone } from '@/features/meds/api';
import { DatePickerSheet } from '@/features/meds/PickerSheets';
import { formatDateLong, formatDateShort, isISODate } from '@/features/meds/shared';
import { ErrorPanel } from '@/features/meds/StatusViews';
import { useApplyPrescription, useCreatePrescription, usePrescription } from '@/features/rx/api';
import { pickRxPhoto } from '@/features/rx/photo';
import { ReviewRowCard } from '@/features/rx/ReviewRowCard';
import { RowEditorSheet } from '@/features/rx/RowEditorSheet';
import { emptyRow, isLowConfidence, MAX_ROWS, rowProblem, rxPhotoDraft, toApplyMedicine, toRows } from '@/features/rx/rows';
import type { ReviewRow } from '@/features/rx/types';
import { ApiError, errorMessage, mediaSource, validationField } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { PhotoError, type PhotoSource } from '@/lib/image';
import { colors, fonts, radii, shadows, spacing } from '@/theme';
import { Button, Chip, EmptyState, GlassCard, Icon, PressableScale, Screen, ScreenHeader, Sheet, Skeleton, Text, TextField, goBackOrHome, toast } from '@/ui';

type Editing = { row: ReviewRow; isNew: boolean };

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text variant="small" tone="ink">
        {value}
      </Text>
    </View>
  );
}

function ReviewSkeleton() {
  return (
    <View style={styles.skeleton} accessibilityLabel="Loading the prescription">
      <GlassCard padding={spacing.lg} style={styles.row}>
        <Skeleton width={88} height={110} radius={radii.sm} />
        <View style={styles.flex}>
          <Skeleton width="60%" height={14} />
          <Skeleton width="80%" height={14} style={styles.gap} />
          <Skeleton width="40%" height={14} style={styles.gap} />
        </View>
      </GlassCard>
      {[0, 1, 2].map((i) => (
        <GlassCard key={i} padding={spacing.lg}>
          <Skeleton width="55%" height={18} />
          <Skeleton width="75%" height={13} style={styles.gap} />
          <Skeleton width="45%" height={26} radius={radii.pill} style={styles.gap} />
        </GlassCard>
      ))}
    </View>
  );
}

export default function PrescriptionReview() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const tz = useMedsTimezone();
  const today = useLocalToday(tz);
  const year = Number(today.slice(0, 4));
  const { height } = useWindowDimensions();
  const navigation = useNavigation();
  const rxQ = usePrescription(id);
  const rx = rxQ.data;
  const meds = useMedications();
  const create = useCreatePrescription();
  const apply = useApplyPrescription();

  // Manual entry: the photo picked on the capture screen (data URL), or one attached here.
  const [photo, setPhoto] = useState<string | null>(() => (id ? null : rxPhotoDraft.take()));
  const [manualId, setManualId] = useState<string | null>(null);
  const [rows, setRows] = useState<ReviewRow[] | null>(() => (id ? null : []));
  const [doctor, setDoctor] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [forPerson, setForPerson] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [edited, setEdited] = useState(false);
  const [applying, setApplying] = useState(false);
  const [finishedId, setFinishedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [lastEditing, setLastEditing] = useState<Editing | null>(null);
  const [datePicker, setDatePicker] = useState(false);
  const [preview, setPreview] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [formError, setFormError] = useState<{ field: string; message: string } | null>(null);

  if (editing && editing !== lastEditing) setLastEditing(editing);

  // Seed the rows once the scanned prescription is here.
  if (rows === null && rx) setRows(rx.medicines.length ? toRows(rx.medicines) : []);

  const manual = !id;
  const list = rows ?? [];
  const included = list.filter((r) => r.include);
  const lowCount = included.filter(isLowConfidence).length;
  const imageSource = rx?.photo_url ? mediaSource(rx.photo_url) : photo ? { uri: photo } : undefined;
  const people = [...new Set((meds.data ?? []).map((m) => m.for_person).filter((p): p is string => !!p))].sort();

  // Typing from scratch: open the editor for the first medicine once the screen has slid in.
  useEffect(() => {
    if (id) return;
    const t = setTimeout(() => setEditing({ row: emptyRow(), isNew: true }), 420);
    return () => clearTimeout(t);
  }, [id]);

  usePreventRemove(!finishedId && (edited || applying), ({ data }) => {
    if (applying) return; // stay until the request finishes
    haptics.warning();
    Alert.alert(
      'Discard this review?',
      manual
        ? "The medicines you typed haven't been saved."
        : 'Your changes aren’t saved. The scan stays under “Your prescriptions” so you can come back to it.',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
      ]
    );
  });

  // Show the result once the guard above has re-rendered without blocking.
  useEffect(() => {
    if (finishedId) router.replace({ pathname: '/rx/done', params: { id: finishedId } });
  }, [finishedId]);

  const changeRows = (next: ReviewRow[]) => {
    setRows(next);
    setEdited(true);
  };

  const saveRow = (row: ReviewRow) => {
    const exists = list.some((r) => r.key === row.key);
    changeRows(exists ? list.map((r) => (r.key === row.key ? row : r)) : [...list, row]);
  };

  const addRow = () => {
    if (list.length >= MAX_ROWS) {
      toast.info(`Up to ${MAX_ROWS} medicines per prescription.`);
      return;
    }
    setEditing({ row: emptyRow(), isNew: true });
  };

  async function attach(source: PhotoSource) {
    if (attaching) return;
    try {
      const picked = await pickRxPhoto(source, () => setAttaching(true));
      if (picked) {
        setPhoto(picked.dataUrl);
        setEdited(true);
        haptics.soft();
      }
    } catch (e) {
      toast.error(e instanceof PhotoError ? e.message : "We couldn't read that photo. Please try another.");
    } finally {
      setAttaching(false);
    }
  }

  async function createAlarms() {
    if (applying) return;
    setShowErrors(true);
    setFormError(null);
    if (!included.length) {
      haptics.error();
      toast.error('Tick at least one medicine to create alarms.');
      return;
    }
    if (included.some((r) => rowProblem(r))) {
      haptics.error();
      toast.error('Please check the highlighted medicines.');
      return;
    }
    if (!isISODate(startDate)) {
      haptics.error();
      setFormError({ field: 'start_date', message: 'Choose a start date.' });
      return;
    }
    setApplying(true);
    let pid = id ?? manualId;
    try {
      if (!pid) {
        const created = await create.mutateAsync({ image: photo ?? undefined, doctor: doctor.trim() || undefined });
        pid = created.id;
        setManualId(created.id);
      }
      const res = await apply.mutateAsync({
        id: pid,
        body: { medicines: included.map(toApplyMedicine), start_date: startDate, for_person: forPerson.trim() || undefined },
      });
      haptics.success();
      const alarms = res.medications.filter((m) => !m.as_needed).length;
      toast.success(alarms ? `${alarms} medicine${alarms === 1 ? '' : 's'} now ${alarms === 1 ? 'has' : 'have'} alarms` : 'Medicines added');
      setFinishedId(pid);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'already_applied' && pid) {
        toast.info('Alarms were already created from this prescription.');
        setFinishedId(pid);
        return;
      }
      haptics.error();
      const f = validationField(e);
      if (f && (f.field === 'for_person' || f.field === 'start_date')) setFormError(f);
      else toast.error(errorMessage(e));
    } finally {
      setApplying(false);
    }
  }

  const startOver = () => goBackOrHome();

  /* ─────────── States before the review ─────────── */

  let content;
  if (id && rxQ.isPending) {
    content = <ReviewSkeleton />;
  } else if (id && !rx) {
    const gone = rxQ.error instanceof ApiError && rxQ.error.status === 404;
    content = gone ? (
      <GlassCard padding={spacing.sm} style={styles.section}>
        <EmptyState
          icon="file-minus"
          title="This prescription isn't here any more"
          body="It may have been deleted on another device."
          actionLabel="Back to prescriptions"
          onAction={() => router.dismissTo('/rx')}
        />
      </GlassCard>
    ) : (
      <ErrorPanel error={rxQ.error} onRetry={() => void rxQ.refetch()} retrying={rxQ.isFetching} style={styles.section} />
    );
  } else if (rx && rx.status === 'applied' && !finishedId && !applying) {
    content = (
      <GlassCard padding={spacing.sm} style={styles.section}>
        <EmptyState
          icon="check-circle"
          title="Alarms are already set"
          body="Medicines were already created from this prescription."
          actionLabel="See what was created"
          actionVariant="primary"
          onAction={() => router.replace({ pathname: '/rx/done', params: { id: rx.id } })}
        />
      </GlassCard>
    );
  }

  const ready = !content;

  return (
    <Screen
      keyboard
      backdrop="orb"
      footer={
        ready ? (
          <View style={styles.footer}>
            <Button label="Start over" variant="ghost" onPress={startOver} disabled={applying} />
            <Button
              label={`Create alarms${included.length ? ` (${included.length})` : ''}`}
              icon="bell"
              variant="energy"
              size="lg"
              haptic="firm"
              onPress={() => void createAlarms()}
              loading={applying}
              disabled={!included.length}
              style={styles.flex}
            />
          </View>
        ) : undefined
      }
    >
      <ScreenHeader
        back
        large={false}
        eyebrow="Care · Prescriptions"
        title={manual ? 'Type your prescription' : 'Check and create alarms'}
        subtitle={
          manual
            ? 'Add each medicine as written — pick 1-0-1, BD, TDS or SOS and ÖRZA fills in the alarm times.'
            : "Compare each line with your prescription, fix anything that's off, untick what you don't need — nothing is saved until you tap Create alarms."
        }
      />

      {content ?? (
        <>
          {/* ─────────── Prescription ─────────── */}
          <Animated.View entering={FadeInDown.delay(40).springify().damping(18).stiffness(100).mass(1)}>
            <GlassCard padding={spacing.lg} style={styles.section}>
              <View style={styles.row}>
                {imageSource ? (
                  <PressableScale onPress={() => setPreview(true)} accessibilityRole="imagebutton" accessibilityLabel="View the prescription photo" style={styles.thumb}>
                    <Image source={imageSource} style={StyleSheet.absoluteFill} contentFit="cover" transition={160} />
                    <View style={styles.zoom}>
                      <Icon name="maximize-2" size={12} color={colors.white} />
                    </View>
                  </PressableScale>
                ) : null}
                <View style={styles.flex}>
                  {rx && !manual ? (
                    <View style={styles.facts}>
                      {rx.doctor ? <Fact label="Doctor" value={rx.doctor} /> : null}
                      {rx.issued_on ? <Fact label="Dated" value={formatDateShort(rx.issued_on, year)} /> : null}
                      {rx.patient_name ? <Fact label="Patient" value={rx.patient_name} /> : null}
                      {!rx.doctor && !rx.issued_on && !rx.patient_name ? (
                        <Text variant="small" tone="muted">
                          Read from your photo. Check each medicine below.
                        </Text>
                      ) : null}
                    </View>
                  ) : (
                    <View style={styles.facts}>
                      <TextField
                        label="Doctor (optional)"
                        value={doctor}
                        onChangeText={(t) => {
                          setDoctor(t);
                          setEdited(true);
                        }}
                        placeholder="e.g. Dr. Mehta"
                        maxLength={80}
                        editable={!manualId && !applying}
                        autoCapitalize="words"
                      />
                      {!imageSource ? (
                        <View>
                          <Text variant="label" style={styles.attachLabel}>
                            Prescription photo (optional)
                          </Text>
                          <View style={styles.attachRow}>
                            <Button label="Camera" icon="camera" size="sm" variant="secondary" loading={attaching} disabled={attaching || !!manualId} onPress={() => void attach('camera')} />
                            <Button label="Gallery" icon="image" size="sm" variant="secondary" disabled={attaching || !!manualId} onPress={() => void attach('library')} />
                          </View>
                        </View>
                      ) : (
                        <Text variant="caption" tone="muted">
                          Your photo is kept with this prescription and shown on the alarms until you add pill photos.
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              </View>
              {rx?.notes && !manual ? (
                <View style={styles.notes}>
                  <Fact label="Notes" value={rx.notes} />
                </View>
              ) : null}
              {rx && !manual && rx.medicines.length === 0 ? (
                <View style={styles.noneFound} accessibilityRole="alert">
                  <Icon name="search" size={15} color="#8A5300" />
                  <Text variant="small" color="#8A5300" style={styles.flex}>
                    We couldn&apos;t find any medicines in this photo. Add them below, or{' '}
                    <Text variant="small" weight="semibold" color="#8A5300" onPress={startOver} accessibilityRole="link" style={styles.link}>
                      try a clearer photo
                    </Text>
                    .
                  </Text>
                </View>
              ) : null}
            </GlassCard>
          </Animated.View>

          {/* ─────────── Medicines ─────────── */}
          <Animated.View entering={FadeInDown.delay(100).springify().damping(18).stiffness(100).mass(1)} style={styles.medsHead}>
            <Text variant="h2" accessibilityRole="header">
              Medicines
            </Text>
            {list.length ? (
              <Text variant="small" tone="muted">
                {included.length} of {list.length} selected
              </Text>
            ) : null}
          </Animated.View>

          {lowCount > 0 ? (
            <Animated.View entering={FadeIn} style={styles.lowBanner}>
              <Icon name="eye" size={15} color="#8A5300" />
              <Text variant="caption" color="#8A5300" style={styles.flex}>
                {lowCount === 1 ? 'One medicine was' : `${lowCount} medicines were`} hard to read — check {lowCount === 1 ? 'it' : 'them'} against your prescription.
              </Text>
            </Animated.View>
          ) : null}

          <Animated.View layout={LinearTransition.springify().damping(20).stiffness(100).mass(1)} style={styles.list}>
            {list.map((r, i) => (
              <ReviewRowCard
                key={r.key}
                row={r}
                index={i}
                showErrors={showErrors}
                onToggle={() => changeRows(list.map((x) => (x.key === r.key ? { ...x, include: !x.include } : x)))}
                onEdit={() => setEditing({ row: r, isNew: false })}
                onRemove={() => changeRows(list.filter((x) => x.key !== r.key))}
              />
            ))}
            {!list.length ? (
              <View style={styles.emptyList}>
                <Icon name="mci:pill" size={22} color={colors.energyInk} />
                <Text variant="small" tone="muted" align="center">
                  Add each medicine from your prescription. Alarms are created only for the ones you keep ticked.
                </Text>
              </View>
            ) : null}
            <PressableScale onPress={addRow} haptic="tap" style={styles.addRow} accessibilityRole="button" accessibilityLabel="Add a medicine">
              <Icon name="plus" size={16} color={colors.ink} />
              <Text variant="label">Add a medicine</Text>
            </PressableScale>
          </Animated.View>

          {/* ─────────── Options ─────────── */}
          <Animated.View entering={FadeInDown.delay(160).springify().damping(18).stiffness(100).mass(1)}>
            <GlassCard padding={spacing.lg} style={styles.section}>
              <Text variant="label">Start alarms from</Text>
              <PressableScale onPress={() => setDatePicker(true)} haptic="tap" style={styles.dateBtn} accessibilityRole="button" accessibilityLabel={`Start date ${formatDateLong(startDate)}. Change`}>
                <Icon name="calendar" size={16} color={colors.energyInk} />
                <Text variant="title" style={styles.flex}>
                  {startDate === today ? `Today · ${formatDateShort(startDate, year)}` : formatDateLong(startDate)}
                </Text>
                <Icon name="chevron-down" size={16} color={colors.muted} />
              </PressableScale>
              <Text variant="caption" tone={formError?.field === 'start_date' ? 'error' : 'subtle'}>
                {formError?.field === 'start_date' ? formError.message : 'Course lengths (e.g. x 5 days) count from this day.'}
              </Text>

              <TextField
                label="These medicines are for (optional)"
                value={forPerson}
                onChangeText={(t) => {
                  setForPerson(t);
                  setEdited(true);
                  if (formError?.field === 'for_person') setFormError(null);
                }}
                placeholder="e.g. Mom — leave empty if they're yours"
                maxLength={40}
                autoCapitalize="words"
                error={formError?.field === 'for_person' ? formError.message : null}
                hint={rx?.patient_name ? `The prescription names ${rx.patient_name}.` : undefined}
                containerStyle={styles.forField}
                icon="user"
              />
              {people.length ? (
                <View style={styles.people} accessibilityLabel="People you already track medicines for">
                  {people.map((p) => (
                    <Chip key={p} label={p} size="sm" role="radio" selected={forPerson.trim() === p} onPress={() => setForPerson(forPerson.trim() === p ? '' : p)} />
                  ))}
                </View>
              ) : null}

              <Text variant="caption" tone="subtle" style={styles.disclaimer}>
                ÖRZA copies what&apos;s written and never changes a dose. If anything differs from your prescription, trust the prescription and ask your doctor or pharmacist.
                Wellness guidance, not medical advice.
              </Text>
            </GlassCard>
          </Animated.View>
        </>
      )}

      <RowEditorSheet
        visible={!!editing}
        row={editing?.row ?? null}
        isNew={(editing ?? lastEditing)?.isNew ?? false}
        onClose={() => setEditing(null)}
        onSave={saveRow}
      />

      <DatePickerSheet
        visible={datePicker}
        value={startDate}
        today={today}
        title="Start alarms from"
        onClose={() => setDatePicker(false)}
        onSubmit={(d) => {
          setStartDate(d);
          setEdited(true);
          if (formError?.field === 'start_date') setFormError(null);
        }}
      />

      <Sheet visible={preview} onClose={() => setPreview(false)} eyebrow="Prescription" title={rx?.doctor || 'Your photo'}>
        {imageSource ? (
          <View style={[styles.previewBox, { height: Math.round(height * 0.62) }]}>
            <Image source={imageSource} style={StyleSheet.absoluteFill} contentFit="contain" transition={160} accessibilityLabel="Prescription photo" />
          </View>
        ) : null}
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { marginTop: spacing.sm },
  skeleton: { gap: spacing.md, marginTop: spacing.lg },
  section: { marginTop: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.lg, alignItems: 'flex-start' },
  thumb: {
    width: 88,
    height: 110,
    borderRadius: radii.sm,
    overflow: 'hidden',
    backgroundColor: colors.canvas2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  zoom: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(7,9,12,0.55)',
  },
  facts: { gap: spacing.md },
  fact: { gap: 2 },
  factLabel: { fontFamily: fonts.mono, fontSize: 10.5, letterSpacing: 1.4, textTransform: 'uppercase', color: colors.subtle },
  notes: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  noneFound: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: '#FFF8EE',
  },
  link: { textDecorationLine: 'underline' },
  attachLabel: { marginBottom: spacing.sm },
  attachRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  medsHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: spacing.xxl, marginBottom: spacing.md },
  lowBanner: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    padding: spacing.md,
    marginBottom: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: '#FFF8EE',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(176,106,0,0.25)',
  },
  list: { gap: spacing.sm },
  emptyList: {
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.xl,
    borderRadius: radii.md,
    backgroundColor: colors.glassSubtle,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 48,
    borderRadius: radii.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.hairlineStrong,
    backgroundColor: colors.glassSubtle,
  },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.white,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairlineStrong,
  },
  forField: { marginTop: spacing.xl },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  disclaimer: { marginTop: spacing.xl },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(251,247,241,0.96)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    ...shadows.floating,
  },
  previewBox: { borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.canvas2 },
});
