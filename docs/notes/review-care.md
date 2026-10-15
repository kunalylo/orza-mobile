# Review fixes — care area (health / calendar / reminders)

Checklist of confirmed review findings for the care area. Tick each as it lands.
If this file exists when a fixer starts, it is resuming: continue from the unticked items.

- [x] calendar-1 — ConnectCard reads `external.error` / `external.name` from GET /api/calendar (never returns them); keep one merged state
- [x] calendar-2 — phone-calendar link + event map are global, not per-user, and survive sign-out (next account inherits + auto-syncs)
- [x] calendar-3 — two phone-calendar syncs can run at once → duplicate events that ring twice (serialize at module level)
- [x] health-1 — scrolling over a Health chart selects a day + haptic (selection in Pan.onBegin)
- [x] health-2 — Health Connect stage 7 (awake in bed) counted as sleep
- [x] typecheck + lint (`npm run typecheck` and `npx expo lint` both clean)

## Notes

- calendar-1: `features/calendar/api.ts` `setExternalState` — connect / disconnect patch the status AND every cached
  `/calendar/events` range (disconnect also drops imported events), then invalidate. `calendar.tsx` passes the one
  screen-wide `external` (events copy first; a frozen previous-month placeholder only while it still describes the same
  link — `screenExternal`) to the banner, legend, busy days and `ConnectCard`.
- calendar-2: link + map now carry `userId`; `readLink(userId)` / `linkedCalendar(userId)` ignore another account's (or a
  pre-fix, account-less) link, and the diff only uses this account's map (anything else → wipe upcoming + rewrite).
  `usePhoneCalendarState` / `usePhoneCalendarSync` read the user via `useSignedInUser()`; state key `phoneState(userId)`.
  Quiet re-syncs (`ask: false`) pass `onlyIfLinked`, so they never create / take over a calendar.
  New `clearPhoneCalendar()` (never throws, waits ≤ 4 s) deletes the ÖRZA calendar and forgets link + map —
  wired into `src/lib/auth.tsx` `signOut` at integration (dynamic import, after the logout call, before `clearLocal`;
  deliberate sign-out and account deletion only — not on a 401 expiry).
- calendar-3: `serialized()` queue in `deviceCalendar.ts` for sync / remove / sign-out clear; the data fetch runs inside
  the sync's turn (`load`), `stale` is cleared at the start of a run and set back on failure. Every sync mutation shares
  `calendarKeys.phoneSync()`; `PhoneCalendarCard` uses `useIsMutating` for "syncing" so a remount mid-sync doesn't start
  another.
- health-1: chart pan selects in `onStart` (activation) instead of `onBegin` (touch-down).
- health-2: `AWAKE_STAGES = {1, 3, 7}` in `lib/health/bridge.android.ts`.
