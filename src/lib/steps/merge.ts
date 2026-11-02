/**
 * Which reading decides a member day — steps v2's merge rules (`docs/notes/steps-v2.md` §2.3). Pure — no React Native
 * imports — so `npm run test:steps` runs it in Node.
 *
 * - M0: a health store's 0 is "nothing synced" (no reading); a phone source's 0 for time it covered is a real 0. A
 *   missing reading never wins and is never complete.
 * - M1: the phone's own sources (Recording API, sampler, CMPedometer) read one sensor: compared by real steps
 *   (`steps − estimated`), never added. The winner brings its own flags (coverage, estimate, complete).
 * - M2: at most one health store per platform (Health Connect's aggregate, Apple Health's statistics sum).
 * - M3, today: the higher of the store and the phone by real steps (the live tail — stores lag behind), a tie to the
 *   store. Today never saves the estimated part (the save plan subtracts it).
 * - M4, a past day: the store's, when it holds this phone's own steps (Apple Health; Health Connect where it counts
 *   the phone itself — `includesPhone`) and covers the day from as early as the phone does — even when the phone
 *   counted more (it is what other health apps show, C3). Otherwise the higher by real steps: a store without the
 *   phone's steps (Android 9–13: a watch worn part of the day, a running app's workouts) never lowers the phone's
 *   count. The phone alone counts whole, estimate included.
 * - C16 (documented, not fixed): two phones carried in different parts of a day each save their own count and the
 *   server keeps the higher one, so such a day is low. Adding them would double count the usual day, when both are
 *   carried together.
 * - M5, the day's base (`DayBase`), anchored in TIME, never in a source's value (C4): the day is the base's number
 *   plus what was counted after its instant `at` — each source's own count over [at, now), chosen by M3 / M4 like a
 *   day. So a change of the leading source never loses or adds steps, and a watch's late sync of steps from before
 *   `at` never adds on. An `edit` is that sum; a `start` (the day had a number before anything counted it) is the
 *   higher of that sum and the whole-day count; an edit made after the day ended is the member's number for good.
 */
import type { DayBase, DayReading, PhoneCounter, SourceReading, SourceTag, StepSource } from './types';

/** Server limit (`boundedNumber(0, 100000)`). */
export const MAX_DAY_STEPS = 100_000;

/** A day count as the server takes it: a whole number in 0..MAX_DAY_STEPS (not finite → 0). */
export function clampSteps(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_DAY_STEPS, Math.round(n));
}

const STORES: ReadonlySet<StepSource> = new Set(['health_connect', 'apple_health']);

/** Equal real steps between phone sources: the exact counters before the sampler ("approximate"). */
const COUNTER_RANK: Record<PhoneCounter, number> = { recording: 0, pedometer: 1, sampler: 2 };

export const isStore = (source: StepSource) => STORES.has(source);

/** Real steps: the count without its long-gap estimate (C7: comparisons never let an estimate decide). */
export const realSteps = (x: SourceReading) => x.steps - (x.estimated ?? 0);

/** M0: a reading that may take part (whole steps, the estimate within them), or null. */
function usable(x: SourceReading | null | undefined): SourceReading | null {
  if (!x || !Number.isFinite(x.steps) || x.steps < 0 || !Number.isFinite(x.coverFrom)) return null;
  const steps = Math.round(x.steps);
  if (steps <= 0 && isStore(x.source)) return null;
  const estimated = Number.isFinite(x.estimated) && (x.estimated ?? 0) > 0 ? Math.min(steps, Math.round(x.estimated ?? 0)) : 0;
  if (steps === x.steps && estimated === (x.estimated ?? 0)) return x;
  const { estimated: _dropped, ...rest } = x;
  return { ...rest, steps, ...(estimated ? { estimated } : {}) };
}

/** `a` beats `b` among phone sources: more real steps, then less estimated, then the more exact counter. */
function betterPhone(a: SourceReading, b: SourceReading): boolean {
  if (realSteps(a) !== realSteps(b)) return realSteps(a) > realSteps(b);
  if ((a.estimated ?? 0) !== (b.estimated ?? 0)) return (a.estimated ?? 0) < (b.estimated ?? 0);
  return COUNTER_RANK[a.counter ?? 'sampler'] < COUNTER_RANK[b.counter ?? 'sampler'];
}

/** M1: the phone source with the most real steps (null when no phone source has a reading). */
export function phoneWinner(sources: readonly SourceReading[]): SourceReading | null {
  let best: SourceReading | null = null;
  for (const raw of sources) {
    if (raw.source !== 'phone') continue;
    const x = usable(raw);
    if (x && (!best || betterPhone(x, best))) best = x;
  }
  return best;
}

/**
 * M4: the store's count holds this phone's own steps — Apple Health always (the iPhone writes there); Health Connect
 * when it counts the phone itself (`includesPhone`, Android 14+ with extension 20). Elsewhere HC has only what other
 * apps wrote, which may be a part of the day or a workout.
 */
export const holdsPhone = (store: Pick<SourceReading, 'source' | 'includesPhone'>) => store.source === 'apple_health' || store.includesPhone === true;

/** Which source `x` is and from when it covers the day (`SourceTag`: what made an automatic save, M6). */
export function sourceTag(x: SourceReading): SourceTag {
  return { source: x.source, ...(x.counter ? { counter: x.counter } : {}), coverFrom: x.coverFrom };
}

/** M2: the health store's reading (null when it has none). */
export function storeReading(sources: readonly SourceReading[]): SourceReading | null {
  let best: SourceReading | null = null;
  for (const raw of sources) {
    if (!isStore(raw.source)) continue;
    const x = usable(raw);
    if (x && (!best || realSteps(x) > realSteps(best))) best = x;
  }
  return best;
}

/**
 * M3 / M4: the reading that decides the day's automatic count (null when no source has one). Its `steps` include its
 * estimate; `estimated` says how much of it that is.
 */
export function autoCount(reading: DayReading, isToday: boolean): SourceReading | null {
  const store = storeReading(reading.sources);
  const phone = phoneWinner(reading.sources);
  if (!store || !phone) return store ?? phone;
  // M4: a past day follows a store that holds the phone's steps and sees the day from as early as the phone.
  if (!isToday && holdsPhone(store) && store.coverFrom <= phone.coverFrom) return store;
  // M3 (and M4 otherwise): the higher by real steps, a tie to the store.
  return realSteps(phone) > realSteps(store) ? phone : store;
}

/**
 * S-H2: the first instant of `day` Health Connect can see. On the day ÖRZA first saw `READ_STEPS` granted
 * (`grantAt`), HC holds this phone's steps only from the grant on (its on-device counting starts with the first
 * grant): covered from the grant when HC had nothing before it (`preGrant`, its count over [day start, grantAt); an
 * empty read is 0, S-H1), from the day's start when another writer (a watch, a fitness app) had. Every other day:
 * the whole day.
 */
export function hcCoverFrom(day: { start: number; end: number }, grantAt: number | null | undefined, preGrant: number | null | undefined): number {
  if (grantAt == null || !Number.isFinite(grantAt) || grantAt <= day.start || grantAt >= day.end) return day.start;
  return (preGrant ?? 0) > 0 ? day.start : grantAt;
}

/**
 * M9, a shared phone: the part of `day` this member's steps may come from — from `floor` (their consent, when another
 * member consented on this install first). Null for a day that ended by then: no reading at all. Readers read every
 * source over the returned range, so a source's `coverFrom` is never before the floor (and today becomes a START,
 * M5c3, when the day already had steps saved).
 */
export function applyCoverFloor(day: { start: number; end: number }, floor: number | null | undefined): { start: number; end: number } | null {
  if (floor == null || !Number.isFinite(floor) || floor <= day.start) return day;
  if (floor >= day.end) return null;
  return { start: floor, end: day.end };
}

/* ───────────────────────────── M5: bases ───────────────────────────── */

/**
 * What source `x` counted after `at`, as a reading of its own covered from max(at, coverFrom) — or null when it can't
 * tell. All of its count when its coverage starts at or after `at`; else its `since`, when the reader measured it for
 * this very `at` (one for another instant — the base changed after the read — is never stretched to fit). Never more
 * than its whole count. A `since` without an estimate of its own is taken as at most the reading's (C7: it never
 * passes as real steps).
 */
function sinceReading(x: SourceReading, at: number): SourceReading | null {
  if (x.coverFrom >= at) return x;
  const since = x.since;
  if (!since || since.at !== at || !Number.isFinite(since.steps)) return null;
  const steps = Number.isFinite(x.steps) ? Math.min(since.steps, x.steps) : since.steps;
  const estimated = since.estimated ?? Math.min(steps, x.estimated ?? 0);
  const { since: _since, estimated: _estimated, ...rest } = x;
  return { ...rest, steps, coverFrom: at, ...(estimated ? { estimated } : {}) };
}

/**
 * M5 `counted(base)`: what the day's sources counted after `at`, chosen like a day's count (M0–M4 over each source's
 * count since `at`: today the higher, a past day the store's) — null when no source can say (none has a count for
 * that instant, or `at` is at or after the day's end: nothing can be counted then).
 */
export function counted(reading: DayReading, at: number, isToday: boolean): SourceReading | null {
  if (!(at < reading.end)) return null;
  const sources = reading.sources.flatMap((x) => sinceReading(x, at) ?? []);
  return autoCount({ ...reading, sources }, isToday);
}

/** A member day's number (M5) — what Today shows and the save plan saves (`policy.ts`). */
export interface DayValue {
  /** The day's count, 0..MAX_DAY_STEPS. */
  steps: number;
  /** How many of `steps` are a long-gap estimate (a phone source's): today's save leaves them out (M3). */
  estimated: number;
  /**
   * What decided it: `auto` — the whole-day automatic count (no base, or a start's whole-day count was higher);
   * `edit` / `start` — the base's number plus what was counted after it.
   */
  basis: 'auto' | 'edit' | 'start';
  /** The reading the count comes from (its source and counter label the number); null: the base alone. */
  winner: SourceReading | null;
  /** An edit made after the day ended (M5d): the member's number for good — nothing is saved automatically. */
  fixed: boolean;
  /**
   * A source that covers the day from before the base's instant couldn't say what it counted after it (no `since`
   * read for that instant: a base taken after the read, a source that reads it for today only, a failed query). The
   * number is then a lower bound: it may raise the day, never lower it (no reconcile, M6), and a past day isn't final
   * on it before 72 h (M7).
   */
  sinceUnknown: boolean;
  /**
   * The reading's `storeUnread`: a health store that is ON (or Android's Recording API, subscribed) wasn't read — a
   * past day saves nothing and isn't final.
   */
  storeUnread: boolean;
  /**
   * The reading's `phonePartial`: the phone's own counter is ON but blind for part of the day — a past day's number
   * then never lowers this phone's own save unless a store holding the phone's steps decides it (M6).
   */
  phonePartial: boolean;
}

function valueOf(steps: number, estimated: number | undefined, basis: DayValue['basis'], winner: SourceReading | null): DayValue {
  const n = clampSteps(steps);
  return {
    steps: n,
    estimated: Math.min(n, clampSteps(estimated ?? 0)),
    basis,
    winner,
    fixed: false,
    sinceUnknown: false,
    storeUnread: false,
    phonePartial: false,
  };
}

const realValue = (v: DayValue) => v.steps - v.estimated;

/**
 * M5: the day's number from its reading and its base (null: no base and no source has the day).
 * - (e) no base: the automatic count (M3 / M4);
 * - (a) `edit`: the base's number plus what was counted after its instant;
 * - (b) `start`: the higher of the whole-day count and that sum — by real steps (C7: a mostly estimated whole day
 *   doesn't replace a typed number), a tie to the whole-day count;
 * - (d) an `edit` made at or after the day's end: its number, fixed — late data from before it never adds on.
 * Flags: `sinceUnknown` (a source couldn't say what it counted after the base), `storeUnread` and `phonePartial` (from
 * the reading).
 */
export function dayValue(reading: DayReading, base: DayBase | null | undefined, isToday: boolean): DayValue | null {
  const storeUnread = reading.storeUnread === true;
  const value = baseValue(reading, base, isToday);
  if (!value) return null;
  const sinceUnknown = !!base && !value.fixed && base.at < reading.end && !!reading.sources.some((x) => blindSince(x, base.at));
  return { ...value, sinceUnknown, storeUnread, phonePartial: reading.phonePartial === true };
}

function baseValue(reading: DayReading, base: DayBase | null | undefined, isToday: boolean): DayValue | null {
  const auto = autoCount(reading, isToday);
  const whole = auto ? valueOf(auto.steps, auto.estimated, 'auto', auto) : null;
  if (!base) return whole;
  if (base.kind === 'edit' && base.at >= reading.end) return { ...valueOf(base.steps, 0, 'edit', null), fixed: true };
  const since = counted(reading, base.at, isToday);
  const added = valueOf(clampSteps(base.steps) + (since?.steps ?? 0), since?.estimated, base.kind, since);
  if (base.kind === 'edit' || !whole) return added;
  return realValue(added) > realValue(whole) ? added : whole;
}

/** Source `raw` has steps for the day, covers it from before `at`, and has no count since `at` (`sinceReading`). */
function blindSince(raw: SourceReading, at: number): boolean {
  const x = usable(raw);
  return !!x && x.coverFrom < at && !sinceReading(x, at);
}

/** M5c: something counted the day at instant `a` — a source with a reading (not a store's "nothing synced") from `a` or earlier. */
function countingAt(reading: DayReading | null | undefined, a: number): boolean {
  return !!reading?.sources.some((raw) => {
    const x = usable(raw);
    return !!x && x.coverFrom <= a;
  });
}

/**
 * M5c1: the member saved `steps` for the day on this phone at `at` (`editRef`: the edit marker the server answered
 * with; null from a server without markers). An `edit` when something was counting the day at that instant
 * (`reading`: the day's latest); else a `start` — typed while nothing counted, so counting that begins later adds on,
 * and a higher whole-day count can still replace it.
 */
export function baseForEdit(steps: number, at: number, reading: DayReading | null | undefined, editRef: string | null | undefined): DayBase {
  return { kind: countingAt(reading, at) ? 'edit' : 'start', steps: clampSteps(steps), at, editRef: editRef ?? null };
}

/**
 * M5c1 with no reading of the day at hand (the app's first read hasn't finished, or it timed out): what counted at
 * `at` can't be told, so the kind that never undoes the member's number. An `edit` when the day had ended by then
 * (`day.end`; M5d: theirs for good — the whole-day count read later never replaces it) or while something counts the
 * member's steps on this phone (`day.counting`: it saved the day automatically, or a source is ON); else a `start`
 * (nothing counts here, as with a reading without sources).
 */
export function baseWithoutReading(
  steps: number,
  at: number,
  day: { end?: number | null; counting: boolean },
  editRef: string | null | undefined
): DayBase {
  const ended = day.end != null && Number.isFinite(day.end) && at >= day.end;
  return { kind: ended || day.counting ? 'edit' : 'start', steps: clampSteps(steps), at, editRef: editRef ?? null };
}

/** What a day's row says beside its count and edit marker (M5c2). */
export interface MarkerRow {
  /** The edit's own number (`steps_edited_value`, B2): the count may have been raised on top of it since. */
  editedSteps?: number | null;
  /** When the row was last written (`updated_at`, epoch ms): any raise on top of the edit came no later. */
  updatedAt?: number | null;
}

/**
 * M5c2: the server's edit marker for the day (`steps_edited_at`, set by every manual save — the website, another
 * phone) with the day's count there (`serverSteps`, and what else its row says: `row`), seen at `now`. None, or one
 * this phone already knows (`knownRef`: its own edit's, or one taken before) → null. Else the base, made like
 * `baseForEdit`, with the marker as its `editRef`:
 * - the edit's own number (`row.editedSteps`) at the marker's instant;
 * - without it, the count as it is now — which may already hold steps counted after the edit (another phone that took
 *   the marker raised the day; this phone did, before its day record was lost) — anchored where the row was last
 *   written (`row.updatedAt`), never before the marker: those steps are never counted again (M1, C4). This may miss
 *   steps between the edit and a later write of the row that wasn't a raise (water, weight).
 * The instant is clamped to [day start, now]; a marker that doesn't parse is now.
 */
export function baseFromMarker(
  marker: string | null | undefined,
  serverSteps: number,
  reading: DayReading,
  now: number,
  knownRef: string | null | undefined,
  row: MarkerRow = {}
): DayBase | null {
  if (!marker || marker === knownRef) return null;
  const latest = Math.max(reading.start, now);
  const parsed = Date.parse(marker);
  const markedAt = Number.isFinite(parsed) ? parsed : latest;
  const edited = row.editedSteps;
  const own = typeof edited === 'number' && Number.isFinite(edited) && edited >= 0;
  const written = row.updatedAt != null && Number.isFinite(row.updatedAt) ? row.updatedAt : -Infinity;
  const at = own ? markedAt : Math.max(markedAt, written);
  return baseForEdit(own ? edited : serverSteps, Math.min(Math.max(at, reading.start), latest), reading, marker);
}

/**
 * M5c3, an implicit start: counting began partway through a day that already had a number on the server — a new
 * source's first day, a source switched (S-A3) or turned off and on again (P9), a re-subscribe after a sign-out, a
 * shared phone's consent day (M9). When the day has no base, the server's count (`server`, as just read) is above 0
 * and the winning reading's coverage starts after midnight: a `start`. Else null. `known` takes the day's record as it
 * is, plus `lastAutoSave` (this phone's last applied automatic save of the member, any day — kept in the prefs):
 * - this phone saved the day automatically (`autoSent`) since that coverage began (`autoAt`): no start — the server's
 *   number already holds the winner's steps (the same source's partial first day);
 * - it saved the day before the coverage began: this phone's own number then (never above the server's) at the
 *   coverage's start — the earlier source's steps stay, the new one's add on. Not the server's when higher: another
 *   phone's count may already hold the steps since then (compared, never summed: M1, C16);
 * - no automatic save of the day on record (none, or the record was lost: deleted at sign-out, the cache purged): the
 *   server's number at the coverage's start, but never before `lastAutoSave` — that number may hold this phone's own
 *   earlier save of these steps, which would otherwise count twice.
 */
export function implicitStart(
  reading: DayReading,
  isToday: boolean,
  known: { base?: DayBase | null; autoSent?: number | null; autoAt?: number | null; server?: number | null; lastAutoSave?: number | null }
): DayBase | null {
  if (known.base) return null;
  const server = clampSteps(known.server ?? 0);
  if (server <= 0) return null;
  const winner = autoCount(reading, isToday);
  if (!winner || winner.coverFrom <= reading.start) return null;
  if (known.autoSent != null) {
    if ((known.autoAt ?? Infinity) >= winner.coverFrom) return null;
    return { kind: 'start', steps: Math.min(server, clampSteps(known.autoSent)), at: winner.coverFrom };
  }
  const saved = known.lastAutoSave != null && Number.isFinite(known.lastAutoSave) ? known.lastAutoSave : -Infinity;
  return { kind: 'start', steps: server, at: Math.max(winner.coverFrom, saved) };
}

/**
 * M5c3 on a day that already has a base (R/U review): counting restarted after the base's instant — the switch off and
 * on (P9), S-A3, Play services gone and back (a fresh sampler), a second restart the same day — so the winning count
 * after the base (`counted`) covers only from its new start, and the steps between the base and that start would drop
 * out of the day. When this phone saved the day automatically between the two (`autoAt` in [base.at, coverFrom)), the
 * base moves to the restart with that save (`autoSent`, never above the server's count — another phone's higher count
 * is compared, never added — nor below the base): the same kind and edit marker, so an edit stays the member's. With no
 * such save on record (the record was lost: sign-out, a purged cache) but this phone's last automatic save
 * (`lastAutoSave`, any day) after the base's instant and a server count above the base, the server's count from the
 * later of the restart and that save. Null: nothing to move (a winner that sees the base's instant, no save between,
 * an edit made after the day, no base — `implicitStart`).
 */
export function restartBase(
  reading: DayReading,
  isToday: boolean,
  known: { base?: DayBase | null; autoSent?: number | null; autoAt?: number | null; server?: number | null; lastAutoSave?: number | null }
): DayBase | null {
  const base = known.base;
  if (!base || !(base.at < reading.end)) return null;
  const winner = counted(reading, base.at, isToday);
  if (!winner || winner.coverFrom <= base.at) return null;
  const at = winner.coverFrom;
  const server = known.server != null && Number.isFinite(known.server) ? clampSteps(known.server) : null;
  const keep = { kind: base.kind, ...(base.editRef !== undefined ? { editRef: base.editRef } : {}) };
  if (known.autoSent != null) {
    const autoAt = known.autoAt ?? -Infinity;
    if (!(autoAt >= base.at && autoAt < at)) return null;
    const own = clampSteps(known.autoSent);
    return { ...keep, steps: Math.max(clampSteps(base.steps), server != null ? Math.min(server, own) : own), at };
  }
  const saved = known.lastAutoSave != null && Number.isFinite(known.lastAutoSave) ? known.lastAutoSave : null;
  if (server == null || saved == null || saved < base.at || server <= clampSteps(base.steps)) return null;
  return { ...keep, steps: server, at: Math.max(at, saved) };
}
