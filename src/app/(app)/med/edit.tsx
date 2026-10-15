/**
 * Add / edit a medicine (`/med/edit`, `/med/edit?id=<id>`): photos, name, strength, form, dose, timing, schedule,
 * stock + refill alert, who it's for and instructions. In edit mode photo changes save immediately (like the web);
 * everything else on "Save changes". Leaving with unsaved changes asks first (header back, swipe, Android back).
 */
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Alert, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut } from 'react-native-reanimated';

import { useLocalToday, useMedication, useMedicationPhotos, useMedications, useMedsTimezone, useSaveMedication } from '@/features/meds/api';
import { pickUploadPhotos, PhotoGrid, type PhotoItem } from '@/features/meds/PhotoGrid';
import { draftFromSchedule, draftKey, scheduleFromDraft, type ScheduleDraft } from '@/features/meds/schedule';
import { ScheduleEditor } from '@/features/meds/ScheduleEditor';
import {
  DEFAULT_DOSE,
  FORM_OPTIONS,
  MAX_PHOTOS_ON_CREATE,
  MAX_PHOTOS_PER_MEDICINE,
  refillThreshold,
  STOCK_UNITS,
  stockUnitFor,
  TIMING_OPTIONS,
} from '@/features/meds/shared';
import { ErrorPanel } from '@/features/meds/StatusViews';
import type { DoseTiming, MedForm, MedicationClient, MedicationCreateInput, MedicationPatchInput, MedStock } from '@/features/meds/types';
import { ApiError, errorMessage, validationField } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import type { PhotoSource } from '@/lib/image';
import { colors, radii, spacing } from '@/theme';
import { Button, Chip, EmptyState, GlassCard, Icon, Screen, ScreenHeader, Skeleton, Text, TextField, toast } from '@/ui';

interface Draft {
  name: string;
  strength: string;
  form: MedForm;
  dose: string;
  doseTouched: boolean;
  timing: DoseTiming;
  instructions: string;
  for_person: string;
  stockOn: boolean;
  stockCount: string;
  /** "Left now" was typed in — until then it follows the server's count (Takes lower it while the form is open). */
  stockCountTouched: boolean;
  stockUnit: string;
  refillAt: string;
  schedule: ScheduleDraft;
}

type Errors = Partial<Record<'name' | 'dose' | 'strength' | 'schedule' | 'stock' | 'for_person' | 'instructions' | 'photos', string>>;

function draftFor(med: MedicationClient | null, today: string): Draft {
  return {
    name: med?.name || '',
    strength: med?.strength || '',
    form: med?.form || 'tablet',
    dose: med?.dose || DEFAULT_DOSE.tablet,
    doseTouched: !!med,
    timing: med?.timing || 'any',
    instructions: med?.instructions || '',
    for_person: med?.for_person || '',
    stockOn: !!med?.stock,
    stockCount: med?.stock ? String(med.stock.count) : '',
    stockCountTouched: false,
    stockUnit: med?.stock?.unit || stockUnitFor(med?.form || 'tablet'),
    refillAt: med?.stock?.refill_alert_at != null ? String(med.stock.refill_alert_at) : '',
    schedule: draftFromSchedule(med?.schedule || null, med?.as_needed || false, today),
  };
}

/** What counts as an unsaved change. */
function formKey(d: Draft): string {
  const { doseTouched: _ignored, stockCountTouched: _ignoredToo, schedule, ...rest } = d;
  void _ignored;
  void _ignoredToo;
  return JSON.stringify({ ...rest, name: rest.name.trim(), schedule: draftKey(schedule) });
}

/**
 * The PATCH `stock`. The server replaces the whole object while every Take lowers `stock.count`, so re-sending the
 * count the form opened with would undo Takes recorded meanwhile (here, on the web, another phone or the alarm).
 * Left out when no stock field changed; when only the unit or refill alert changed, the latest known count goes.
 */
function stockPatch(draft: Draft, seed: Draft, live: MedStock | undefined): MedicationPatchInput['stock'] {
  if (!draft.stockOn) return seed.stockOn ? null : undefined;
  const countEdited = !seed.stockOn || draft.stockCount !== seed.stockCount;
  if (!countEdited && draft.stockUnit === seed.stockUnit && draft.refillAt === seed.refillAt) return undefined;
  return {
    count: countEdited || !live ? Number(draft.stockCount) : live.count,
    unit: draft.stockUnit,
    refill_alert_at: draft.refillAt === '' ? null : Number(draft.refillAt),
  };
}

const isInt = (s: string, min: number, max: number) => s !== '' && Number.isInteger(Number(s)) && Number(s) >= min && Number(s) <= max;

function Section({ title, icon, children, delay = 0 }: { title: string; icon?: 'bell' | 'mci:pill' | 'calendar' | 'package' | 'user'; children: ReactNode; delay?: number }) {
  return (
    <Animated.View entering={FadeInDown.delay(delay).springify().damping(18)}>
      <GlassCard padding={spacing.lg} style={styles.section}>
        <View style={styles.sectionHead}>
          {icon ? <Icon name={icon} size={16} color={colors.energyInk} /> : null}
          <Text variant="h3" accessibilityRole="header">
            {title}
          </Text>
        </View>
        {children}
      </GlassCard>
    </Animated.View>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <Animated.View entering={FadeIn} exiting={FadeOut}>
      <Text variant="caption" tone="error" accessibilityRole="alert" style={styles.fieldError}>
        {message}
      </Text>
    </Animated.View>
  );
}

export default function EditMedicine() {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = typeof params.id === 'string' && params.id ? params.id : undefined;
  const editing = !!id;
  const navigation = useNavigation();
  const tz = useMedsTimezone();
  const today = useLocalToday(tz);
  const medQ = useMedication(id);
  const list = useMedications();
  const save = useSaveMedication();
  const photos = useMedicationPhotos();

  const current = editing ? (medQ.data ?? null) : null;
  const [draft, setDraft] = useState<Draft>(() => draftFor(current, today));
  /** What the form was filled with — the unsaved-changes baseline and what `stockPatch` compares against. */
  const [seed, setSeed] = useState<Draft>(() => draftFor(current, today));
  const [initFor, setInitFor] = useState<string | null>(current?.id ?? null);
  const [newPhotos, setNewPhotos] = useState<PhotoItem[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [exit, setExit] = useState(false);

  const liveCount = current?.stock ? String(current.stock.count) : null;
  // Seed the form once the medicine arrives (edit mode opened before the data was cached).
  if (current && initFor !== current.id) {
    const seeded = draftFor(current, today);
    setInitFor(current.id);
    setDraft(seeded);
    setSeed(seeded);
  } else if (liveCount !== null && !draft.stockCountTouched && draft.stockCount !== liveCount) {
    // A Take landed after the form opened (the detail refetch, the alarm, another device) — show the new count.
    setDraft((d) => ({ ...d, stockCount: liveCount }));
    setSeed((s) => ({ ...s, stockCount: liveCount }));
  }

  const dirty = !exit && (formKey(draft) !== formKey(seed) || newPhotos.length > 0);
  const saving = save.isPending;

  usePreventRemove(!exit && (dirty || saving), ({ data }) => {
    if (saving || photoBusy) return; // stay until the request finishes
    haptics.warning();
    Alert.alert('Discard changes?', editing ? "Your changes to this medicine haven't been saved." : "This medicine hasn't been added yet.", [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  // Leave after a successful save — once the guard above has re-rendered without blocking.
  useEffect(() => {
    if (!exit) return;
    if (router.canGoBack()) router.back();
    else router.replace('/medicines');
  }, [exit]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const clearError = (k: keyof Errors) => {
    if (errors[k]) setErrors((e) => ({ ...e, [k]: undefined }));
  };

  const people = [...new Set((list.data ?? []).map((m) => m.for_person).filter((p): p is string => !!p))].sort();

  /* ── Photos ── */
  const photoItems: PhotoItem[] = editing ? (current?.photo_ids ?? []).map((pid, i) => ({ id: pid, url: current?.photo_urls[i] ?? '' })) : newPhotos;
  const maxPhotos = editing ? MAX_PHOTOS_PER_MEDICINE + (current?.uses_prescription_photo ? 1 : 0) : MAX_PHOTOS_ON_CREATE;
  const shownMax = editing ? MAX_PHOTOS_PER_MEDICINE : MAX_PHOTOS_ON_CREATE;

  async function addPhotos(source: PhotoSource) {
    const room = maxPhotos - photoItems.length;
    if (room <= 0) return;
    setPhotoBusy(true);
    try {
      const images = await pickUploadPhotos(source, room);
      if (!images.length) return;
      if (editing && current) {
        for (const image of images) await photos.add.mutateAsync({ id: current.id, image });
        toast.success(images.length === 1 ? 'Photo added — alarms show it' : `${images.length} photos added`);
      } else {
        setNewPhotos((p) => [...p, ...images.map((url, i) => ({ id: `new-${Date.now()}-${i}`, url }))].slice(0, MAX_PHOTOS_ON_CREATE));
        haptics.success();
      }
      clearError('photos');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto(pid: string) {
    if (!editing || !current) {
      haptics.soft();
      setNewPhotos((p) => p.filter((x) => x.id !== pid));
      return;
    }
    setPhotoBusy(true);
    try {
      await photos.remove.mutateAsync({ id: current.id, mediaId: pid });
      haptics.soft();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function makePrimary(pid: string) {
    if (!editing || !current) {
      haptics.select();
      setNewPhotos((p) => [...p.filter((x) => x.id === pid), ...p.filter((x) => x.id !== pid)]);
      return;
    }
    setPhotoBusy(true);
    try {
      await photos.makePrimary.mutateAsync({ id: current.id, mediaId: pid });
      toast.success('Alarms will show this photo');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setPhotoBusy(false);
    }
  }

  /* ── Save ── */
  function validate() {
    const errs: Errors = {};
    if (!draft.name.trim()) errs.name = "Add the medicine's name.";
    if (!draft.dose.trim()) errs.dose = 'Add the dose, e.g. 1 tablet.';
    const sched = scheduleFromDraft(draft.schedule);
    if ('error' in sched) errs.schedule = sched.error;
    if (draft.stockOn) {
      if (!isInt(draft.stockCount, 0, 10000)) errs.stock = 'Enter how many are left (0–10000).';
      else if (draft.refillAt !== '' && !isInt(draft.refillAt, 0, 1000)) errs.stock = 'The refill alert should be a whole number.';
    }
    setErrors(errs);
    return { ok: !Object.keys(errs).length, sched };
  }

  function submit() {
    if (saving || photoBusy) return;
    const { ok, sched } = validate();
    if (!ok || !('schedule' in sched)) {
      haptics.error();
      toast.error('Please check the highlighted fields.');
      return;
    }
    const schedule = sched.schedule;

    const onError = (e: Error) => {
      const fe = validationField(e);
      const known: (keyof Errors)[] = ['name', 'dose', 'strength', 'schedule', 'stock', 'for_person', 'instructions', 'photos'];
      if (fe && (known as string[]).includes(fe.field)) {
        setErrors((x) => ({ ...x, [fe.field]: fe.message }));
        toast.error('Please check the highlighted fields.');
      } else if (e instanceof ApiError && e.status === 400) {
        setErrors((x) => ({ ...x, schedule: /time|date|schedule|ring|alarm/i.test(e.message) ? e.message : x.schedule }));
        toast.error(e.message);
      } else {
        toast.error(errorMessage(e));
      }
    };

    if (editing && current) {
      const every = schedule.every_n_days;
      const patch: MedicationPatchInput = {
        name: draft.name.trim(),
        strength: draft.strength.trim() || null,
        form: draft.form,
        dose: draft.dose.trim(),
        timing: draft.timing,
        instructions: draft.instructions.trim() || null,
        for_person: draft.for_person.trim() || null,
        schedule: { ...schedule, end_date: schedule.end_date ?? null, every_n_days: every && every > 1 ? every : null },
        as_needed: draft.schedule.as_needed,
        stock: stockPatch(draft, seed, current.stock),
      };
      save.mutate(
        { id: current.id, patch },
        {
          onSuccess: (m) => {
            toast.success(`${m.name} updated`);
            setExit(true);
          },
          onError,
        }
      );
      return;
    }

    const create: MedicationCreateInput = {
      name: draft.name.trim(),
      strength: draft.strength.trim() || undefined,
      form: draft.form,
      dose: draft.dose.trim(),
      timing: draft.timing,
      instructions: draft.instructions.trim() || undefined,
      for_person: draft.for_person.trim() || undefined,
      schedule,
      as_needed: draft.schedule.as_needed,
      stock: draft.stockOn
        ? { count: Number(draft.stockCount), unit: draft.stockUnit, refill_alert_at: draft.refillAt === '' ? null : Number(draft.refillAt) }
        : undefined,
      photos: newPhotos.map((p) => p.url),
    };
    save.mutate(
      { create },
      {
        onSuccess: (m) => {
          const base = m.as_needed ? `${m.name} added` : `${m.name} added — alarms are set`;
          toast.success(m.photo_ids.length ? base : `${base}. Add a photo so every alarm shows the right strip.`, m.photo_ids.length ? undefined : 5000);
          setExit(true);
        },
        onError,
      }
    );
  }

  /* ── Loading / missing (edit mode) ── */
  if (editing && !current) {
    const notFound = medQ.error instanceof ApiError && medQ.error.status === 404;
    return (
      <Screen backdrop="orb">
        <ScreenHeader back backIcon="close" eyebrow="Care · Medicines" title="Edit medicine" large={false} />
        {medQ.isError ? (
          notFound ? (
            <GlassCard padding={spacing.sm}>
              <EmptyState icon="mci:pill-off" title="This medicine isn't here any more" body="It may have been deleted on another device." actionLabel="Back to medicines" onAction={() => router.dismissTo('/medicines')} />
            </GlassCard>
          ) : (
            <ErrorPanel error={medQ.error} onRetry={() => void medQ.refetch()} retrying={medQ.isFetching} />
          )
        ) : (
          <View style={styles.skeletons}>
            <Skeleton height={160} radius={radii.lg} />
            <Skeleton height={260} radius={radii.lg} />
            <Skeleton height={320} radius={radii.lg} />
          </View>
        )}
      </Screen>
    );
  }

  const autoRefill = draft.stockOn
    ? refillThreshold({
        stock: { count: 0, unit: draft.stockUnit },
        as_needed: draft.schedule.as_needed,
        schedule: {
          times: draft.schedule.times,
          days: draft.schedule.repeat === 'weekdays' ? draft.schedule.days : [],
          start_date: today,
          every_n_days: draft.schedule.repeat === 'interval' ? Number(draft.schedule.every_n_days) || 1 : 1,
        },
      })
    : 0;
  const saveLabel = editing ? 'Save changes' : draft.schedule.as_needed ? 'Add medicine' : 'Add & set alarms';

  return (
    <Screen
      keyboard
      backdrop="orb"
      footer={
        <View style={styles.footer}>
          <Button label="Cancel" variant="ghost" onPress={() => navigation.goBack()} disabled={saving} />
          <Button label={saveLabel} variant="primary" icon={editing ? 'check' : 'bell'} loading={saving} disabled={photoBusy} onPress={submit} style={styles.flex} />
        </View>
      }
    >
      <ScreenHeader
        back
        backIcon="close"
        large={false}
        eyebrow="Care · Medicines"
        title={editing ? `Edit ${current?.name ?? 'medicine'}` : 'Add a medicine'}
        subtitle={editing ? 'Changes apply to upcoming alarms.' : 'Add a photo so every alarm shows exactly which strip or bottle to take.'}
      />

      {/* Photos */}
      <Section title="Photos" icon="bell">
        <Text variant="small" tone="muted" style={styles.lead}>
          Alarms and notifications show the first photo — handy when strips look alike or someone else gives the medicine.
        </Text>
        {editing && current?.uses_prescription_photo ? (
          <View style={styles.rxNote}>
            <Text variant="caption" color={colors.warning}>
              Showing your prescription for now. Your first pill photo replaces it on alarms.
            </Text>
          </View>
        ) : null}
        <PhotoGrid
          items={photoItems}
          max={shownMax + (editing && current?.uses_prescription_photo ? 1 : 0)}
          busy={photoBusy}
          label={draft.name.trim() || 'Medicine'}
          onAdd={(s) => void addPhotos(s)}
          onRemove={(pid) => void removePhoto(pid)}
          onMakePrimary={(pid) => void makePrimary(pid)}
        />
        <FieldError message={errors.photos} />
      </Section>

      {/* Basics */}
      <Section title="Medicine" icon="mci:pill" delay={40}>
        <View style={styles.fields}>
          <TextField
            label="Medicine name"
            value={draft.name}
            onChangeText={(t) => {
              set({ name: t });
              clearError('name');
            }}
            error={errors.name}
            placeholder="e.g. Metformin, Dolo 650, Thyronorm"
            maxLength={80}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="next"
          />
          <TextField
            label="Strength (optional)"
            value={draft.strength}
            onChangeText={(t) => {
              set({ strength: t });
              clearError('strength');
            }}
            error={errors.strength}
            placeholder="e.g. 500 mg"
            maxLength={40}
            autoCorrect={false}
          />
          <View>
            <Text variant="label" style={styles.label}>
              Form
            </Text>
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Form">
              {FORM_OPTIONS.map((o) => (
                <Chip
                  key={o.value}
                  label={o.label}
                  size="sm"
                  role="radio"
                  selected={draft.form === o.value}
                  onPress={() =>
                    set({
                      form: o.value,
                      dose: draft.doseTouched ? draft.dose : DEFAULT_DOSE[o.value],
                      stockUnit: draft.stockOn ? draft.stockUnit : stockUnitFor(o.value),
                    })
                  }
                />
              ))}
            </View>
          </View>
          <TextField
            label="Dose each time"
            value={draft.dose}
            onChangeText={(t) => {
              set({ dose: t, doseTouched: true });
              clearError('dose');
            }}
            error={errors.dose}
            placeholder="e.g. 1 tablet, ½ tablet, 5 ml"
            maxLength={40}
          />
          <View>
            <Text variant="label" style={styles.label}>
              With food?
            </Text>
            <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="With food?">
              {TIMING_OPTIONS.map((o) => (
                <Chip key={o.value} label={o.label} size="sm" role="radio" selected={draft.timing === o.value} onPress={() => set({ timing: o.value })} />
              ))}
            </View>
          </View>
        </View>
      </Section>

      {/* Schedule */}
      <Section title="Schedule" icon="calendar" delay={80}>
        <ScheduleEditor
          value={draft.schedule}
          onChange={(schedule) => {
            set({ schedule });
            clearError('schedule');
          }}
          today={today}
          error={errors.schedule}
        />
      </Section>

      {/* Stock */}
      <Section title="Track stock" icon="package" delay={120}>
        <View style={styles.switchRow}>
          <Text variant="callout" style={styles.flex}>
            Remind me to refill
          </Text>
          <Switch
            value={draft.stockOn}
            onValueChange={(v) => {
              haptics.select();
              set({ stockOn: v });
              clearError('stock');
            }}
            trackColor={{ true: colors.coral, false: colors.canvas3 }}
            thumbColor={colors.white}
            ios_backgroundColor={colors.canvas3}
            accessibilityLabel="Remind me to refill"
          />
        </View>
        {draft.stockOn ? (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={styles.fields}>
            <View style={styles.row2}>
              <TextField
                label="Left now"
                value={draft.stockCount}
                onChangeText={(t) => {
                  set({ stockCount: t.replace(/[^0-9]/g, ''), stockCountTouched: true });
                  clearError('stock');
                }}
                placeholder="e.g. 30"
                keyboardType="number-pad"
                inputMode="numeric"
                maxLength={5}
                containerStyle={styles.flex}
              />
              <TextField
                label="Alert at"
                value={draft.refillAt}
                onChangeText={(t) => {
                  set({ refillAt: t.replace(/[^0-9]/g, '') });
                  clearError('stock');
                }}
                placeholder={`Auto (${autoRefill})`}
                keyboardType="number-pad"
                inputMode="numeric"
                maxLength={4}
                containerStyle={styles.flex}
              />
            </View>
            <View>
              <Text variant="label" style={styles.label}>
                Unit
              </Text>
              <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="Stock unit">
                {STOCK_UNITS.map((u) => (
                  <Chip key={u} label={u} size="sm" role="radio" selected={draft.stockUnit === u} onPress={() => set({ stockUnit: u })} />
                ))}
              </View>
            </View>
            <Text variant="caption" tone="subtle">
              Goes down by one each time you tap Take. “Refill soon” shows at the alert level — by default about five days of doses.
            </Text>
          </Animated.View>
        ) : null}
        <FieldError message={errors.stock} />
      </Section>

      {/* Who + instructions */}
      <Section title="Details" icon="user" delay={160}>
        <View style={styles.fields}>
          <View>
            <TextField
              label="For (optional)"
              value={draft.for_person}
              onChangeText={(t) => {
                set({ for_person: t });
                clearError('for_person');
              }}
              error={errors.for_person}
              placeholder="e.g. Mom, Papa — leave empty if it's yours"
              maxLength={40}
              autoCapitalize="words"
            />
            {people.length ? (
              <View style={[styles.chips, styles.suggestions]}>
                {people.map((p) => (
                  <Chip key={p} label={p} size="sm" icon="user" selected={draft.for_person.trim() === p} onPress={() => set({ for_person: draft.for_person.trim() === p ? '' : p })} />
                ))}
              </View>
            ) : null}
          </View>
          <TextField
            label="Instructions (optional)"
            value={draft.instructions}
            onChangeText={(t) => {
              set({ instructions: t });
              clearError('instructions');
            }}
            error={errors.instructions}
            placeholder="e.g. Dissolve in half a glass of water. Don't take with milk."
            maxLength={300}
            multiline
            textAlignVertical="top"
            inputStyle={styles.multiline}
          />
        </View>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  section: { marginTop: spacing.lg },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  lead: { marginBottom: spacing.md },
  rxNote: { padding: spacing.sm, borderRadius: radii.sm, backgroundColor: colors.warningBg, marginBottom: spacing.md },
  fields: { gap: spacing.lg },
  label: { marginBottom: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  suggestions: { marginTop: spacing.sm },
  fieldError: { marginTop: spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.xs },
  row2: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  multiline: { minHeight: 88, paddingTop: 14 },
  skeletons: { gap: spacing.lg },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    backgroundColor: 'rgba(251,247,241,0.96)',
  },
});
