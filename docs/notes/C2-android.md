# C2 — Android native alarms (`modules/orza-alarms`, `src/lib/alarms/adapter.android.ts`)

Resume: read this file + `git status`, continue from the first unchecked item. Nothing here can be compiled locally (no
Android toolchain) — every Kotlin file was re-read for compile errors; the first EAS dev build is the real check.

## Ownership
`modules/orza-alarms/**`, `src/lib/alarms/adapter.android.ts`, `scripts/make-alarm-sound.mjs`,
`assets/sounds/orza_alarm.wav`, this notes file.

## Research (verified in node_modules sources / official docs — not from memory)
- **Local module autolinking** (expo-modules-autolinking 57.0.16 `commands/autolinkingOptions.js`,
  `dependencies/scanning.js`): `nativeModulesDir` defaults to `./modules`; a folder there without `package.json` is
  linked under its directory name (`orza-alarms`). `expo-module.config.json` → `"platforms"`, `"android": {"modules": [FQCN]}`.
  A `Package` is found by scanning for files ending `Package.kt` that literally contain
  `import expo.modules.core.interfaces.Package` (`platforms/android/android.js`).
- **Gradle** (expo-haptics / expo-linking build.gradle + `expo-module-gradle-plugin` `ProjectConfiguration.kt`): plugins
  `com.android.library` + `expo-module-gradle-plugin` (adds kotlin-android, compileOnly `:expo-modules-core`, SDK
  versions from the root project: min 26 / compile 36 / target 36 from expo-build-properties). Needs `android.namespace`
  and `defaultConfig.versionName` (PublicationInfo requires both). expo-notifications adds
  `implementation 'androidx.core:core:1.17.0'` — same here for NotificationCompat. Kotlin 2.1.20 (RN libs.versions.toml).
- **Module API** (expo-modules-core 57.0.23 `ObjectDefinitionBuilder.kt`, `Module.kt`, docs.expo.dev/modules/module-api):
  `Name`, `Events(vararg)`, `Function(name){}`, `AsyncFunction(name){ a: T -> }` (runs off the JS thread on the modules
  queue), `.runOnQueue(Queues.MAIN)` (`expo.modules.kotlin.functions.Queues`), Promise arg =
  `expo.modules.kotlin.Promise` (`resolve(Any?)`, `reject(code, message, cause)`), `OnCreate {}`, `OnDestroy {}`,
  `sendEvent(name, Map<String, Any?>)`, `appContext.reactContext: Context?`, `appContext.currentActivity`.
  No-arg form `AsyncFunction("x") { return@AsyncFunction 2 }` (expo-background-task).
- **Activity hooks** (`expo.modules.core.interfaces.ReactActivityLifecycleListener`): `onCreate(Activity, Bundle?)`,
  `onResume`, `onPause`, `onUserLeaveHint`, `onDestroy`, `onNewIntent(Intent): Boolean` (return false = keep RN's
  default), `onBackPressed`, `onContentChanged` — **no onStop** → `Application.ActivityLifecycleCallbacks` for that.
  `ReactActivityDelegateWrapper` (expo 57) passes the activity to `createReactActivityLifecycleListeners(activity)`,
  calls listeners' `onCreate` at the end of `onCreate`, and skips `onNewIntent` until the app is loaded.
- **Deep links**: RN `getInitialURL` / `onNewIntent` → `url` event only when `action == ACTION_VIEW` and `data != null`
  → our notification intents are `ACTION_VIEW` + `orza://alarm?at=…` + the launch activity's component +
  `FLAG_ACTIVITY_NEW_TASK`. MainActivity is `singleTask` (config-plugins `Scheme.js` adds the scheme filter to
  singleTask activities only) → a running app receives `onNewIntent`.
- **expo-notifications plugin** (`plugin/build/withNotificationsAndroid.js`): app.json `icon` → `@drawable/notification_icon`,
  `color` → `@color/notification_icon_color`, `sounds: [...]` → copied to `res/raw/<basename>` → `orza_alarm.wav` becomes
  `R.raw.orza_alarm` (looked up with `getIdentifier`, so the module compiles without it).
- **Exact alarms** (developer.android.com/develop/background-work/services/alarms/schedule + Play policy search):
  `SCHEDULE_EXACT_ALARM` is user-grantable, **not pre-granted on fresh installs targeting 13+** (our target 36) →
  check `AlarmManager.canScheduleExactAlarms()` (API 31) and send the user to
  `Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM` (`package:` URI). `USE_EXACT_ALARM` is auto-granted but Play restricts it
  to apps whose core function is an alarm clock / calendar → **not declared**. When the user grants it the system sends
  `AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED` → reschedule; when revoked the app is killed and
  future exact alarms are cancelled (the next app open re-plans). `setAlarmClock` = precise, leaves Doze;
  `setExactAndAllowWhileIdle` = precise, allowed in Doze (rate-limited); `setAndAllowWhileIdle` = inexact (Android 12+:
  within ~1 h), runs in Doze; `setWindow` windows < 10 min are clipped to 10 min. All alarms are cleared on reboot →
  `RECEIVE_BOOT_COMPLETED` receiver.
- **Full-screen intent** (Play Console help 13392821 + AOSP fsi-limits): Android 14+ apps targeting 14 keep
  `USE_FULL_SCREEN_INTENT` by default only with calling / alarm functionality (Play declaration); otherwise the user
  enables it → `NotificationManager.canUseFullScreenIntent()` (API 34) and
  `Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT` (`package:` URI). Without it the alarm is a heads-up notification.
- **NotificationCompat** — only long-standing APIs are used (BigPictureStyle `bigPicture(Bitmap)`, `bigLargeIcon(null as
  Bitmap?)` (cast avoids the Bitmap/Icon overload ambiguity), `setBigContentTitle`, `setSummaryText`; Builder
  `setFullScreenIntent`, `setTimeoutAfter`, `setCategory`, `setVisibility`, `addAction(int, CharSequence, PendingIntent)`)
  — `showBigPictureWhenCollapsed` / `setSilent` avoided because their availability couldn't be verified offline.
  `FLAG_INSISTENT` is OR-ed into `Notification.flags` after `build()`.
- **DND**: alarms with `CATEGORY_ALARM` / `USAGE_ALARM` pass "Priority only" DND when the user allows alarms (default).

## Decisions
- **Persistence**: `noBackupFilesDir/orza-alarms/{pending,shown,actions}.json` via `android.util.AtomicFile`, one
  process-wide lock (`AlarmStore`). Not backed up (alarm state must not be restored to another phone).
- **Scheduling** (`AlarmScheduler`): `scheduleAll(json)` replaces the pending set: keys missing from the new set are
  cancelled; kept: future `test:` items (C4's test alarm) and native snoozes whose action JS hasn't collected yet (a
  plan computed before the Snooze press must not cancel it). Exact allowed → ring items `setAlarmClock` (show intent =
  open the alarm), others `setExactAndAllowWhileIdle`. Not allowed (or SecurityException) → `setWindow(at, 10 min)` +
  `setAndAllowWhileIdle(at)` on a second PendingIntent; whichever fires first wins (the fire handler removes the key
  from `pending`; the second finds nothing). PendingIntents: `FLAG_IMMUTABLE | FLAG_UPDATE_CURRENT`, unique data URI
  `orza-alarm://fire/<variant>/<key>` (identity never collides), request code = hash. Fire extras carry `at`; a fire
  whose `at` doesn't match the stored item (re-scheduled meanwhile) is ignored. `maxScheduled` 200 (≤ 2 PIs each +
  silencers stays under Android's 500-alarm cap).
- **Firing** (`AlarmReceiver`, `goAsync` + background thread, the alarm wakelock is held until `finish`): ring items →
  channel `orza_alarms` (HIGH, `USAGE_ALARM`, `res/raw/orza_alarm` or the default alarm tone, long vibration), CATEGORY_ALARM,
  FLAG_INSISTENT, full-screen intent (deep link + `orza_alarm=true`), content intent (deep link), actions Take /
  Snooze 10 min / Skip, BigPicture = collage of up to 4 medicine photos (each med's first photo first; decoded with
  inSampleSize, centre-cropped cells on a 1024×512 canvas), large icon = first photo thumbnail. After **10 min** of
  ringing a silencer alarm re-posts it on the silent `orza_alarms_quiet` channel (stays in the shade with its actions,
  times out after 12 h). Reminders / refills → `orza_reminders` (DEFAULT importance, normal sound, auto-cancel, no
  full screen / insistent, times out after 6 h). Visibility PUBLIC (the photo + name is the point; the alarm screen
  shows them over the lock screen anyway).
- **Actions** (`ActionReceiver`): cancel the notification + silencer, record `{id, key, action, doses, snoozeMinutes, at}`
  in `actions.json`, Snooze → schedule a copy at now + 10 min under `item.snoozeKey` (JS passes
  `snoozeAlarmKey(scheduledFor, medIds)`), tagged with the action id (protected until drained). Then emit
  `onAlarmAction` if the module is alive. `takeNativeActions()` drains the queue atomically; the adapter's `onAction`
  drains on each event (exactly-once hand-over whichever path collects first). Test items: no action recorded.
- **Boot / time** (`BootReceiver`, exported — system broadcast; validates the action): BOOT_COMPLETED, QUICKBOOT_POWERON
  (OEMs), MY_PACKAGE_REPLACED, TIME_SET, TIMEZONE_CHANGED, SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED → re-schedule
  `pending`; ring items missed by ≤ 30 min while the phone was off ring immediately; older past items are dropped.
- **Lock screen** (`AlarmLockScreen` + `OrzaAlarmsPackage` listener): an intent with `orza_alarm=true` (full-screen
  intent) → `setShowWhenLocked(true)` + `setTurnScreenOn(true)` (API 27+; window flags on 26) + FLAG_KEEP_SCREEN_ON for
  3 min; the extra is removed so a re-created activity doesn't re-apply it. Released by JS `releaseLockScreen()` (alarm
  screen closes), when the activity stops (≥ 1.5 s after showing), or after 10 min — the rest of the app must never stay
  reachable over the keyguard.
- **Permission**: notifications via expo-notifications `getPermissionsAsync` / `requestPermissionsAsync`
  (POST_NOTIFICATIONS); `granted` additionally needs the `orza_alarms` channel not blocked. `exact` (31+) / `fullScreen`
  (34+) undefined below those APIs.
- **JS** (`modules/orza-alarms/index.ts` → `src/OrzaAlarms.ts`): `requireOptionalNativeModule('OrzaAlarms')` — null in
  Expo Go / web / iOS → `isOrzaAlarmsAvailable()` false and the adapter falls back to the no-op (`maxScheduled` 0 →
  alarmsLocal false). JSON strings across the bridge for items / actions.
- **Alarm tone**: `scripts/make-alarm-sound.mjs` synthesises a 6 s two-tone chime (16-bit PCM mono 44.1 kHz, soft attack,
  exponential decay, ends in silence → loops cleanly under FLAG_INSISTENT) into `assets/sounds/orza_alarm.wav`.

## Checklist
- [x] notes (this file)
- [x] `scripts/make-alarm-sound.mjs` + run → `assets/sounds/orza_alarm.wav`
- [x] `modules/orza-alarms/expo-module.config.json`, `android/build.gradle`, `AndroidManifest.xml`
- [x] Kotlin: AlarmModels, AlarmStore, AlarmNotifier (channels, notification, photos), AlarmScheduler, AlarmReceiver,
      ActionReceiver, BootReceiver, AlarmLockScreen + OrzaAlarmsPackage, OrzaAlarmsModule
- [x] JS: `modules/orza-alarms/index.ts`, `src/OrzaAlarms.types.ts`, `src/OrzaAlarms.ts`
- [x] `src/lib/alarms/adapter.android.ts` (PlatformAdapter on the module; no-op fallback)
- [ ] Re-read every Kotlin file (imports, nullability, API levels, PendingIntent flags, exported, R refs)
- [ ] `npm run typecheck` ✓, `npx expo lint` ✓
- [ ] device test plan + cross-area requests in the report
