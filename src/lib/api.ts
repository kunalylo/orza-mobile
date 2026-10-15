/**
 * ÖRZA API client (same JSON API as the website, signed in with the phone app's Bearer session token).
 *
 * - Every request: `Accept: application/json`, `X-ORZA-Client: mobile`, `credentials: "omit"` (the native cookie
 *   jar must never mix in a website cookie), `Authorization: Bearer <token>` when signed in.
 * - Bodies are always JSON with `Content-Type: application/json`: the server refuses any non-JSON write (415), so photos
 *   travel as data URLs inside JSON — there is no multipart upload.
 * - Errors become `ApiError` with the server's `{error, code, field}`; network failures and timeouts get
 *   friendly messages; a 401 on an authenticated call signs the app out (see `setUnauthorizedHandler`) — except
 *   `code: "wrong_password"`, which only means a password typed to confirm a change was wrong.
 */
import * as Device from 'expo-device';

import { API_BASE, API_ORIGIN, PLATFORM } from './config';

const DEFAULT_TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  /** HTTP status; 0 = no response (offline / timeout). */
  readonly status: number;
  /** Server code (`rate_limited`, `insufficient_credits`, …) or `network` / `timeout` / `http_<status>`. */
  readonly code: string;
  /** Validation errors name the offending field. */
  readonly field?: string;
  /** Seconds, from `Retry-After` (429). */
  readonly retryAfter?: number;
  readonly data?: unknown;

  constructor(message: string, opts: { status: number; code: string; field?: string; retryAfter?: number; data?: unknown }) {
    super(message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.code = opts.code;
    this.field = opts.field;
    this.retryAfter = opts.retryAfter;
    this.data = opts.data;
  }

  get isNetwork() {
    return this.status === 0;
  }
}

export const NETWORK_MESSAGE = "Can't reach ÖRZA right now. Check your connection and try again.";
export const TIMEOUT_MESSAGE = 'ÖRZA is taking too long to answer. Please try again.';
export const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

/** A user-facing message for anything thrown by the client (or elsewhere). */
export function errorMessage(e: unknown, fallback = GENERIC_MESSAGE): string {
  // Only ApiError messages are written for people; anything else (TypeError, native errors) gets the fallback.
  return e instanceof ApiError && e.message ? e.message : fallback;
}

/**
 * The form field a 400 belongs to. Routes answer zod failures as `{error: "<path>: <message>", code: "validation"}`
 * with no `field` (web `route()`, e.g. `"schedule.times.0: Use 24-hour times"`); the auth routes name it in `field`.
 * `field` is the first path segment (`schedule`), `path` the whole path (`schedule.times.0`) and `message` the text
 * without the `path: ` prefix, capitalised. Anything else (another status or code, no path prefix) gives null.
 */
export function validationField(e: unknown): { field: string; path: string; message: string } | null {
  if (!(e instanceof ApiError) || e.status !== 400) return null;
  if (e.field) return { field: e.field, path: e.field, message: e.message };
  if (e.code !== 'validation') return null;
  const m = /^([a-z_]\w*)((?:\.[\w.]+)?):\s*([\s\S]+)$/i.exec(e.message);
  if (!m) return null;
  const msg = m[3].trim();
  return { field: m[1], path: m[1] + m[2], message: msg.charAt(0).toUpperCase() + msg.slice(1) };
}

/* ───────────────────────────── Session plumbing ───────────────────────────── */

let sessionToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

/** Set by the AuthProvider whenever the stored session changes. */
export function setSessionToken(token: string | null) {
  sessionToken = token;
}

export function getSessionToken() {
  return sessionToken;
}

/** Called once when an authenticated request answers 401 (expired / revoked session). */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

const DEVICE_LABEL_MAX = 80;

/**
 * Name sent with sign-in (`X-ORZA-Device`) and device registration, so the web shows "Kunal's iPhone" etc.
 * Cleaned the way the server cleans it (no control / line-separator characters, single spaces, ≤ 80 characters,
 * never splitting an emoji), so `POST /api/devices` never refuses it and it always URL-encodes.
 */
export function deviceLabel(): string {
  const raw = Device.deviceName || Device.modelName || (PLATFORM === 'ios' ? 'iPhone' : 'Android phone');
  const clean = raw
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(clean).slice(0, DEVICE_LABEL_MAX).join('').trim() || 'Phone';
}

/** `X-ORZA-Device` value: header values must be Latin-1, so the name is URL-encoded (the server decodes it). */
export function deviceHeaderValue(): string {
  try {
    return encodeURIComponent(deviceLabel());
  } catch {
    return 'Phone'; // a lone surrogate in the device name — send a plain fallback rather than fail sign-in
  }
}

/* ───────────────────────────── Requests ───────────────────────────── */

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  method?: Method;
  /** JSON-serialised (objects/arrays/primitives). Photos go in as data URLs — the server accepts JSON only. */
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Send the Bearer token (default true). */
  auth?: boolean;
}

/** `"/auth/me"` → `${API_BASE}/auth/me`; absolute URLs pass through; `/api/...` paths are accepted too. */
export function apiUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith('/api/')) return `${API_ORIGIN}${path}`;
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

/** Image source for a protected photo URL the API returns (relative `photo_urls`, `/api/media/<id>`). */
export function mediaSource(url: string | null | undefined) {
  if (!url) return undefined;
  const uri = /^https?:\/\//.test(url) ? url : `${API_ORIGIN}${url.startsWith('/') ? url : `/${url}`}`;
  return sessionToken ? { uri, headers: { Authorization: `Bearer ${sessionToken}` } } : { uri };
}

function baseHeaders(auth: boolean): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/json',
    'X-ORZA-Client': 'mobile',
  };
  if (PLATFORM !== 'web') h['X-ORZA-Platform'] = PLATFORM;
  if (auth && sessionToken) h.Authorization = `Bearer ${sessionToken}`;
  return h;
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageFor(status: number, data: unknown): { message: string; code: string; field?: string } {
  const obj = data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  const serverMessage = typeof obj?.error === 'string' && obj.error.trim() ? obj.error.trim() : null;
  const code = typeof obj?.code === 'string' ? obj.code : `http_${status}`;
  const field = typeof obj?.field === 'string' ? obj.field : undefined;
  if (serverMessage) return { message: serverMessage, code, field };
  if (status === 401) return { message: 'Please sign in again.', code };
  if (status === 403) return { message: "You don't have access to that.", code };
  if (status === 404) return { message: "We couldn't find that.", code };
  if (status === 413) return { message: 'That file is too large.', code };
  if (status === 429) return { message: 'Too many tries — please wait a moment and try again.', code };
  if (status >= 500) return { message: "Something went wrong on our side. Please try again in a moment.", code };
  return { message: GENERIC_MESSAGE, code };
}

export async function request<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = opts.body !== undefined ? 'POST' : 'GET', body, timeoutMs = DEFAULT_TIMEOUT_MS, signal, auth = true } = opts;
  const headers = { ...baseHeaders(auth), ...opts.headers };
  // The server's guard: every write is JSON, except a DELETE without a body, which may omit the Content-Type.
  let payload: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (method !== 'GET' && method !== 'DELETE') {
    headers['Content-Type'] = 'application/json';
    payload = '{}';
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const relay = () => controller.abort();
  signal?.addEventListener('abort', relay);
  const usedToken = auth ? sessionToken : null;

  let res: Response;
  try {
    res = await fetch(apiUrl(path), { method, headers, body: payload, signal: controller.signal, credentials: 'omit' });
  } catch (e) {
    if (signal?.aborted) throw e; // the caller cancelled (React Query) — let it see the abort
    throw timedOut
      ? new ApiError(TIMEOUT_MESSAGE, { status: 0, code: 'timeout' })
      : new ApiError(NETWORK_MESSAGE, { status: 0, code: 'network' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', relay);
  }

  const data = await parse(res);
  if (!res.ok) {
    const { message, code, field } = messageFor(res.status, data);
    const retry = Number(res.headers.get('Retry-After'));
    const error = new ApiError(message, {
      status: res.status,
      code,
      field,
      retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined,
      data,
    });
    // Only a request made with the *current* token may end the session (a stale in-flight call must not). A
    // `wrong_password` 401 only means the current password typed on a password change was wrong (as on the web).
    if (res.status === 401 && code !== 'wrong_password' && usedToken && usedToken === sessionToken) onUnauthorized?.();
    throw error;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, opts?: Omit<RequestOptions, 'method' | 'body'>) => request<T>(path, { ...opts, method: 'GET' }),
  post: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'POST', body: body ?? {} }),
  put: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PUT', body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, opts?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(path, { ...opts, method: 'PATCH', body: body ?? {} }),
  del: <T>(path: string, opts?: Omit<RequestOptions, 'method'>) => request<T>(path, { ...opts, method: 'DELETE' }),
};
