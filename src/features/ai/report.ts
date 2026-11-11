/**
 * Reporting ÖRZA's AI output (`docs/notes/ai-report.md` §8) — a small store, no React except the hooks.
 *
 * - `openAiReport(kind, refId)`: every Report trigger (`ReportAiButton`, the long press on an Ask ÖRZA reply).
 *   `AiReportHost` (mounted once in the member layout) shows the one sheet. None of the triggers sits inside another
 *   sheet; the reply's long-press menu opens it once the menu has gone.
 * - `sendAiReport(reason, note)`: `POST /api/ai/reports`. No AI consent (nothing goes to OpenAI) and nothing queued: offline
 *   the sheet stays open with the network line. Sent: the sheet closes, a toast thanks the member, and the trigger says
 *   "Reported" for the rest of the visit (`useAiReported`); reporting again replaces the earlier report.
 * - `resetAiReport()`: another member (or a sign-out) closes the sheet, drops an answer still on its way and forgets
 *   what was reported.
 */
import { useSyncExternalStore } from 'react';

import {
  AI_REPORT_PATH,
  REPORT_COPY,
  createReportedSet,
  isReportAnswer,
  isReportUnavailable,
  reportBody,
  type AiReportKind,
  type AiReportReason,
} from '@/lib/aiReport';
import { api, errorMessage } from '@/lib/api';
import { toast } from '@/ui';

const SEND_TIMEOUT_MS = 15_000;

export interface AiReportPrompt {
  visible: boolean;
  kind: AiReportKind;
  refId: string;
  /** Changes with every open: the sheet starts with no reason and no note. */
  openId: number;
  /** The report is on its way: the sheet can't be dismissed meanwhile. */
  sending: boolean;
  /** The last send failed (offline, an older server, a limit): the sheet stays open with this line. */
  error: string | null;
}

let prompt: AiReportPrompt = { visible: false, kind: 'chat', refId: '', openId: 0, sending: false, error: null };
/** Bumped by every open and reset: an answer for an earlier one is dropped. */
let seq = 0;
const reported = createReportedSet();
const listeners = new Set<() => void>();

function emit() {
  for (const l of [...listeners]) l();
}

function setPrompt(patch: Partial<AiReportPrompt>) {
  prompt = { ...prompt, ...patch };
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAiReportPrompt(): AiReportPrompt {
  return useSyncExternalStore(subscribe, () => prompt, () => prompt);
}

/** Reported during this visit: the trigger says "Reported" (and still opens the sheet, to change it). */
export function useAiReported(kind: AiReportKind, refId: string): boolean {
  const read = () => reported.has(kind, refId);
  return useSyncExternalStore(reported.subscribe, read, read);
}

export function openAiReport(kind: AiReportKind, refId: string) {
  if (!refId || prompt.sending) return;
  seq += 1;
  setPrompt({ visible: true, kind, refId, openId: seq, sending: false, error: null });
}

/** Cancel, the backdrop, the close button, a swipe, Android back — not while the report is on its way. */
export function closeAiReport() {
  if (prompt.sending || !prompt.visible) return;
  setPrompt({ visible: false, error: null });
}

export function resetAiReport() {
  seq += 1;
  reported.clear();
  if (prompt.visible || prompt.sending || prompt.error) setPrompt({ visible: false, sending: false, error: null });
}

/** The line in the sheet after a failed send: an older server, else the API client's or the server's own words. */
export function reportErrorLine(e: unknown): string {
  return isReportUnavailable(e) ? REPORT_COPY.unavailable : errorMessage(e);
}

export async function sendAiReport(reason: AiReportReason, note: string): Promise<void> {
  if (!prompt.visible || prompt.sending) return;
  const { kind, refId } = prompt;
  const mine = seq;
  setPrompt({ sending: true, error: null });
  try {
    const res = await api.post<unknown>(AI_REPORT_PATH, reportBody(kind, refId, reason, note), { timeoutMs: SEND_TIMEOUT_MS });
    if (!isReportAnswer(res)) throw new Error('The report was not recorded');
    if (mine !== seq) return;
    reported.add(kind, refId);
    setPrompt({ visible: false, sending: false, error: null });
    toast.success(REPORT_COPY.sent);
  } catch (e) {
    if (mine !== seq) return;
    setPrompt({ sending: false, error: reportErrorLine(e) });
  }
}
