/**
 * Alarm planner — PURE. Turns the member's medicines, dose logs, reminders and settings into the alarms this phone
 * must ring over the next days, mirroring the website's dispatcher (`src/lib/care/dispatch.ts` collectOutgoing):
 *
 * - Medicine doses: active, non-SOS medicines; every scheduled occurrence (profile timezone) that hasn't been acted on
 *   (any dose log — taken / skipped / snoozed — counts as acted). Occurrences from before the medicine was added
 *   (more than 30 min before `created_at`) never ring. All medicines due at the same minute share ONE alarm.
 * - Snoozed doses re-ring at `snooze_until`.
 * - Quiet hours suppress doses, snoozes and reminders (they are not delivered later) — the suppressed doses are returned
 *   so the app can warn about them.
 * - Reminders: only while "Gentle reminders" is on, for active reminders with the push channel.
 * - Refill alerts: once per local day while stock ≤ the refill threshold, daytime only (08:00–21:00), waiting for quiet
 *   hours to end.
 *
 * Only future instants are planned — an alarm that already rang is never re-rung by a later plan.
 * No React Native imports: the tests run this file in Node (`npm run test:alarms`).
 */
import {
  addDays,
  isHHMM,
  isQuietAt,
  occurrencesBetween,
  safeTimeZone,
  utcToZoned,
  validQuietHours,
  zonedToUtc,
  type QuietHours,
} from './schedule';
import {
  deepLinkFor,
  doseAlarmKey,
  isoOf,
  refillAlarmKey,
  reminderAlarmKey,
  snoozeAlarmKey,
  type AlarmDose,
  type AlarmPlanItem,
  type PendingDoseAction,
  type PhotoRef,
  type PlanDoseState,
  type PlanMedication,
  type PlanReminder,
  type QuietDose,
} from './types';

/* ───────────────────────────── Constants ───────────────────────────── */

export const MAX_HORIZON_DAYS = 7;
export const DEFAULT_MAX_ITEMS = 500;
/** Doses scheduled this long before the medicine was added are not the member's to take (web `dosesBetween`). */
export const CREATED_GRACE_MS = 30 * 60_000;
/** Refill alerts only during the day (member's local time), like the web's `REFILL_WINDOW`. */
export const REFILL_WINDOW = { from: '08:00', to: '21:00' } as const;
/** Refill alerts are planned for today and tomorrow; later days are planned by later syncs. */
export const REFILL_DAYS = 2;
/** When the stock runs low after 08:00, today's refill alert goes out this long after the plan. */
export const REFILL_SOON_MS = 60_000;
/** Alarms of the last hours whose doses are all handled are reported so a shown notification can be removed. */
export const SETTLE_LOOKBACK_MS = 12 * 3_600_000;
export const PHOTOS_PER_MEDICINE = 2;
export const DEFAULT_SNOOZE_MINUTES = 10;
/** When doses and reminders compete for the cap, reminders / refills keep at least this share of it. */
export const NON_RING_SHARE = 0.25;

/* Texts — same wording as the website (components/care/reminders/shared.ts). */
const TIMING_TEXT: Record<string, string> = {
  before_food: 'before food',
  after_food: 'after food',
  with_food: 'with food',
  empty_stomach: 'on an empty stomach',
  bedtime: 'at bedtime',
  any: '',
};
const KIND_EMOJI: Record<string, string> = { meal: '🍽️', water: '💧', weight: '⚖️', custom: '🔔' };
const KIND_DEFAULT_BODY: Record<string, string> = {
  meal: 'Snap it, say it or type it — logging takes a few seconds.',
  water: 'A glass now keeps your energy steady.',
  weight: "Step on the scale and log today's weight.",
  custom: 'A gentle nudge from ÖRZA.',
};
/** Where a reminder opens (the app's version of the web's `REMINDER_URL`). */
const REMINDER_PATH: Record<string, string> = { meal: '/meals', water: '/', weight: '/goals', custom: '/reminders' };

/* ───────────────────────────── Inputs / outputs ───────────────────────────── */

export interface PlanInput {
  /** Epoch ms. */
  now: number;
  /** Member's profile timezone (IANA). */
  tz: string;
  /** Every medicine (paused ones are ignored). */
  meds: PlanMedication[];
  /** Dose states (`/api/meds/today` doses) for the days in range — only acted ones matter. */
  doseStates?: PlanDoseState[];
  /** Actions pressed on alarms that haven't reached the server yet (they win over `doseStates`). */
  pending?: PendingDoseAction[];
  reminders?: PlanReminder[];
  /** Settings → "Gentle reminders" (`preferences.reminders !== false`). Default true. */
  remindersEnabled?: boolean;
  quietHours?: QuietHours | null;
  /** Days ahead to plan (1–7, default 7). */
  horizonDays?: number;
  /** Cap on the number of alarms (iOS keeps 64 pending notifications; its adapter passes ~60). */
  maxItems?: number;
  /** Refill keys already delivered (`refill:<medId>:<date>`), so today's alert isn't repeated. */
  refillDelivered?: Iterable<string>;
}

export interface AlarmPlan {
  /** Sorted by time, then key. */
  items: AlarmPlanItem[];
  /** Doses (and snoozes) inside quiet hours — they won't ring. */
  quietDoses: QuietDose[];
  /** Reminder occurrences inside quiet hours. */
  quietReminders: number;
  /** Items left out by the cap. */
  dropped: number;
  /** Every alarm due before this instant is in `items` (= `horizonEnd` unless the cap cut the plan). Epoch ms. */
  coveredUntil: number;
  horizonEnd: number;
  /** Keys of recent alarms whose doses are all handled — remove the notification if it's still showing. */
  settledKeys: string[];
}

/* ───────────────────────────── Helpers ───────────────────────────── */

export function medicineLabel(m: { name: string; strength?: string | null }): string {
  return [m.name?.trim(), m.strength?.trim()].filter(Boolean).join(' ');
}

/** "1 tablet · after food · for Mom" */
export function doseLine(m: { dose?: string | null; timing?: string | null; for_person?: string | null }): string {
  return [m.dose?.trim(), m.timing ? TIMING_TEXT[m.timing] || '' : '', m.for_person?.trim() ? `for ${m.for_person.trim()}` : '']
    .filter(Boolean)
    .join(' · ');
}

/** "08:30" → "8:30 am" */
export function time12(hhmm: string): string {
  if (!isHHMM(hhmm)) return hhmm;
  const h = Number(hhmm.slice(0, 2));
  return `${h % 12 === 0 ? 12 : h % 12}:${hhmm.slice(3)} ${h >= 12 ? 'pm' : 'am'}`;
}

function photoRefsOf(m: PlanMedication): PhotoRef[] {
  const ids = m.photo_ids ?? [];
  const urls = m.photo_urls ?? [];
  const out: PhotoRef[] = [];
  for (let i = 0; i < ids.length && out.length < PHOTOS_PER_MEDICINE; i++) {
    const id = ids[i];
    if (!id) continue;
    out.push({ id, url: urls[i] || `/api/media/${encodeURIComponent(id)}` });
  }
  return out;
}

interface DoseState {
  acted: boolean;
  /** Taken or skipped. */
  finished: boolean;
  snoozeUntil?: number;
}

const stateKey = (medId: string, at: string | number) => `${medId}|${typeof at === 'number' ? at : Date.parse(at)}`;

function buildStates(logs: PlanDoseState[], pending: PendingDoseAction[]): Map<string, DoseState & { medId: string; scheduledFor: string }> {
  const map = new Map<string, DoseState & { medId: string; scheduledFor: string }>();
  for (const l of logs) {
    if (!l?.medication_id || !l.scheduled_for || !Number.isFinite(Date.parse(l.scheduled_for))) continue;
    const finished = l.status === 'taken' || l.status === 'skipped';
    const acted = finished || l.status === 'snoozed' || !!l.acted_at;
    if (!acted) continue;
    const until = l.snooze_until ? Date.parse(l.snooze_until) : NaN;
    map.set(stateKey(l.medication_id, l.scheduled_for), {
      medId: l.medication_id,
      scheduledFor: isoOf(l.scheduled_for),
      acted,
      finished,
      snoozeUntil: !finished && Number.isFinite(until) ? until : undefined,
    });
  }
  // Pending actions are newer than anything the server returned.
  for (const p of pending) {
    if (!p?.medId || !Number.isFinite(Date.parse(p.scheduledFor))) continue;
    const snooze = p.action === 'snooze';
    map.set(stateKey(p.medId, p.scheduledFor), {
      medId: p.medId,
      scheduledFor: isoOf(p.scheduledFor),
      acted: true,
      finished: !snooze,
      snoozeUntil: snooze ? p.createdAt + Math.min(60, Math.max(5, p.snoozeMinutes ?? DEFAULT_SNOOZE_MINUTES)) * 60_000 : undefined,
    });
  }
  return map;
}

/** Scheduled occurrences of a medicine in [from, to), minus those from before it was added. */
function medOccurrences(m: PlanMedication, from: number, to: number, tz: string) {
  const since = m.created_at ? Date.parse(m.created_at) - CREATED_GRACE_MS : NaN;
  return occurrencesBetween(m.schedule, new Date(from), new Date(to), tz).filter((o) => !Number.isFinite(since) || o.at.getTime() >= since);
}

function toAlarmDose(m: PlanMedication, scheduledFor: string, localTime: string, snoozed: boolean): AlarmDose {
  const refs = photoRefsOf(m);
  return {
    medId: m.id,
    scheduledFor,
    name: m.name,
    ...(m.strength ? { strength: m.strength } : {}),
    ...(m.dose ? { dose: m.dose } : {}),
    ...(m.timing ? { timing: m.timing } : {}),
    ...(m.for_person?.trim() ? { forPerson: m.for_person.trim() } : {}),
    ...(m.instructions?.trim() ? { instructions: m.instructions.trim() } : {}),
    label: medicineLabel(m),
    line: doseLine(m),
    localTime,
    photoUrls: refs.map((r) => r.url),
    photoRefs: refs,
    photos: [],
    ...(snoozed ? { snoozed: true } : {}),
  };
}

/** Each medicine's first photo, then their second ones (so a group alarm shows every medicine early). */
function groupPhotoRefs(doses: AlarmDose[]): PhotoRef[] {
  const out: PhotoRef[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < PHOTOS_PER_MEDICINE; i++) {
    for (const d of doses) {
      const ref = d.photoRefs[i];
      if (ref && !seen.has(ref.id)) {
        seen.add(ref.id);
        out.push(ref);
      }
    }
  }
  return out;
}

function doseItem(key: string, at: number, doses: AlarmDose[], meds: Map<string, PlanMedication>, path: string): AlarmPlanItem {
  const sorted = [...doses].sort((a, b) => a.name.localeCompare(b.name) || a.medId.localeCompare(b.medId));
  let title: string;
  let body: string;
  if (sorted.length === 1) {
    const d = sorted[0];
    const m = meds.get(d.medId);
    title = `💊 Time for ${d.label}`;
    body = d.line || m?.dose || 'Your scheduled dose';
  } else {
    title = `💊 Time for ${sorted.length} medicines`;
    body = sorted.map((d) => d.label).join(', ');
  }
  return {
    key,
    kind: 'dose',
    at,
    title,
    body,
    doses: sorted,
    photoRefs: groupPhotoRefs(sorted),
    photos: [],
    path,
    deepLink: deepLinkFor(path),
    ring: true,
  };
}

const alarmPath = (scheduledFor: string, medId?: string) =>
  `/alarm?at=${encodeURIComponent(scheduledFor)}${medId ? `&med=${encodeURIComponent(medId)}` : ''}`;

const byTime = (a: AlarmPlanItem, b: AlarmPlanItem) => a.at - b.at || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/* ───────────────────────────── Planner ───────────────────────────── */

export function planAlarms(input: PlanInput): AlarmPlan {
  const now = input.now;
  const tz = safeTimeZone(input.tz);
  const horizonDays = Math.min(MAX_HORIZON_DAYS, Math.max(1, Math.floor(input.horizonDays ?? MAX_HORIZON_DAYS)));
  const horizonEnd = now + horizonDays * 86_400_000;
  const maxItems = Math.max(0, Math.floor(input.maxItems ?? DEFAULT_MAX_ITEMS));
  const quiet = validQuietHours(input.quietHours);
  const from = now + 1; // strictly after now

  const alarmMeds = input.meds.filter((m) => m && m.active !== false && !m.as_needed && m.schedule);
  const medsById = new Map(alarmMeds.map((m) => [m.id, m]));
  const states = buildStates(input.doseStates ?? [], input.pending ?? []);

  const ring: AlarmPlanItem[] = [];
  const other: AlarmPlanItem[] = [];
  const quietDoses: QuietDose[] = [];
  let quietReminders = 0;

  /* 1. Scheduled doses — grouped by instant. */
  const groups = new Map<number, AlarmDose[]>();
  for (const m of alarmMeds) {
    for (const o of medOccurrences(m, from, horizonEnd, tz)) {
      const at = o.at.getTime();
      if (states.get(stateKey(m.id, at))?.acted) continue;
      if (quiet && isQuietAt(quiet, o.at, tz)) {
        quietDoses.push({ medId: m.id, name: m.name, label: medicineLabel(m), scheduledFor: o.iso, at, localTime: o.local_time });
        continue;
      }
      const list = groups.get(at) ?? [];
      list.push(toAlarmDose(m, o.iso, o.local_time, false));
      groups.set(at, list);
    }
  }
  for (const [at, doses] of groups) {
    const iso = new Date(at).toISOString();
    ring.push(doseItem(doseAlarmKey(iso), at, doses, medsById, alarmPath(iso, doses.length === 1 ? doses[0].medId : undefined)));
  }

  /* 2. Snoozed doses — re-ring at the snooze end; doses of one alarm snoozed into the same minute ring together. */
  const snoozeGroups = new Map<string, { at: number; scheduledFor: string; doses: AlarmDose[] }>();
  for (const s of states.values()) {
    if (s.finished || s.snoozeUntil === undefined || s.snoozeUntil <= now || s.snoozeUntil >= horizonEnd) continue;
    const m = medsById.get(s.medId);
    if (!m) continue; // deleted, paused or SOS — never rings
    const localTime = utcToZoned(new Date(s.scheduledFor), tz).time;
    if (quiet && isQuietAt(quiet, new Date(s.snoozeUntil), tz)) {
      quietDoses.push({
        medId: m.id,
        name: m.name,
        label: medicineLabel(m),
        scheduledFor: s.scheduledFor,
        at: s.snoozeUntil,
        localTime: utcToZoned(new Date(s.snoozeUntil), tz).time,
        snoozed: true,
      });
      continue;
    }
    const groupKey = `${s.scheduledFor}|${Math.floor(s.snoozeUntil / 60_000)}`;
    const g = snoozeGroups.get(groupKey) ?? { at: 0, scheduledFor: s.scheduledFor, doses: [] };
    g.at = Math.max(g.at, s.snoozeUntil); // the last snooze end of the minute, so none rings early
    g.doses.push(toAlarmDose(m, s.scheduledFor, localTime, true));
    snoozeGroups.set(groupKey, g);
  }
  const usedKeys = new Set<string>();
  for (const g of [...snoozeGroups.values()].sort((a, b) => a.at - b.at)) {
    let key = snoozeAlarmKey(
      g.scheduledFor,
      g.doses.map((d) => d.medId)
    );
    if (usedKeys.has(key)) key = `${key}:${new Date(g.at).toISOString()}`;
    usedKeys.add(key);
    const item = doseItem(key, g.at, g.doses, medsById, alarmPath(g.scheduledFor, g.doses.length === 1 ? g.doses[0].medId : undefined));
    if (g.doses.length === 1) item.body = `${item.body} · snoozed from ${time12(g.doses[0].localTime)}`;
    ring.push(item);
  }

  /* 3. Reminders. */
  if (input.remindersEnabled !== false) {
    for (const r of input.reminders ?? []) {
      if (!r || r.active === false || !r.channels?.push || !r.schedule) continue;
      for (const o of occurrencesBetween(r.schedule, new Date(from), new Date(horizonEnd), tz)) {
        if (quiet && isQuietAt(quiet, o.at, tz)) {
          quietReminders++;
          continue;
        }
        const path = REMINDER_PATH[r.kind] || REMINDER_PATH.custom;
        other.push({
          key: reminderAlarmKey(r.id, o.iso),
          kind: 'reminder',
          at: o.at.getTime(),
          title: `${KIND_EMOJI[r.kind] || KIND_EMOJI.custom} ${r.title}`,
          body: r.body?.trim() || KIND_DEFAULT_BODY[r.kind] || KIND_DEFAULT_BODY.custom,
          photoRefs: [],
          photos: [],
          path,
          deepLink: deepLinkFor(path),
          ring: false,
          reminder: { id: r.id, kind: r.kind },
        });
      }
    }
  }

  /* 4. Refill alerts — once per local day, daytime only, after quiet hours. */
  const delivered = new Set(input.refillDelivered ?? []);
  const today = utcToZoned(new Date(now), tz).date;
  for (const m of input.meds) {
    if (!m || m.active === false) continue;
    const s = m.stock;
    if (!s || typeof s.count !== 'number' || typeof s.refill_alert_at !== 'number' || s.count > s.refill_alert_at) continue;
    for (let i = 0; i < Math.min(REFILL_DAYS, horizonDays + 1); i++) {
      const date = addDays(today, i);
      const key = refillAlarmKey(m.id, date);
      if (delivered.has(key)) continue;
      const at = refillTime(date, i === 0 ? now : null, quiet, tz);
      if (at === null || at <= now || at >= horizonEnd) continue;
      const label = medicineLabel(m);
      const count = Math.max(0, Math.floor(s.count));
      const unit = s.unit?.trim() || 'doses';
      const who = m.for_person?.trim() ? ` (for ${m.for_person.trim()})` : '';
      const path = `/med/${encodeURIComponent(m.id)}`;
      const refs = photoRefsOf(m).slice(0, 1);
      other.push({
        key,
        kind: 'refill',
        at,
        title: count === 0 ? `💊 ${label} has run out` : `💊 Refill ${label} soon`,
        body: count === 0 ? `Your stock${who} is at zero. Reorder today so no dose is missed.` : `Only ${count} ${unit} left${who}. Reorder before you run out.`,
        photoRefs: refs,
        photos: [],
        path,
        deepLink: deepLinkFor(path),
        ring: false,
        medId: m.id,
      });
    }
  }

  /* 5. Cap — doses first, reminders / refills keep a share; everything sorted by time. */
  ring.sort(byTime);
  other.sort(byTime);
  const reserve = Math.min(other.length, Math.floor(maxItems * NON_RING_SHARE));
  const ringKept = ring.slice(0, Math.max(0, maxItems - reserve));
  const otherKept = other.slice(0, Math.max(0, maxItems - ringKept.length));
  const ringCovered = ring.length > ringKept.length ? ring[ringKept.length].at : horizonEnd;
  const otherCovered = other.length > otherKept.length ? other[otherKept.length].at : horizonEnd;
  const items = [...ringKept, ...otherKept].sort(byTime);

  return {
    items,
    quietDoses: quietDoses.sort((a, b) => a.at - b.at || a.name.localeCompare(b.name)),
    quietReminders,
    dropped: ring.length + other.length - items.length,
    coveredUntil: Math.min(ringCovered, otherCovered, horizonEnd),
    horizonEnd,
    settledKeys: settledKeys(alarmMeds, states, now, tz),
  };
}

/**
 * When today's / a later day's refill alert goes out (epoch ms), or null when there's no daytime slot that day.
 * `nowForToday` is set for today: the alert can't be earlier than a minute from now.
 */
function refillTime(date: string, nowForToday: number | null, quiet: QuietHours | null, tz: string): number | null {
  let at = zonedToUtc(date, REFILL_WINDOW.from, tz).getTime();
  if (nowForToday !== null && at <= nowForToday) at = nowForToday + REFILL_SOON_MS;
  let local = utcToZoned(new Date(at), tz);
  if (local.date !== date) return null;
  if (quiet && isQuietAt(quiet, new Date(at), tz)) {
    // Overnight window and already past its start: it ends tomorrow — tomorrow has its own alert.
    if (quiet.start > quiet.end && local.time >= quiet.start) return null;
    at = zonedToUtc(date, quiet.end, tz).getTime();
    local = utcToZoned(new Date(at), tz);
    if (local.date !== date) return null;
  }
  if (local.time < REFILL_WINDOW.from || local.time >= REFILL_WINDOW.to) return null;
  return at;
}

/** Alarms of the last hours whose doses are all handled (shown notifications can go). */
function settledKeys(alarmMeds: PlanMedication[], states: Map<string, DoseState>, now: number, tz: string): string[] {
  const byInstant = new Map<number, { medId: string; state?: DoseState }[]>();
  for (const m of alarmMeds) {
    for (const o of medOccurrences(m, now - SETTLE_LOOKBACK_MS, now + 1, tz)) {
      const at = o.at.getTime();
      const list = byInstant.get(at) ?? [];
      list.push({ medId: m.id, state: states.get(stateKey(m.id, at)) });
      byInstant.set(at, list);
    }
  }
  const keys: string[] = [];
  for (const [at, list] of [...byInstant].sort((a, b) => a[0] - b[0])) {
    const iso = new Date(at).toISOString();
    if (list.every((d) => d.state?.acted)) keys.push(doseAlarmKey(iso));
    const finished = list.filter((d) => d.state?.finished);
    for (const d of finished) keys.push(snoozeAlarmKey(iso, [d.medId]));
    if (list.length > 1 && finished.length === list.length) keys.push(snoozeAlarmKey(iso, list.map((d) => d.medId)));
  }
  return keys;
}

/* ───────────────────────────── Hash ───────────────────────────── */

/** Stable fingerprint of what would be scheduled (sync skips re-scheduling an identical plan). */
export function planHash(items: AlarmPlanItem[]): string {
  const text = JSON.stringify(
    items.map((i) => [
      i.key,
      i.at,
      i.title,
      i.body,
      i.ring,
      i.deepLink,
      i.photos,
      (i.doses ?? []).map((d) => [d.medId, d.scheduledFor, d.label, d.line, d.instructions ?? '', d.photos, d.snoozed ? 1 : 0]),
    ])
  );
  // FNV-1a, 2 × 32 bit (different seeds) — collisions are practically impossible for this use.
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}:${items.length}`;
}
