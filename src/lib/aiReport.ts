/**
 * Reporting ÖRZA's AI output inside the app (`docs/notes/ai-report.md`; Google Play AI-Generated Content): a Report
 * action on each AI output the member was shown, a sheet with one reason and an optional note, `POST /api/ai/reports`.
 *
 * Pure (types only), so `npm run test:report` loads it in Node:
 * - where the app shows Report (`canReport*`, §2 and §8): every Ask ÖRZA reply, AI recipes, AI rebalance plans, the
 *   Snap result before Save, a typed or spoken meal the AI read;
 * - the request body (`reportBody`, §3) and its answer (`isReportAnswer`);
 * - an old server without the endpoint (`isReportUnavailable`), duck-typed on `{status, code}`;
 * - the items reported during this visit (`createReportedSet`): their trigger says "Reported";
 * - every string the trigger, the sheet and the toast show (§5, the website's words; the user reviews them).
 *
 * A report needs no AI consent (nothing goes to OpenAI), so `/ai/reports` is not one of `aiConsent.AI_PATHS`.
 */

/** Same lists as the server (`web:src/lib/ai-report-shared.ts`). */
export const AI_REPORT_KINDS = ['chat', 'recipe', 'rebalance', 'scan', 'meal'] as const;
export type AiReportKind = (typeof AI_REPORT_KINDS)[number];

export const AI_REPORT_REASONS = ['offensive', 'unsafe', 'wrong', 'other'] as const;
export type AiReportReason = (typeof AI_REPORT_REASONS)[number];

/** The optional note, in characters after trimming. */
export const AI_REPORT_NOTE_MAX = 500;

export const AI_REPORT_PATH = '/ai/reports';

/* ───────────────────────────── Copy (§5) ───────────────────────────── */

/** In the order the sheet lists them. */
export const REPORT_REASONS: { value: AiReportReason; label: string }[] = [
  { value: 'offensive', label: 'Offensive or hurtful' },
  { value: 'unsafe', label: 'Unsafe advice' },
  { value: 'wrong', label: 'Wrong or misleading' },
  { value: 'other', label: 'Something else' },
];

/** What the member reports, as the sheet names it ("this reply"). */
const THING: Record<AiReportKind, string> = {
  chat: 'reply',
  recipe: 'recipe',
  rebalance: 'plan',
  scan: 'result',
  meal: 'result',
};

/** Offline and server errors show the API client's and the server's own text. */
export const REPORT_COPY = {
  trigger: 'Report',
  reported: 'Reported',
  /** The trigger's screen-reader name once this visit sent a report. */
  reportedLabel: 'Reported. Change your report',
  lead: 'Tell the ÖRZA team what’s wrong. We use reports to make ÖRZA’s AI safer.',
  question: 'What’s wrong?',
  noteLabel: 'Anything to add? (optional)',
  send: 'Send report',
  cancel: 'Cancel',
  /** The toast: the website's "Report sent" and the line under it, in one. */
  sent: 'Report sent. Thanks. The ÖRZA team will review it.',
  /** An older server, without the endpoint. */
  unavailable: 'Reporting isn’t available yet. Please try again later.',
  /** Long press on an Ask ÖRZA reply. */
  copyReply: 'Copy reply',
  replyOptions: 'Reply options',
} as const;

/** "Report this reply": the sheet's title and the trigger's screen-reader name. */
export const reportTitle = (kind: AiReportKind) => `Report this ${THING[kind]}`;

/** Under the note: what the team will see. */
export const reportHint = (kind: AiReportKind) => `The team sees this ${THING[kind]} with your report.`;

export const reportTriggerLabel = (kind: AiReportKind, reported: boolean) => (reported ? REPORT_COPY.reportedLabel : reportTitle(kind));

/** The note's counter ("0/500") and how a screen reader says it. */
export function noteCounter(note: string): { text: string; label: string } {
  return { text: `${note.length}/${AI_REPORT_NOTE_MAX}`, label: `${note.length} of ${AI_REPORT_NOTE_MAX} characters` };
}

/* ───────────────────────────── Where Report shows (§2, §8) ───────────────────────────── */

/**
 * An ÖRZA reply the server stored: every one, the built-in coach's too (they look the same). Not a local message still
 * sending or failed (`tmp-` ids are the app's own).
 */
export function canReportChat(m: { role: string; id: string; status?: string }): boolean {
  return m.role === 'assistant' && !m.status && !!m.id && !m.id.startsWith('tmp-');
}

/** A recipe the AI wrote (labelled "Created by ÖRZA AI"); the server accepts curated ones too, the apps don't offer it. */
export const canReportRecipe = (r: { source?: string }) => r.source === 'ai';

/** An AI-personalised plan; the built-in plan is the app's own rules. */
export const canReportPlan = (p: { ai?: boolean }) => p.ai === true;

/** A typed or spoken meal the AI read (its card says "AI estimate"); the built-in food list only matches what was typed. */
export function canReportMeal(res: { ai: boolean; meal: { source: string } }): boolean {
  return res.ai && (res.meal.source === 'text' || res.meal.source === 'voice');
}

/* ───────────────────────────── The request (§3) ───────────────────────────── */

export interface AiReportBody {
  kind: AiReportKind;
  ref_id: string;
  reason: AiReportReason;
  /** Left out when empty. */
  note?: string;
}

/** The note as sent: trimmed, at most `AI_REPORT_NOTE_MAX` characters (never half an emoji), empty = none. */
export function reportNote(note: string | null | undefined): string | null {
  let text = String(note ?? '').trim();
  if (text.length > AI_REPORT_NOTE_MAX) {
    text = text.slice(0, AI_REPORT_NOTE_MAX);
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
    text = text.trimEnd();
  }
  return text || null;
}

export function reportBody(kind: AiReportKind, refId: string, reason: AiReportReason, note?: string | null): AiReportBody {
  const text = reportNote(note);
  const body: AiReportBody = { kind, ref_id: refId.trim(), reason };
  if (text) body.note = text;
  return body;
}

/** 201 / 200 `{report: {id, …}}`. Anything else is not a recorded report. */
export function isReportAnswer(res: unknown): boolean {
  const report = res && typeof res === 'object' ? (res as { report?: unknown }).report : null;
  return !!report && typeof report === 'object' && typeof (report as { id?: unknown }).id === 'string' && !!(report as { id: string }).id;
}

type Coded = { status?: unknown; code?: unknown };
const coded = (e: unknown): Coded | null => (e && typeof e === 'object' ? (e as Coded) : null);

/**
 * The server has no `POST /api/ai/reports` (it runs an older version): its 404 is the framework's page, without the
 * route's `not_found` code (that one means the item is gone), or a 405 / 501. The sheet says reporting isn't available.
 */
export function isReportUnavailable(e: unknown): boolean {
  const c = coded(e);
  if (!c) return false;
  return c.status === 405 || c.status === 501 || (c.status === 404 && c.code !== 'not_found');
}

/* ───────────────────────────── Reported this visit ───────────────────────────── */

export const reportKey = (kind: AiReportKind, refId: string) => `${kind}:${refId}`;

export interface ReportedSet {
  has: (kind: AiReportKind, refId: string) => boolean;
  add: (kind: AiReportKind, refId: string) => void;
  /** Another member (or none). */
  clear: () => void;
  subscribe: (listener: () => void) => () => void;
}

/** What this visit reported. There is no member `GET`; reporting again replaces the earlier report. */
export function createReportedSet(): ReportedSet {
  let keys = new Set<string>();
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of [...listeners]) l();
  };
  return {
    has: (kind, refId) => keys.has(reportKey(kind, refId)),
    add: (kind, refId) => {
      const key = reportKey(kind, refId);
      if (keys.has(key)) return;
      keys = new Set(keys).add(key);
      emit();
    },
    clear: () => {
      if (!keys.size) return;
      keys = new Set();
      emit();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
