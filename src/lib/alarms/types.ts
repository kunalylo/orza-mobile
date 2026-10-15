/**
 * Alarm engine types, shared by the planner, the photo cache, the sync orchestrator and the platform adapters
 * (Android native module — C2, iOS notifications — C3).
 *
 * An `AlarmPlanItem` is everything a platform needs to ring / show one alarm without asking the network: the time,
 * texts, the doses with their names and LOCAL photo files, and the deep link to the full-screen alarm screen.
 */
import type { DoseTiming, MedicationClient } from '@/features/meds/types';
import type { ReminderKind, ReminderView } from '@/features/reminders/types';

import type { QuietHours, ScheduleLike } from './schedule';

export type { QuietHours };

export type AlarmKind = 'dose' | 'reminder' | 'refill';

/** A server photo: media id (cache key) + its protected URL (`/api/media/<id>`, shown with the Bearer header). */
export interface PhotoRef {
  id: string;
  url: string;
}

/** One medicine dose inside an alarm. */
export interface AlarmDose {
  medId: string;
  /** ISO UTC instant of the scheduled dose (the dose log id is `<medId>:<scheduledFor>`). */
  scheduledFor: string;
  name: string;
  strength?: string;
  dose?: string;
  timing?: DoseTiming;
  forPerson?: string;
  instructions?: string;
  /** "Metformin 500 mg" */
  label: string;
  /** "1 tablet · after food · for Mom" (may be empty) */
  line: string;
  /** Local wall-clock time of the scheduled dose ("08:00"). */
  localTime: string;
  /** Up to two protected photo URLs (same order as `photoRefs`). */
  photoUrls: string[];
  photoRefs: PhotoRef[];
  /** Local `file://` URIs of the downloaded photos (filled by photos.ts; empty when not downloaded). */
  photos: string[];
  /** This alarm re-rings a snoozed dose. */
  snoozed?: boolean;
}

export interface AlarmPlanItem {
  /**
   * Stable id: `dose:<iso>` (every medicine due at that instant), `snooze:<medId>:<iso>` / `snooze:<iso>` (re-ring of
   * a snoozed dose / several doses of one alarm), `reminder:<id>:<iso>`, `refill:<medId>:<local date>`.
   * Scheduling the same key again replaces the earlier one.
   */
  key: string;
  kind: AlarmKind;
  /** Epoch ms. */
  at: number;
  title: string;
  body: string;
  /** Doses (kind 'dose', also used for snoozes). */
  doses?: AlarmDose[];
  /** Server photos to show (doses: each medicine's first photo first, then their second ones; refill: the medicine's). */
  photoRefs: PhotoRef[];
  /** Local file URIs for `photoRefs` that are downloaded (filled by photos.ts). */
  photos: string[];
  /** In-app route, e.g. `/alarm?at=…&med=…`, `/meals`. */
  path: string;
  /** `orza://alarm?at=<iso>` (+ `&med=` for a single medicine), `orza://meals`, … */
  deepLink: string;
  /** Alarm-style (doses and snoozes: full-screen, sound, stays) vs a gentle notification (reminders, refills). */
  ring: boolean;
  reminder?: { id: string; kind: ReminderKind };
  /** Refill alerts: the medicine. */
  medId?: string;
}

/** A dose that won't ring because it falls inside quiet hours (the screens warn about these). */
export interface QuietDose {
  medId: string;
  name: string;
  label: string;
  scheduledFor: string;
  /** When it would have rung (the snooze end for a snoozed dose). Epoch ms. */
  at: number;
  /** Local "HH:MM" of `at`. */
  localTime: string;
  snoozed?: boolean;
}

/* ───────────────────────────── Planner inputs ───────────────────────────── */

/** The medicine fields the planner reads (a `MedicationClient` fits). */
export type PlanMedication = Pick<MedicationClient, 'id' | 'name' | 'dose'> &
  Partial<Pick<MedicationClient, 'strength' | 'timing' | 'for_person' | 'instructions' | 'photo_ids' | 'photo_urls' | 'stock' | 'created_at'>> & {
    schedule: ScheduleLike;
    as_needed?: boolean;
    active?: boolean;
  };

/** A dose's state from `/api/meds/today` (a `DoseItem` fits). */
export interface PlanDoseState {
  medication_id: string;
  scheduled_for: string;
  status: string;
  snooze_until?: string | null;
  acted_at?: string | null;
}

/** A reminder (a `ReminderView` fits). */
export type PlanReminder = Pick<ReminderView, 'id' | 'kind' | 'title'> & {
  body?: string | null;
  schedule: ScheduleLike;
  channels?: Partial<ReminderView['channels']> | null;
  active?: boolean;
};

export type DoseActionKind = 'take' | 'skip' | 'snooze';

/** An action pressed on an alarm that may not have reached the server yet. */
export interface PendingDoseAction {
  medId: string;
  scheduledFor: string;
  action: DoseActionKind;
  /** Snooze length (default 10). */
  snoozeMinutes?: number;
  /** Epoch ms when it was pressed. */
  createdAt: number;
}

/* ───────────────────────────── Keys ───────────────────────────── */

/** Normalised ISO for any parseable instant (the server's `toISOString()` form). */
export function isoOf(at: string | number | Date): string {
  const t = at instanceof Date ? at.getTime() : typeof at === 'number' ? at : Date.parse(at);
  return Number.isFinite(t) ? new Date(t).toISOString() : String(at);
}

/** Key of the alarm for every medicine due at `scheduledFor`. */
export const doseAlarmKey = (scheduledFor: string) => `dose:${isoOf(scheduledFor)}`;

/**
 * Key of the re-ring of snoozed doses that were scheduled at `scheduledFor`: one medicine → `snooze:<medId>:<iso>`;
 * several medicines of the same alarm snoozed together → `snooze:<iso>`. A native "Snooze" must use this so the next
 * plan replaces it instead of adding a second alarm.
 */
export function snoozeAlarmKey(scheduledFor: string, medIds: string[]): string {
  const iso = isoOf(scheduledFor);
  return medIds.length === 1 ? `snooze:${medIds[0]}:${iso}` : `snooze:${iso}`;
}

export const reminderAlarmKey = (reminderId: string, at: string) => `reminder:${reminderId}:${isoOf(at)}`;
export const refillAlarmKey = (medId: string, localDate: string) => `refill:${medId}:${localDate}`;

/** `orza://alarm?at=…` from an in-app path (`/alarm?at=…`). */
export function deepLinkFor(path: string): string {
  return `orza://${path.replace(/^\/+/, '')}`;
}
