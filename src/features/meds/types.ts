/**
 * Medicines — API shapes (mirrors the web's src/lib/types.ts + src/components/care/meds/shared.ts).
 * Shared with the prescription (rx) and alarm screens.
 */

export type MedForm = 'tablet' | 'capsule' | 'syrup' | 'drops' | 'injection' | 'inhaler' | 'cream' | 'powder' | 'other';
export type DoseTiming = 'before_food' | 'after_food' | 'with_food' | 'empty_stomach' | 'bedtime' | 'any';

/** When a medicine fires. Times are the user's local wall-clock "HH:MM" (24 h) in profile.timezone. */
export interface Schedule {
  times: string[];
  /** 0 = Sunday … 6 = Saturday; empty = every day. */
  days: number[];
  start_date: string; // YYYY-MM-DD
  end_date?: string; // inclusive; omitted = ongoing
  every_n_days?: number; // 2 = alternate days (from start_date)
}

export interface MedStock {
  count: number;
  unit: string;
  refill_alert_at?: number;
}

export interface Medication {
  id: string;
  user_id?: string;
  name: string;
  strength?: string;
  form: MedForm;
  dose: string;
  timing: DoseTiming;
  instructions?: string;
  /** Media ids; the first is shown on alarms. */
  photo_ids: string[];
  schedule: Schedule;
  /** SOS — never alarms. */
  as_needed: boolean;
  active: boolean;
  stock?: MedStock;
  prescription_id?: string;
  for_person?: string;
  created_at: string;
  updated_at: string;
}

export type MedicationClient = Medication & {
  /** Protected photo URLs, same order as `photo_ids` — show with `mediaSource(url)`. */
  photo_urls: string[];
  /** Created from a prescription and still showing only the prescription photo. */
  uses_prescription_photo?: boolean;
};

export type DoseStatusView = 'upcoming' | 'due' | 'taken' | 'skipped' | 'snoozed' | 'missed';
export type DoseAction = 'take' | 'skip' | 'snooze';

export interface DoseItem {
  medication_id: string;
  name: string;
  strength?: string;
  dose: string;
  timing: DoseTiming;
  form: MedForm;
  instructions?: string;
  photo_urls: string[];
  scheduled_for: string; // ISO UTC
  local_date: string;
  local_time: string; // HH:MM
  status: DoseStatusView;
  snooze_until?: string;
  acted_at?: string;
  for_person?: string;
}

export interface DoseLog {
  id: string;
  medication_id: string;
  scheduled_for: string;
  local_date: string;
  local_time: string;
  status: 'taken' | 'skipped' | 'snoozed' | 'missed';
  acted_at?: string;
  snooze_until?: string;
  created_at: string;
}

export interface TodayResponse {
  date: string;
  now: string;
  doses: DoseItem[];
}

export interface DueResponse {
  now: string;
  doses: DoseItem[];
  next?: DoseItem | null;
}

export interface Tally {
  scheduled: number;
  taken: number;
  skipped: number;
  missed: number;
  pending: number;
  upcoming: number;
  total: number;
  rate: number | null;
}

export type AdherenceDay = Tally & { date: string };
export type AdherenceMedicine = Tally & {
  medication_id: string;
  name: string;
  strength?: string;
  for_person?: string;
  photo_url: string | null;
};

export interface AdherenceResponse {
  days: number;
  from: string;
  to: string;
  overall: Tally;
  daily: AdherenceDay[];
  medicines: AdherenceMedicine[];
}

/** POST /api/meds body. */
export interface MedicationCreateInput {
  name: string;
  strength?: string;
  form: MedForm;
  dose: string;
  timing: DoseTiming;
  instructions?: string;
  schedule: Schedule;
  as_needed: boolean;
  stock?: { count: number; unit: string; refill_alert_at?: number | null };
  for_person?: string;
  /** data:image/jpeg;base64,… (≤ 4). */
  photos?: string[];
}

/** PATCH /api/meds/[id] body (partial; null clears). */
export interface MedicationPatchInput {
  name?: string;
  strength?: string | null;
  form?: MedForm;
  dose?: string;
  timing?: DoseTiming;
  instructions?: string | null;
  schedule?: Partial<Omit<Schedule, 'end_date' | 'every_n_days'>> & { end_date?: string | null; every_n_days?: number | null };
  as_needed?: boolean;
  active?: boolean;
  stock?: { count: number; unit: string; refill_alert_at?: number | null } | null;
  for_person?: string | null;
  primary_photo_id?: string;
}

export type PersonFilter = 'all' | 'me' | (string & {});
