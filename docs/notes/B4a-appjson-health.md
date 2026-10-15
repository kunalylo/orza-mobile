# B4a — app.json + Health sync (Apple Health / Health Connect)

Owner files: `app.json`, `src/lib/health/**`, `src/app/(app)/health.tsx`, `src/features/health/**`.

## Endpoints (web repo is the contract)

- `GET /api/health/days?from=YYYY-MM-DD&to=YYYY-MM-DD` (session; default last 30 days, ≤ 400 days)
  → `{from, to, days: MergedHealthDay[], sources: HealthSourceSummary[], last_sync: ISO|null, last_sync_source: HealthSource|null}`
  - `MergedHealthDay = {date, sources: HealthSource[], steps?, active_kcal?, distance_km?, sleep_minutes?, resting_hr?, avg_hr?, weight_kg?, water_ml?}`
  - `HealthSourceSummary = {source, label, days, first_date, last_date, last_updated}`
  - 400 `bad_request` for bad dates / range.
- `POST /api/health/import {source: "apple_health" | "csv", days: [{date, steps?, active_kcal?, distance_km?, sleep_minutes?, resting_hr?, avg_hr?, weight_kg?, water_ml?}] (1..400)}`
  → `{ok: true, days_updated, skipped}`.
  - Metric values: number | numeric string | null. Server drops out-of-range values (never clamps): steps 0–100k, kcal 0–10k,
    km 0–300 (2 dp), sleep 0–1440 min, HR 25–230, weight 20–400 kg (2 dp), water 0–10k ml.
  - 400 `validation` (zod: `"<path>: <message>"`, no `field`), 400 `bad_request` "None of those days had a valid date…".
  - **`health_connect` is NOT an allowed import source** (`IMPORT_SOURCES = ["apple_health","csv"]` in
    `orza/src/components/care/health/metrics.ts`). Backend request filed in open_issues: add `"health_connect"`.
    Meanwhile Android sends `health_connect` first and, on a 400 `validation` whose message starts with `source`, falls back
    to `apple_health` (closest valid value: a phone health store; no overlap/overwrite risk with CSV imports) and remembers the
    fallback for the app session. Upserts are per user + date + source; steps mirror into tracking as max, weight fills empty days.
- Credits: none involved. No AI.

## Library APIs

- `@kingstinct/react-native-healthkit` 16.2 (iOS only, imported only from `src/lib/health/bridge.ios.ts`):
  `isHealthDataAvailable()`, `requestAuthorization({toRead})` → boolean (does NOT tell read grants),
  `getRequestStatusForAuthorization({toRead})` → `AuthorizationRequestStatus` (1 shouldRequest / 2 unnecessary),
  `queryStatisticsCollectionForQuantity(id, ['cumulativeSum'|'discreteAverage'|'mostRecent'], anchorDate, {day:1}, {filter:{date:{startDate,endDate}}, unit})`
  → `[{startDate, sumQuantity|averageQuantity|mostRecentQuantity: {quantity, unit}}]`,
  `queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', {limit: 0, ascending: true, filter:{date}})` → samples
  `{startDate, endDate, value, sourceRevision.source.bundleIdentifier}`; asleep values 1 (unspecified), 3 core, 4 deep, 5 REM.
  Units: count, kcal, km, count/min, kg, mL.
- `react-native-health-connect` 4.1.3 (Android only, imported only from `bridge.android.ts`):
  `getSdkStatus()` → 1 unavailable / 2 provider update required / 3 available; `initialize()`; `getGrantedPermissions()`;
  `requestPermission([{accessType:'read', recordType}])`; `aggregateGroupByPeriod({recordType, timeRangeFilter:{operator:'between', startTime, endTime}, timeRangeSlicer:{period:'DAYS', length:1}})`
  → `[{result, startTime: "YYYY-MM-DDTHH:mm" (local), endTime}]` — missing values come back as 0 (treated as missing);
  `readRecords('Weight'|'SleepSession', {timeRangeFilter, ascendingOrder, pageSize, pageToken})` → `{records, pageToken}`;
  `openHealthConnectSettings()`. Play Store: `market://details?id=com.google.android.apps.healthdata&url=healthconnect%3A%2F%2Fonboarding`
  (https fallback). Reads limited to 30 days before the first grant (no READ_HEALTH_DATA_HISTORY) — we read 30 days.
  `revokeAllPermissions` deliberately not used for "Disconnect" (library docs: takes effect after restart) → we stop syncing and
  link to Health Connect settings.
- `expo-file-system` (new API): `new File(Paths.document, 'orza-health.json')` `.exists/.textSync()/.write()` — per-user
  connection state (deleted on uninstall, unlike Keychain).
- `react-native-svg` for charts, Reanimated 4 for entrance/grow, `react-native-gesture-handler` Pan/Tap for chart scrubbing.

## Decisions

- Sleep is credited to the morning you woke up (matches web): per source, union asleep intervals, cluster into sessions
  (gaps ≤ 3 h), session minutes go to the local date of the session end; per date keep the max across sources.
- Weight = latest reading of the day (iOS `mostRecent`, Android latest record). Steps/kcal/distance/water = sums; HR = averages.
- Dates are device-local `YYYY-MM-DD`; last 30 days incl. today (today re-synced later as it grows).
- Auto-sync: `useHealthAutoSync()` runs on mount + every AppState → active, only when connected and ≥ 3 h since the last
  success (and ≥ 2 min since the last failed attempt). Mounted once in `(app)/_layout.tsx` (done by the Phase B
  verifier; the Health screen no longer mounts its own copy). Manual "Sync now" / pull-to-refresh always sync.
- HealthKit cannot report read grants, so "connected" = the user went through the permission sheet; if a sync returns nothing
  we say so and point to Settings › Health › Data Access & Devices.
- app.json: usage strings live in plugin props (single source); `READ_MEDIA_IMAGES` removed + blocked (image picker uses the
  system Photo Picker, Play photo policy); Health Connect READ_* permissions added; minSdk 26, compile/target 36;
  HealthKit `background: false` (no background delivery needed — foreground sync only).
- Phase C notes: iOS time-sensitive notifications entitlement (`com.apple.developer.usernotifications.time-sensitive`),
  dedicated 96×96 white notification icon (using `android-icon-monochrome.png` meanwhile), `USE_FULL_SCREEN_INTENT` /
  `SCHEDULE_EXACT_ALARM` Play declarations.

## Checklist

- [x] app.json (plugins + permissions) — validated with `npx expo config --type introspect`
- [x] src/lib/health/types.ts (metrics, ranges, bridge interface)
- [x] src/lib/health/aggregate.ts (dates, sleep sessions, cleaning)
- [x] src/lib/health/bridge.ios.ts (HealthKit)
- [x] src/lib/health/bridge.android.ts (Health Connect)
- [x] src/lib/health/bridge.ts (fallback: unsupported)
- [x] src/lib/health/store.ts (per-user state file + subscribe)
- [x] src/lib/health/sync.ts (syncHealth, useHealthSync, useHealthAutoSync, query keys)
- [x] src/features/health/types.ts + api.ts (days query)
- [x] src/features/health/format.ts
- [x] src/features/health/charts.tsx (BarChart, LineChart, ChartCard)
- [x] src/features/health/ConnectCard.tsx
- [x] src/features/health/StatTiles.tsx + SourcesCard.tsx + PrivacyNote
- [x] src/app/(app)/health.tsx
- [x] npm run typecheck + npx expo lint clean (re-verified after resume; introspect re-run: HealthKit entitlement, health READ_* perms, ViewPermissionUsageActivity alias, minSdk 26 / compile+target 36; no android/ or ios/ folders)
