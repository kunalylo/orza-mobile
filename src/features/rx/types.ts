/**
 * Prescriptions — API shapes (mirrors the web's src/lib/types.ts `ExtractedMedicine` / `Prescription` and
 * src/app/api/prescriptions/_shared.ts `prescriptionToClient`).
 */
import type { DoseTiming, MedForm, MedicationClient } from '@/features/meds/types';

/** One medicine read from (or typed off) a prescription. Times are local "HH:MM" alarm times. */
export interface ExtractedMedicine {
  name: string;
  strength?: string;
  form: MedForm;
  dose: string;
  timing: DoseTiming;
  times: string[];
  /** As written: "1-0-1", "BD", "TDS x 5 days". Feeds the repeat rule (weekly, alternate days) on apply. */
  frequency_text: string;
  duration_days?: number;
  /** SOS — never rings. */
  as_needed: boolean;
  instructions?: string;
  /** 0–1; below 0.6 the review flags it as hard to read. */
  confidence?: number;
}

export type PrescriptionStatus = 'review' | 'applied';

export interface PrescriptionClient {
  id: string;
  user_id?: string;
  media_id?: string;
  doctor?: string;
  issued_on?: string;
  notes?: string;
  patient_name?: string;
  medicines: ExtractedMedicine[];
  status: PrescriptionStatus;
  applied_medication_ids?: string[];
  applied_at?: string;
  created_at: string;
  /** Protected photo URL (show with `mediaSource`) or null when no photo was attached. */
  photo_url: string | null;
}

/** POST /api/prescriptions (manual entry). */
export interface ManualPrescriptionInput {
  image?: string;
  doctor?: string;
  issued_on?: string;
  notes?: string;
  medicines?: ExtractedMedicine[];
}

/** POST /api/prescriptions/[id]/apply. */
export interface ApplyInput {
  medicines: ExtractedMedicine[];
  start_date?: string;
  for_person?: string;
}

export interface ApplyResponse {
  medications: MedicationClient[];
  prescription: PrescriptionClient;
}

/** A row of the editable review list. */
export type ReviewRow = ExtractedMedicine & { key: string; include: boolean };
