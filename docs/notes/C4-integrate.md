# C4 — integration + "Alarms on this phone" UI

Resume: read this file + `git status`, continue from the first unchecked item. Ownership: any mobile file.

## Research (node_modules / v57 docs — not from memory)
- **Custom entry** (docs.expo.dev/router/installation, "Custom entry point to initialize and load side-effects"): a root
  `index.js|ts` with the side-effect imports first and `import 'expo-router/entry';` LAST; `package.json` `"main"` points
  at it. expo-background-task v57: `TaskManager.defineTask` "needs to be called in the global scope, not in a React
  component"; `registerTaskAsync` can run in components; `minimumInterval` is a floor (≥ 15 min), iOS often waits longer.
- **RN 0.86 `Linking.sendIntent(action, extras?)`** (Libraries/Linking/Linking.d.ts; Android IntentModule.kt) rejects when
  `resolveActivity` finds nothing → used only as a fallback; the battery page opens natively (`openBatterySettings`).
- **expo-image 57** `Image.loadAsync(source: ImageSource | string | number)` → `ImageRef extends SharedRef<'image'>`;
  **expo-image-manipulator 57** `ImageManipulator.manipulate(source: string | SharedRef<'image'>)` → so a bundled sample
  asset can be rendered to a JPEG file (`saveAsync`) for the test alarm (Android BigPicture / iOS attachments need `file://`).
- C2 module (`modules/orza-alarms`): `scheduleOne(item)` (test items `key 'test:<ts>'`, `kind 'test'`, survive
  `scheduleAll`, no dose recorded), `silenceRinging()`, `releaseLockScreen()`, `requestUnlock()`, `getStatus()`.
  Tap on a ringing alarm → native silences it (`orza_alarm_opened`); full-screen launch → keeps ringing until answered.
- C3 iOS adapter: `presentInApp` only for alarms with doses; actions with no doses are ignored; `isAlarmKey` only matches
  dose:/snooze:/reminder:/refill: → a `test:` notification survives `schedule()`.
- Alarm screen (B2b) loads `GET /meds/doses?at=` — offline it showed "We couldn't load this alarm": fixed with a
  fallback built from the engine's cache (`orza-alarms.json`: meds + day logs) and the cached photo files, actions queued.
- Keys from an alarm route (`/alarm?at=<scheduledFor>[&med=]`): `dose:<at>`, `snooze:<med>:<at>`, `snooze:<at>`.

## Decisions
- **Dismiss on open — only when opened by a tap** (`features/alarm/ringing.ts`): a tap → the alarm's notification is
  dismissed as soon as the doses load (keys `dose:<at>`, `snooze:<at>`, `snooze:<med>:<at>`). Raised by the RINGING
  alarm — Android full-screen launch over the lock screen (`getStatus().overLockScreen`) or an alarm that rang while ÖRZA
  was open (adapters set `ringing: true` on the `open` event → the engine adds `ringing=1`) — it keeps ringing: dismissing
  then would silence an alarm the moment it lights up a locked phone. The first press of Take / Snooze / Skip / Take all /
  Close calls `silenceRinging()` (Android), and once every dose is handled the keys are dismissed (the engine's
  `settledKeys` do the same after its next sync). A tap already silences natively (C2).
- Leaving the alarm for the rest of the app (`Go to medicines`, `Add a photo`) asks `requestUnlock()` first; closing /
  unmounting calls `releaseLockScreen()`.
- One alarm screen per instant: `lib/alarms/presence.ts` tracks the open alarm screens (a stack); the engine's `open`
  handler skips an alarm already on screen; `releaseLockScreen()` runs when the LAST alarm screen unmounts. Close over
  the lock screen releases first (the phone returns to its lock screen), then navigates back.
- Offline alarm: `features/alarm/offline.ts` builds the doses from the cache (`isActed` overlay + pending queue) with
  the cached `file://` photos; actions go to the engine queue (`enqueueDoseActions`) and are sent when back online.
- Test alarm (`lib/alarms/test.ts`): Android `scheduleOne` (rings like a real alarm, full screen when locked); iOS a
  time-sensitive notification `test:<ts>` with the alarm sound and photo copy. Photo = first active medicine photo
  (cached / downloaded without pruning) else the bundled sample (`assets/images/alarm-sample.png` → JPEG file). Opens
  `/alarm?test=<at>` (key `test:<at>`) — a demo screen that records nothing; what the test showed is kept in
  `orza-alarm-test.json` (deleted on sign-out) so the demo finds its photo when the alarm cold-starts the app. iOS test
  notification has no buttons (no category: actions without doses are ignored by the adapter).
- Status card (`features/alarms/AlarmStatusCard.tsx`): full (Reminders) / compact (Medicines). Engine state gains
  `next` (upcoming ring alarms with names). Battery tip from a new native status field `batteryUnrestricted`.
- First-run prompt (`features/alarms/AlarmPermissionPrompt.tsx`): a store + host sheet mounted in `(app)/_layout`,
  triggered after the first non-SOS medicine is created and when a prescription was applied, only when notifications
  aren't granted (and not dismissed in the last 24 h); "Allow" → system prompt (`requestAlarmPermission`) or Settings.
- Android reminders channel: `features/reminders/notifications.ts` stops creating its own `reminders` channel and uses the
  module's `orza_reminders` id (C2 request) — the Android 13 prompt works because the module's channels exist at start.
- iOS sound: alarm tone lengthened to ~27 s (chime repeated, 22.05 kHz to keep it small); Android loops it anyway.

## Checklist
- [x] notes (this file)
- [x] index.ts custom entry + package.json main
- [x] root layout: installNotificationHandling() at module scope
- [x] reminders api events (afterChange, quiet hours, resume) + settings preference event + permission event
- [x] reminders notifications.ts: channel id orza_reminders / permission → engine
- [x] engine: `next` upcoming in sync state; photos `ensureAlarmPhoto` / `cachedAlarmPhotoUri`
- [x] engine: presence-aware `open` (lib/alarms/presence.ts) + `ringing` flag on adapter `open` events
- [x] native: `batteryUnrestricted` + `openBatterySettings` (Kotlin + JS types)
- [x] iOS: presentInApp for `test:` alarms
- [x] test alarm (lib/alarms/test.ts) + sample photo asset (script)
- [x] alarm screen: silence / dismiss / release / unlock / test mode / offline fallback (4.5 s wait) + queued actions
- [x] AlarmStatusCard full + compact; Reminders screen copy; Medicines tab (+ QuietHoursCard dose count)
- [x] first-run permission prompt + triggers (med create, rx done)
- [x] longer alarm tone
- [x] 3b app.json `android.networkInspector: false` (expo-build-properties) + config.ts dev guard (no silent prod fallback) + README .env.local
- [x] checks: typecheck, lint, expo-doctor, test:alarms, config introspect, export android + ios (outside repo)
- [x] README conventions + PROGRESS (C1–C3 ticked, device test plan, backend requests) + commit

## Files added in C4 (after the 4932dc0 checkpoint)
- `src/lib/alarms/presence.ts` — open alarm screens (one per alarm; lock-screen release on the last close).
- `src/features/alarm/offline.ts` — alarm doses from the engine cache + queued actions + cached photos (web doseStatus rules).
- `src/features/alarm/ringing.ts` — `useAlarmRinging` (dismiss on tap, silence, close over the lock screen, unlock to leave).
- `src/features/alarms/status.ts` — `usePhoneAlarmStatus()`, `whenText`, `namesText`, `quietDosesText`.
- `src/features/alarms/AlarmStatusCard.tsx` — full (Reminders) / compact (Medicines).
- `src/features/alarms/prompt.ts` + `AlarmPermissionPrompt.tsx` — first-run sheet (mounted in `(app)/_layout`).
- Changed: alarm screen (route split `AlarmRoute` → `MedicineAlarm` keyed by `at` / `TestAlarm`), `features/alarm/api.ts`
  (fallback + queued presses), `AlarmDoseCard` (`onAddPhoto` prop), adapters (`ringing` on in-app `open`), `useAlarmSync`
  (presence, `ringing=1`), `test.ts` (`/alarm?test=<at>`, persisted record), `store.ts` / `cleanup.ts` (test record),
  reminders screen / NotificationsCard / QuietHoursCard copy, Medicines tab, meds + rx mutations (prompt), `lib/config.ts`
  + root layout (API URL guard), app.json (`android.networkInspector: false`), `.env.example`, README.

## Verification (2026-10-19)
- `npm run typecheck` ✓ · `npx expo lint` ✓ (whole project) · `npm run test:alarms` 28/28 ✓.
- `npx expo config --type introspect` ✓: Android gradle property `EX_DEV_CLIENT_NETWORK_INSPECTOR=false` (iOS keeps the
  default), sounds `orza_alarm.wav`, iOS entitlements time-sensitive + aps-environment, SCHEDULE_EXACT_ALARM /
  USE_FULL_SCREEN_INTENT / RECEIVE_BOOT_COMPLETED; no android/ ios/ folders created.
- `npx expo export --platform android` ✓ 6.7 MB HBC, `--platform ios` ✓ 6.6 MB HBC (2263 modules, `alarm-sample.png`
  bundled) — output in the scratchpad, outside the repo. A `--dev --no-bytecode` export shows `API_CONFIG_ERROR` reading
  `EXPO_PUBLIC_API_URL` from the dev env and the `.invalid` fallback (no production origin in dev).
- `npx expo-doctor` 20/21: only patch updates published since Phase B (`@expo/ui` 57.0.25, `expo` 57.0.30,
  `expo-router` 57.0.28) — not installed here (step rule); `npx expo install @expo/ui expo expo-router`.

## Open / for D1–D2
- Nothing here ran on a device. The Kotlin module (C2 + `openBatterySettings` / `batteryUnrestricted` / `onAlarmShown`)
  has never been compiled — first Android dev build.
- Alarm screen in the foreground on an unlocked phone doesn't keep the screen awake (Android does over the lock screen
  natively) — `npx expo install expo-keep-awake` then `useKeepAwake()` while doses are open (not installed: step rule).
- iOS test notification has no action buttons (tap opens the demo); iOS Critical Alerts is a CEO decision (C3).
- Expo Router deep links to an already-open `/alarm` may update params instead of pushing: the screen is keyed by `at`,
  so it restarts cleanly either way.
