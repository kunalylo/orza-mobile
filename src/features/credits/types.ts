/** Credits API shapes (web: `src/app/api/credits/**`, `src/components/account/types.ts`). */

export type CreditAction = 'scan' | 'meal_text' | 'chat' | 'recipe' | 'compensation' | 'report_insight';
export type CreditCosts = Record<CreditAction, number>;

/** `GET /api/credits/balance` */
export interface BalanceResponse {
  credits: number;
  costs: CreditCosts;
  ai_enabled: boolean;
  /** Net credits used in the last 30 days (spends minus refunds). */
  spent_30d?: number;
}

export interface CreditTransaction {
  id: string;
  user_id: string;
  /** + grant, − spend */
  amount: number;
  reason: string;
  /** The `CreditAction` key on AI spends and refunds (absent on grants and older rows) — see `transactionAction`. */
  action?: string;
  balance_after: number;
  created_at: string;
}

/** `GET /api/credits/transactions` (newest first, last 100). */
export interface TransactionsResponse {
  transactions: CreditTransaction[];
}

export interface CreditRequestView {
  id: string;
  message: string;
  balance: number;
  status: 'open' | 'done';
  created_at: string;
  handled_at: string | null;
}

/** `GET /api/credits/request` */
export interface CreditRequestsResponse {
  requests: CreditRequestView[];
  pending: CreditRequestView | null;
}

/** `POST /api/credits/request` (201) */
export interface CreditRequestResponse {
  request: CreditRequestView;
}
