/**
 * The alarm screen without a connection: rebuilds an alarm's doses from the alarm engine's last good data on this phone
 * (`orza-alarms.json` — medicines, the days' dose logs, the member's timezone) with the actions still queued here laid
 * on top, and the downloaded alarm photos (`file://`). Mirrors the server's dose status rules (web
 * `lib/care/meds.ts` doseStatus: snoozed until its end, due up to 60 min late, then missed).
 */
import type { DoseItem, DoseStatusView } from '@/features/meds/types';
import { cachedAlarmPhotoUri } from '@/lib/alarms/photos';
import { DEFAULT_SNOOZE_MINUTES, PHOTOS_PER_MEDICINE } from '@/lib/alarms/plan';
import { pendingDoseActions } from '@/lib/alarms/queue';
import { occurrencesBetween, safeTimeZone } from '@/lib/alarms/schedule';
import { loadAlarmCache } from '@/lib/alarms/store';
import type { PendingDoseAction, PlanDoseState, PlanMedication } from '@/lib/alarms/types';

const MISSED_AFTER_MS = 60 * 60_000;
/** "Everything due now" looks this far back for open doses. */
const DUE_LOOKBACK_MS = 3 * 3_600_000;

export interface OfflineAlarm {
  mode: 'at' | 'due';
  now: string;
  doses: DoseItem[];
  tz: string;
}

const sameInstant = (a: string, b: string) => Date.parse(a) === Date.parse(b);

function photosOf(m: PlanMedication): string[] {
  const ids = (m.photo_ids ?? []).slice(0, PHOTOS_PER_MEDICINE);
  const urls = m.photo_urls ?? [];
  // The downloaded copy first (works offline); the server URL may still be in the image cache.
  return ids.map((id, i) => cachedAlarmPhotoUri(id) ?? urls[i] ?? '').filter(Boolean);
}

function statusOf(at: number, log: PlanDoseState | undefined, pending: PendingDoseAction | undefined, now: number): Pick<DoseItem, 'status' | 'snooze_until' | 'acted_at'> {
  if (pending) {
    const acted_at = new Date(pending.createdAt).toISOString();
    if (pending.action === 'take') return { status: 'taken', acted_at };
    if (pending.action === 'skip') return { status: 'skipped', acted_at };
    const until = pending.createdAt + Math.min(60, Math.max(5, pending.snoozeMinutes ?? DEFAULT_SNOOZE_MINUTES)) * 60_000;
    if (until > now) return { status: 'snoozed', snooze_until: new Date(until).toISOString(), acted_at };
  } else if (log) {
    if (log.status === 'taken' || log.status === 'skipped') return { status: log.status, ...(log.acted_at ? { acted_at: log.acted_at } : {}) };
    if (log.status === 'snoozed' && log.snooze_until && Date.parse(log.snooze_until) > now) {
      return { status: 'snoozed', snooze_until: log.snooze_until, ...(log.acted_at ? { acted_at: log.acted_at } : {}) };
    }
  }
  const status: DoseStatusView = at > now ? 'upcoming' : now - at <= MISSED_AFTER_MS ? 'due' : 'missed';
  return { status };
}

/**
 * The doses of the alarm at `at` (or, without one, the open doses of the last few hours) from the data on this phone;
 * null when there's none (never synced, another account).
 */
export function offlineAlarm(userId: string, at: string | null, now = Date.now()): OfflineAlarm | null {
  const cache = loadAlarmCache(userId);
  const meds = cache.meds?.list;
  if (!meds?.length) return null;
  const tz = safeTimeZone(cache.settings?.tz);
  const instant = at ? Date.parse(at) : NaN;
  const mode: OfflineAlarm['mode'] = Number.isFinite(instant) ? 'at' : 'due';
  const from = mode === 'at' ? instant : now - DUE_LOOKBACK_MS;
  const to = mode === 'at' ? instant + 1 : now + 1;
  const pending = pendingDoseActions(userId);

  const doses: DoseItem[] = [];
  for (const m of meds) {
    if (!m || m.active === false || m.as_needed || !m.schedule) continue;
    for (const o of occurrencesBetween(m.schedule, new Date(from), new Date(to), tz)) {
      const log = cache.days[o.local_date]?.doses.find((d) => d.medication_id === m.id && sameInstant(d.scheduled_for, o.iso));
      const queued = pending.find((p) => p.medId === m.id && sameInstant(p.scheduledFor, o.iso));
      const state = statusOf(o.at.getTime(), log, queued, now);
      if (mode === 'due' && (state.status === 'taken' || state.status === 'skipped' || state.status === 'upcoming' || state.status === 'snoozed')) continue;
      doses.push({
        medication_id: m.id,
        name: m.name,
        ...(m.strength ? { strength: m.strength } : {}),
        dose: m.dose,
        timing: m.timing ?? 'any',
        form: m.form ?? 'tablet',
        ...(m.instructions ? { instructions: m.instructions } : {}),
        ...(m.for_person ? { for_person: m.for_person } : {}),
        photo_urls: photosOf(m),
        scheduled_for: o.iso,
        local_date: o.local_date,
        local_time: o.local_time,
        ...state,
      });
    }
  }
  return { mode, now: new Date(now).toISOString(), doses, tz };
}
