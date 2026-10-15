/** Wire types for the calendar API (`/api/calendar/*`) — mirrors the website's `components/care/calendar/types.ts`. */

export type CalendarEventKind = 'medication' | 'reminder' | 'meal' | 'external';

export type DoseEventStatus = 'upcoming' | 'due' | 'taken' | 'skipped' | 'snoozed' | 'missed';

export interface CalendarEvent {
  id: string;
  kind: CalendarEventKind;
  title: string;
  /** Secondary line: dose + timing, reminder message, meal items, event location. */
  subtitle?: string;
  /** Timed events: ISO UTC instant. All-day events: local "YYYY-MM-DD". */
  start: string;
  /** Timed: ISO UTC instant. All-day: exclusive local "YYYY-MM-DD". */
  end?: string;
  all_day: boolean;
  /** Hex colour for the event's dot / accent. */
  color: string;
  /** Website link (alarm page, meal log, reminders) — the app maps it to its own screens. */
  url?: string;
  /** First medicine photo (owner-only URL). */
  photo_url?: string;
  /** Medication doses only. */
  status?: DoseEventStatus;
  /** External events only: false when the event is marked "free". */
  busy?: boolean;
  location?: string;
  /** Meals only. */
  calories?: number;
}

export interface ExternalCalendarState {
  connected: boolean;
  provider?: 'google' | 'apple' | 'outlook' | 'other';
  /** Masked address, e.g. "calendar.google.com/…/basic.ics" — the full secret link is never sent back. */
  url_preview?: string;
  /** Calendar name from the feed (X-WR-CALNAME), when known. */
  name?: string;
  /** Set when the last fetch failed (events from ÖRZA are still returned). */
  error?: string;
}

export interface CalendarFeedLinks {
  feed_url: string;
  webcal_url: string;
}

export interface CalendarStatusResponse {
  tz: string;
  feed: CalendarFeedLinks | null;
  /** True when links point at localhost / a private address — phones can't reach them until deployment. */
  is_local: boolean;
  external: ExternalCalendarState;
}

export interface CalendarEventsResponse {
  from: string;
  to: string;
  tz: string;
  events: CalendarEvent[];
  external: ExternalCalendarState;
}

export type CalendarTokenResponse = CalendarFeedLinks & { is_local: boolean };

export interface ExternalConnectResponse {
  external: ExternalCalendarState;
  /** Events found in the next 30 days (to confirm the link works). */
  upcoming_count: number;
}

/** Colours per source — energy coral for medicines, cyan reminders, amber meals, violet external calendar. */
export const KIND_COLOR: Record<CalendarEventKind, string> = {
  medication: '#FF7A6A',
  reminder: '#0BBEDC',
  meal: '#FFB454',
  external: '#8757F2',
};

export const KIND_LABEL: Record<CalendarEventKind, string> = {
  medication: 'Medicines',
  reminder: 'Reminders',
  meal: 'Meals',
  external: 'Your calendar',
};

/** Largest range `/api/calendar/events` accepts, in days. */
export const MAX_RANGE_DAYS = 62;
