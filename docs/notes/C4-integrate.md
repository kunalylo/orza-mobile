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
- **No dismiss on open**: dismissing the alarm when the screen opens would stop a full-screen alarm the moment it lights
  up a locked phone. Instead: the first press of Take / Snooze / Skip / Take all / Close calls `silenceRinging()`
  (Android), and once every dose of the alarm is handled the screen dismisses `dose:<at>` / `snooze:…:<at>` (the engine's
  `settledKeys` dismiss does the same after its next sync). A tap already silences natively (C2).
- Leaving the alarm for the rest of the app (`Go to medicines`, `Add a photo`) asks `requestUnlock()` first; closing /
  unmounting calls `releaseLockScreen()`.
- One alarm screen per instant: `features/alarm/presence.ts` tracks the open alarm; the engine's `open` handler skips
  an alarm already on screen.
- Offline alarm: `features/alarm/offline.ts` builds the doses from the cache (`isActed` overlay + pending queue) with
  the cached `file://` photos; actions go to the engine queue (`enqueueDoseActions`) and are sent when back online.
- Test alarm (`lib/alarms/test.ts`): Android `scheduleOne` (rings like a real alarm, full screen when locked); iOS a
  time-sensitive notification `test:<ts>` with the alarm sound and photo copy. Photo = first active medicine photo
  (cached / downloaded without pruning) else the bundled sample (`assets/images/alarm-sample.png` → JPEG file). Opens
  `/alarm?test=1` — a demo screen that records nothing.
- Status card (`features/alarms/AlarmStatusCard.tsx`): full (Reminders) / compact (Medicines). Engine state gains
  `next` (upcoming ring alarms with names). Battery tip from a new native status field `batteryUnrestricted`.
- First-run prompt (`features/alarms/AlarmPermissionPrompt.tsx`): a store + host sheet mounted in `(app)/_layout`,
  triggered after the first non-SOS medicine is created and when a prescription was applied, only when notifications
  aren't granted (and not dismissed in the last 24 h); "Allow" → system prompt (`requestAlarmPermission`) or Settings.
- Android reminders channel: `features/reminders/notifications.ts` stops creating its own `reminders` channel and uses the
  module's `orza_reminders` id (C2 request) — the Android 13 prompt works because the module's channels exist at start.
- iOS sound: alarm tone lengthened to ~27 s (chime repeated, 22.05 kHz to keep it small); Android loops it anyway.

## Checklist
- [ ] notes (this file)
- [ ] index.ts custom entry + package.json main
- [ ] root layout: installNotificationHandling() at module scope
- [ ] reminders api events (afterChange, quiet hours, resume) + settings preference event + permission event
- [ ] reminders notifications.ts: channel id orza_reminders / permission → engine
- [ ] engine: `next` upcoming in sync state; photos `ensureAlarmPhoto` / `cachedAlarmPhotoUri`; presence-aware `open`
- [ ] native: `batteryUnrestricted` + `openBatterySettings` (Kotlin + JS types)
- [ ] iOS: presentInApp for `test:` alarms
- [ ] test alarm (lib/alarms/test.ts) + sample photo asset (script)
- [ ] alarm screen: silence / dismiss / release / unlock / test mode / offline fallback + queued actions
- [ ] AlarmStatusCard full + compact; Reminders screen copy; Medicines tab
- [ ] first-run permission prompt + triggers (med create, rx done)
- [ ] longer alarm tone
- [ ] checks: typecheck, lint, expo-doctor, test:alarms, config introspect, export android + ios (outside repo)
- [ ] README conventions + PROGRESS (C1–C3 ticked, device test plan, backend requests) + commit
