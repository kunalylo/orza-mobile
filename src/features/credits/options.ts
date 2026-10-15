/** Credit action rows, transaction labels and formatting (same wording as the web's `src/components/account/options.ts`). */
import type { IconName } from '@/ui';

import type { CreditAction, CreditTransaction } from './types';

/** Longest note a member can add to a "Request more credits" message. */
export const CREDIT_REQUEST_MESSAGE_MAX = 800;

/** Rows of the "What costs credits" list, in display order. */
export const CREDIT_ACTION_ROWS: { key: CreditAction; label: string; hint: string }[] = [
  { key: 'scan', label: 'Scan a meal photo', hint: 'Snap & Know identifies every item on your plate' },
  { key: 'meal_text', label: 'Log a meal with AI', hint: 'Type or speak it — English, Hindi or Hinglish' },
  { key: 'chat', label: 'Chat message', hint: 'Ask ÖRZA anything about food and habits' },
  { key: 'recipe', label: 'Generate a recipe', hint: 'Personalised to your diet and targets' },
  { key: 'compensation', label: 'Rebalance plan', hint: 'A kind plan after a special meal' },
];

export const FALLBACK_COSTS: Record<CreditAction, number> = { scan: 2, meal_text: 1, chat: 1, recipe: 2, compensation: 1, report_insight: 1 };

export const ACTION_ICONS: Record<CreditAction, IconName> = {
  scan: 'camera',
  meal_text: 'edit-3',
  chat: 'message-circle',
  recipe: 'mci:chef-hat',
  compensation: 'mci:hand-heart-outline',
  report_insight: 'shield',
};

export const ACTION_TONES: Record<CreditAction, { bg: string; fg: string }> = {
  scan: { bg: '#FFF1EA', fg: '#C2410C' },
  meal_text: { bg: '#E8FBFF', fg: '#0A6F82' },
  chat: { bg: '#F4F1FF', fg: '#6E3ED6' },
  recipe: { bg: '#FFF1EA', fg: '#C2410C' },
  compensation: { bg: 'rgba(255,255,255,0.8)', fg: '#5B5B5B' },
  report_insight: { bg: 'rgba(255,255,255,0.8)', fg: '#5B5B5B' },
};

const ACTION_LABELS: Record<CreditAction, string> = {
  scan: 'Meal photo scan',
  meal_text: 'AI meal log',
  chat: 'Chat message',
  recipe: 'Recipe generated',
  compensation: 'Rebalance plan',
  report_insight: 'Report insight',
};

const CREDIT_ACTIONS = new Set<string>(Object.keys(ACTION_LABELS));

/** A known credit action key (own keys only — never `constructor`, `toString` …). */
export const isCreditAction = (v: unknown): v is CreditAction => typeof v === 'string' && CREDIT_ACTIONS.has(v);

/** Friendly label for a stored transaction reason ("chat", "Refund: scan", "Welcome credits" …). */
export function transactionLabel(reason: string): string {
  const r = (reason || '').trim();
  if (!r) return 'Credit update';
  const refund = r.match(/^refund:\s*(.+)$/i);
  if (refund) {
    const what = refund[1].trim();
    return `Refund · ${isCreditAction(what) ? ACTION_LABELS[what] : what}`;
  }
  return isCreditAction(r) ? ACTION_LABELS[r] : r;
}

/**
 * The credit action a transaction is for: the server's `action` when it recorded one (every spend and refund
 * does), otherwise read from the reason ("Ask ÖRZA", "Snap & Know scan", "Refund: Recipe — …") for older rows.
 */
export function transactionAction(tx: Pick<CreditTransaction, 'reason' | 'action'>): CreditAction | null {
  if (isCreditAction(tx.action)) return tx.action;
  const r = (tx.reason || '').replace(/^refund:\s*/i, '').trim().toLowerCase();
  if (isCreditAction(r)) return r;
  if (r.startsWith('rebalance')) return 'compensation';
  if (r.startsWith('ask')) return 'chat';
  if (r.includes('scan') || r.includes('photo')) return 'scan';
  if (r.includes('recipe')) return 'recipe';
  if (r.includes('chat')) return 'chat';
  if (r.includes('meal')) return 'meal_text';
  return null;
}

export const isRefund = (reason: string) => /^refund:/i.test(reason || '');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "24 Sep 2026, 8:05 pm" in the phone's time zone. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const h12 = h % 12 || 12;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${h12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** "Today", "Yesterday" or "24 Sep 2026" — groups the history list. */
export function dayGroup(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const key = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (key(d) === key(now)) return 'Today';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (key(d) === key(y)) return 'Yesterday';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "8:05 pm" */
export function formatClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}
