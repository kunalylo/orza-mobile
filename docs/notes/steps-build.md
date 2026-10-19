# steps-build — automatic step counting

Client: "why do we have to enter steps manually — it has to do it perfectly by itself". Members never type steps: the
phone counts them all day (app closed too), Today shows them live, and the phone saves the count through
`POST /api/track/steps { steps, date }` (no backend change) so web and phone show the same number.

## Checklist

- [x] `npx expo install expo-sensors` (57.0.3; its Android manifest already adds ACTIVITY_RECOGNITION)
- [x] app.json: expo-sensors plugin `motionPermission`, `android.permission.ACTIVITY_RECOGNITION`
- [x] modules/orza-steps: expo-module.config.json (android only), build.gradle (orza-alarms pattern, no deps),
      AndroidManifest (permission, `uses-feature stepcounter required=false`, StepAlarmReceiver exported=false,
      StepBootReceiver exported=true), Kotlin (StepModels / StepStore / StepSensor / StepScheduler / StepSampler /
      StepReceivers / OrzaStepsModule), `src/index.ts` (requireOptionalNativeModule) + root `index.ts`
- [x] `src/lib/steps/counter.ts` (pure day math) + `policy.ts` (pure save / display rules) + `shared.ts` (source pick)
- [x] health bridges: `stepsBetween(ranges)` (Health Connect `aggregateRecord` / HealthKit `queryStatisticsForQuantity` sum)
- [x] platform readers `reader.android.ts` / `reader.ios.ts` / `reader.ts`
- [x] `store.ts` (per user/day: sent / server / finalizedFor; Android permission history), `sync.ts` (refresh +
      save + background + sign-out), `useSteps.ts` (`useStepsAutoSync`, `useTodaySteps`)
- [x] background: the existing alarm task (`lib/alarms/background.ts`) also runs `syncStepsInBackground()` (no second task)
- [x] sign-out: `lib/auth.tsx` clearLocal → `clearStepsOnSignOut()` (stop sampler + clear samples)
- [x] Today `StepsCard` (replaces StepsTile; manual `StepsSheet` kept as fallback); Health screen `StepsAutoCard`
- [x] `scripts/tests/steps-counter.test.ts` + `npm run test:steps` — 38/38
- [x] checks: typecheck ✓, lint ✓, test:alarms 34/34 ✓, test:steps 38/38 ✓
- [x] Kotlin re-read line by line (imports, nullability, API levels: java.time / BOOT_COUNT / flush need ≤ 26 =
      minSdk; PendingIntent FLAG_IMMUTABLE; receivers exported=false except the boot/shutdown one)
- [x] `expo config --type introspect`: NSMotionUsageDescription set, ACTIVITY_RECOGNITION in the manifest;
      `expo-modules-autolinking resolve --platform android` lists `expo.modules.orzasteps.OrzaStepsModule`
- [x] `npx expo export` android ✓ (6.8 MB HBC) / ios ✓ (6.7 MB HBC), outside the repo
- [x] README conventions bullet ("Steps")
- [x] commit

## Decisions / deviations from the design (and why)

1. **Each day takes the HIGHER of the sources** (Health Connect / Apple Health vs the phone counter) instead of a strict
   priority. Health Connect is filled by other apps on their own schedule (Samsung Health / Google Fit sync every so
   often), so for *today* the phone counter is usually ahead; a watch in the health store usually beats the phone. Both
   measure the same walking, so the max never double counts. Ties go to the health store. A health-store 0 counts as
   "no data" (HealthKit reports denied reads as no data; an empty Health Connect day means nothing synced into it).
2. **Never lower a day's count** — not just "never below this phone's own last save" but also never below a higher
   count already on the server (typed on the website, the server's Health-import mirror, another phone). Same rule as
   the server's own Health import (`steps = max(existing, synced)`). The design's "unless the source changed" exception
   was dropped: with max-of-sources a lower value after a source change only happens when the better source became
   unreadable (permission revoked, background read), which must not lower the day. Before each save the phone checks
   the server's current value (Today's React Query data when < 10 min old, else `GET /dashboard/today?date=`), so a
   value typed on the web in between is never overwritten by a lower one.
3. **Android sampler alarms are allow-while-idle (`setAndAllowWhileIdle`), not `setInexactRepeating`.** Android 9+
   delivers NO sensor events to an app in the background; an allow-while-idle alarm puts the app on the temporary
   power allow-list for ~10 s, which makes it "active" again so the read works. A plain inexact repeating alarm would
   run the receiver but the sensor read would time out. Still inexact, still no extra permission. The periodic one is
   re-armed on every run (~hourly, system-batched) and also re-sets the midnight pair (self-healing chain).
4. **Keep-counting registration.** The platform docs for `TYPE_STEP_COUNTER` say an app must stay registered for the
   counter to count. Many phones (Samsung, Pixel…) count regardless, but some don't. The module keeps one batched
   (10 min latency, non-wake-up → CPU sleeps, no wakelock) listener registered while ÖRZA's process lives (module
   create, start, every alarm / boot run). It can't keep the counter alive while the process is dead, see open issues.
5. **Sensor read** = register, `flush()`, take the newest value delivered within 400 ms of the first event (or at
   flush-complete), unregister; 3 s timeout. App reads are stored only if the last stored sample of the same boot is
   ≥ 10 min old (cumulative counter → no steps lost, fewer writes); alarm / boot / shutdown samples are always stored
   (except an identical one < 1 min old). Samples also carry `elapsed` (elapsedRealtime) — the day math uses it to
   order readings within a boot (immune to wall-clock changes), to find the boot instant (credit post-reboot steps
   from boot time, not from the last pre-reboot reading) and to detect a reboot when BOOT_COUNT is unknown.
6. **First reading ever:** if the phone booted earlier the same local day, its counter is exactly that day's steps
   since boot (credited from boot time); otherwise counting starts at that reading and the day is partial → Today says
   "Counting since 3:12 pm — earlier steps today weren't seen by this phone." (Health Connect / Apple Health /
   CMPedometer have history, so this only affects the Android phone counter's first day.) A reboot's off-time counts
   as covered (an overnight auto-update doesn't make the next day "partial").
7. **Absurd deltas:** > 50 000 steps/h, judged over at least 15 min (a stale/batched reading can bunch a few minutes of
   steps into a short interval). A rejected reading is remembered: if the next one is plausible relative to it, the
   counter really jumped and counting carries on from there; otherwise it was a one-off glitch.
8. **Midnight samples** follow the member's profile time zone (passed to native by `start(tz)`), at midnight ± 5 min
   (≥ 9 min apart, the allow-while-idle minimum spacing in Doze).
9. **Permission UX:** "Count my steps automatically" → explain sheet (why, privacy, "next your phone asks …") → system
   prompt (Android `PermissionsAndroid` ACTIVITY_RECOGNITION; iOS `Pedometer.requestPermissionsAsync` → Motion &
   Fitness). `never_ask_again` / iOS `canAskAgain:false` → "Open Settings" with the exact path. Android 8/9 need no
   run-time permission. Manual "Log steps" shows only when no automatic source exists (no counter / web) or the
   member refused (denied / blocked); "undetermined" shows the CTA only.
10. Health Connect / Apple Health are used for steps only while the member has them **connected in ÖRZA** (Health
    screen) — "Stop syncing" there also stops their use on Today.
11. Sign-out stops the Android sampler and clears its raw samples (`clearStepsOnSignOut`). Per-user save records stay
    (counts only, keyed by user id).

## Open issues / follow-ups (for the lead)

- **Phones whose step counter only counts while an app is registered** (the platform contract; seen on some OEM
  builds): between ÖRZA's process lifetimes those steps are not counted. Options: (a) Google's *Recording API on
  mobile* (`play-services-fitness` `LocalRecordingClient`, battery-efficient background step recording with 10 days of
  history, no account, GMS only) — the most "perfect" fix; (b) an optional foreground service (`foregroundServiceType
  health`, ongoing "Counting steps" notification, Play Console declaration). Both need a product decision; not done.
  Members with Health Connect fed by Samsung Health / Google Fit / a watch are unaffected (max of sources).
- `ACTION_SHUTDOWN` reaches manifest receivers only below Android 9 → steps between the last sample (≤ ~1 h) and a
  shutdown are lost on newer phones. Minor.
- Two phones auto-counting for one member: each only raises the count, so the higher phone wins per check — fine; but
  the counts never add up (by design: same person).
- Health Connect reads from the background need `READ_HEALTH_DATA_IN_BACKGROUND` (not requested): background runs
  use the phone counter only (never lowering), the app in front adds Health Connect.
- iOS HealthKit is unreadable while the phone is locked: background runs there use CMPedometer.
- D1 device checks: samples keep growing with the app closed (`getStatus().samples`, reasons `periodic` / `midnight`
  in `getSamples`) — this confirms Android hands sensor events to the allow-while-idle receiver (decision 3); grant flow + blocked → Settings round trip; Today number moves while walking (60 s cadence);
  `adb shell dumpsys alarm | grep orzasteps` shows PERIODIC + MIDNIGHT; reboot → `getStatus()` armed again and a
  `boot` sample; Doze (`adb shell dumpsys deviceidle force-idle`) → the midnight alarm still samples; the web shows the
  same number after a minute; sign-out → alarms cancelled, samples cleared.
