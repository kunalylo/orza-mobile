# C1 — platform-neutral alarm engine (`src/lib/alarms/**`)

Resume: read this file + `git status`, continue from the first unchecked item.

## Ownership
`src/lib/alarms/**` (adapter.android.ts / adapter.ios.ts only as typed no-op stubs for C2 / C3), `scripts/tests/**`,
`src/app/(app)/_layout.tsx` (mount `useAlarmSync()` only), `src/lib/auth.tsx` (sign-out cleanup hook only),
`package.json` (`test:alarms` script only), this notes file.

## Research (verified in node_modules types / v57 docs — not from memory)
- **Server semantics** (web `src/lib/care/dispatch.ts`, `meds.ts`, `integrations.ts`, `components/care/reminders/shared.ts`):
  - doses: active && !as_needed meds; occurrences from `occurrencesBetween(schedule, from, to, profile tz)`; occurrences
    earlier than `created_at − 30 min` are dropped (`dosesBetween`); any dose log (`acted_at` / taken / skipped / snoozed)
    = acted → no alarm at the scheduled time; a snoozed log re-fires at `snooze_until`.
  - push title `💊 Time for <name strength>`, body `doseLine(med) || med.dose || "Your scheduled dose"` where doseLine =
    `dose · timing text · for <person>`; alarm URL `/dashboard/alarm?med=&at=`.
  - reminders: only when `preferences.reminders !== false`; reminder active (dispatcher loads `active: true`); phone
    rings only `channels.push` (WhatsApp-only / calendar-only reminders don't ring on the phone). Title
    `<emoji> <title>`, body `body.trim() || KIND_DEFAULT_BODY[kind]`; meal→/meals, water→/, weight→/goals,
    custom→/reminders.
  - refill: every active med (SOS included) with `stock.count` number, `stock.refill_alert_at` number and
    count ≤ refill_alert_at; once per local day (`refill:<med>:<local date>`), only while local time is in
    [08:00, 21:00); quiet hours **defer** (sent at the first tick after quiet ends, if still daytime).
    Title `💊 <label> has run out` (count 0) / `💊 Refill <label> soon`; body "Your stock (for X) is at zero…" /
    "Only N <unit> left (for X). Reorder before you run out." (unit default "doses").
  - quiet hours `integrations.quiet_hours {start,end}` (HH:MM, start ≠ end), local time in profile tz,
    `inQuietWindow`: start < end → [start, end); else overnight → t ≥ start || t < end. Medicines, snoozes and
    reminders inside → suppressed (not sent later).
  - `GET /api/integrations` → `{quiet_hours, reminders_enabled, timezone}` (+ others) — one call gives all three.
  - `GET /api/meds` → `{medications}` (active + paused, each with `photo_ids` / `photo_urls`, relative `/api/media/<id>`).
  - `GET /api/meds/today?date=` → `{date, now, doses}` with status / `acted_at` / `snooze_until` per dose of that local day.
  - `POST /api/meds/doses {medication_id, scheduled_for, action, snooze_minutes?}` (5–60) → `{dose}`; 404 medicine
    gone, 400 "…isn't on this medicine's schedule" (± 36 h window) — `isStaleDoseError` in features/meds/api.
    `take` decrements stock once (idempotent re-send). `acted_at` / `snooze_until` are server time (no client time).
  - media: `/api/media/<id>` (Bearer) → `Content-Type` image/jpeg | image/png | image/webp, ≤ 1.5 MB.
  - devices: `appRingsDoses` = a device with `alarms_local: true`, seen ≤ 7 days, live mobile session.
- **expo-file-system 57.0.7** (`build/*.d.ts`): `new File(dirOrUri, name)`, `new Directory(Paths.document, name)`,
  `.exists`, `.create({intermediates, idempotent})`, `.delete()`, `.list()` → `(File|Directory)[]`, `File.size`,
  `File.lastModified`, `.textSync()`, `.write(string)`, `.move(dest)` / `.moveSync`, `.open(FileMode.ReadOnly)` →
  `FileHandle.readBytes(n)` / `.close()`. `File.downloadFileAsync(url, File|Directory, {headers, idempotent, signal})`
  → `Promise<File>`; non-2xx rejects (`UnableToDownload`) with no file; Android may leave a partial file on a mid-stream
  failure. `Paths.document` persists (cache may be purged by the OS).
- **expo-image-manipulator** (as lib/image.ts): `ImageManipulator.manipulate(uri)` → ctx `.resize({width|height})`,
  `.renderAsync()` → `ImageRef {width,height}` → `.saveAsync({format: SaveFormat.JPEG, compress})` → `{uri}`;
  `ctx.release()`.
- **expo-background-task 57.0.21** + docs v57: `TaskManager.defineTask(name, executor)` must run in the **global scope**
  of the bundle (not in React); when the OS launches the app for the task **no views are mounted** — so with Expo Router
  the task module must be imported from a custom entry before `expo-router/entry` (route files are only evaluated when
  the tree renders). `BackgroundTask.registerTaskAsync(name, {minimumInterval /* minutes, ≥ 15 */})` can be called from
  components; registrations persist. `getStatusAsync()` → Available | Restricted; executor returns
  `BackgroundTaskResult.Success | Failed`. Runs only with network + enough battery; iOS needs `processing` background
  mode + `com.expo.modules.backgroundtask.processing` (CNG adds them via the `expo-background-task` plugin, already in
  app.json); stopped when the user force-kills the app; not on the iOS simulator.
  `TaskManager.isTaskDefined(name)`, `isTaskRegisteredAsync(name)`, `BackgroundTask.unregisterTaskAsync(name)`.
- **expo-notifications 57** (for C3, not used by C1): iOS content `attachments?: {identifier,url,type}[]`,
  `interruptionLevel`; `dismissNotificationAsync(id)`, `getPresentedNotificationsAsync()`,
  `cancelAllScheduledNotificationsAsync()`. iOS moves an attachment file into its own store when the request is added —
  **C3 must attach a copy** of the cached photo, never the cached file itself.
- Hermes: `Intl.DateTimeFormat` with `timeZone` / `formatToParts` / `hourCycle: 'h23'` is already used by the app
  (features/meds/shared). The port caches formatters per zone and maps a "24" hour to "00".

## Decisions
- Planner is pure TS with relative imports only (runs under `npx tsx --test` in Node). Constants (kind emoji / bodies,
  timing text) are copied from the web, as the rest of the app does.
- Keys: `dose:<iso>` (all meds at that instant, ONE alarm), `snooze:<medId>:<scheduled iso>` (single) or
  `snooze:<scheduled iso>` (several doses of one alarm snoozed into the same minute), `reminder:<id>:<iso>`,
  `refill:<medId>:<local date>`. Helpers `doseKey`, `snoozeKey` exported for C2 / C3 so a native snooze uses the
  same key the next plan will use (the replace-all then keeps one alarm, not two).
- Only future instants are planned (`at > now`): an alarm that already rang is never re-rung by a re-plan.
- Cap: ring items (doses + snoozes) first, chronologically; reminders / refills fill what's left. `coveredUntil` says
  up to when the plan is complete (sync uses it).
- Refill alerts: today (if not yet delivered) and tomorrow only, at 08:00 local (today: now + 1 min when later),
  deferred to quiet-hours end, dropped when that's ≥ 21:00. "Delivered" = a refill key the previous plan scheduled
  whose time has passed (kept in the cache).
- Pending queued actions (take / skip / snooze pressed on a notification while offline) are overlaid on the dose logs,
  so a re-plan keeps the native snooze and drops a taken dose.
- Queue: one entry per dose (newest action wins); drop on 4xx (except 401 / 408 / 429), keep on network / 5xx; entries
  older than 72 h dropped; a snooze whose 10 min already passed before it could be sent is dropped (sending it late
  would make the server schedule a surprise re-ring).
- `alarmsLocal: true` only when notifications are granted, Android exact alarms aren't denied (`exact !== false`), the
  adapter is real (`maxScheduled > 0`), the schedule call succeeded and ≥ 1 alarm is scheduled. Otherwise false. No push
  token is fetched (the server has no sender; FCM isn't configured).
- Permission not granted → `cancelAll()` and declare false (nothing would show anyway).
- Background 401 → stop quietly (never cancel alarms from the background: a false 401 must not silence medicines); the
  foreground 401 handler signs out → `clearLocal` → alarm cleanup.
- Sign-out cleanup hooked into `clearLocal` (covers deliberate sign-out and 401 expiry) via dynamic import.
- Cache: `Paths.document/orza-alarms.json` (per user), photos `Paths.document/orza-alarm-photos/<mediaId>.jpg`
  (normalised to JPEG ≤ 1080 px so iOS attachments work for webp uploads too), queue `orza-alarm-queue.json`.
- Day logs: today always refetched; yesterday (before 12:00 local, for snoozes across midnight and dismissals) ≥ 30 min
  old; tomorrow ≥ 1 h; later days ≥ 6 h or when marked dirty by a dose / meds event.

## Checklist
- [x] notes (this file)
- [x] schedule.ts (port of web schedule.ts + dates helpers + quiet window)
- [x] types.ts (plan item, doses, keys: `doseAlarmKey`, `snoozeAlarmKey`, `reminderAlarmKey`, `refillAlarmKey`, `deepLinkFor`)
- [x] plan.ts (`planAlarms`, `planHash`)
- [x] scripts/tests/alarm-plan.test.ts passing (`npm run test:alarms`) — 28/28
- [x] adapter.ts (interface + contract) + noop.ts + adapter.android.ts / adapter.ios.ts typed no-op stubs
- [x] events.ts (`emitAlarmDataChanged`)
- [x] store.ts (JSON files + per-user alarm data cache)
- [x] photos.ts (`attachAlarmPhotos`, `clearAlarmPhotos`)
- [x] queue.ts (`enqueueDoseActions`, `flushDoseQueue`, `pendingDoseActions`, `clearDoseQueue`)
- [x] sync.ts (`syncAlarms`, `requestAlarmSync`, `checkAlarmsOnForeground`, `recordAlarmAction`, `requestAlarmPermission`,
      state store) + useAlarmSync.ts (`useAlarmSync`, `useAlarmSyncState`)
- [x] background.ts (task defined at module top level; register / unregister)
- [x] cleanup.ts + auth.tsx hook (in `clearLocal`: deliberate sign-out and 401 expiry)
- [x] useAlarmSync mounted in (app)/_layout.tsx
- [x] package.json `test:alarms`
- [x] `npm run typecheck` ✓, `npx expo lint` ✓ (whole project)

## Notes for C2 / C3 / integration
- Platform selection is Metro's: `./adapter` → `adapter.android.ts` / `adapter.ios.ts` on device, `adapter.ts` (re-exports
  the no-op from `noop.ts`) elsewhere. Platform files may import only TYPES from `./adapter` (a runtime import would
  resolve to themselves). Replace the stub body, keep `export const alarmAdapter: PlatformAdapter`.
- Native Snooze must schedule its re-ring under `snoozeAlarmKey(scheduledFor, medIds)` (one med → `snooze:<med>:<iso>`,
  several → `snooze:<iso>`) at `now + snoozeMinutes`; the next plan (pending action overlay, then the server's
  `snooze_until`) replaces it with the same key.
- iOS: attach a COPY of `item.photos[i]` (iOS moves attachment files). Keep `maxScheduled` ≤ 60 (64 minus room for
  native snoozes).
- Background task needs the custom entry (cross-area request): `index.ts` at the repo root importing
  `./src/lib/alarms/background` before `expo-router/entry`, and `"main": "index.ts"`.
- Not covered by tests (needs a device): photos download / normalise, queue flush, background task, adapters.
