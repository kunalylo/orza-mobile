/** Wire types for /api/reminders and /api/integrations (mirrors the website's `components/care/reminders/shared.ts`). */
import type { Schedule } from '@/features/meds/types';

export type { Schedule };

export type ReminderKind = 'meal' | 'water' | 'weight' | 'custom';

export interface ReminderChannels {
  push: boolean;
  whatsapp: boolean;
  calendar: boolean;
}

/** A reminder as the API returns it: the stored document plus its next firing time. */
export interface ReminderView {
  id: string;
  kind: ReminderKind;
  title: string;
  body?: string;
  schedule: Schedule;
  channels: ReminderChannels;
  active: boolean;
  created_at: string;
  updated_at: string;
  /** ISO instant of the next occurrence (null when inactive or the schedule has ended). */
  next_at: string | null;
}

export interface QuietHours {
  start: string;
  end: string;
}

/** GET /api/integrations (also returned by the PUT routes under /api/integrations). */
export interface IntegrationsView {
  push: { configured: boolean; subscriptions: number; public_key: string | null };
  whatsapp: { configured: boolean; mode: 'template' | 'session'; phone: string | null; opt_in: boolean };
  calendar: { feed_url: string | null; external_url_set: boolean };
  health: { token_preview: string | null; last_sync: string | null };
  quiet_hours: QuietHours | null;
  /** Settings → "Gentle reminders". When off, meal / water / weigh-in reminders pause (medicine alarms don't). */
  reminders_enabled: boolean;
  timezone: string;
}

export interface ReminderInput {
  kind: ReminderKind;
  title: string;
  body: string | null;
  schedule: { times: string[]; days: number[] };
  channels: ReminderChannels;
  active: boolean;
}

export interface WhatsAppTestResponse {
  ok: boolean;
  mode?: 'template' | 'session';
  image?: string;
  session_only?: boolean;
}
