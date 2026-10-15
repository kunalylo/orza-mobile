# C3 — iOS notifications + app config

Resume: read this file + `git status`, continue from the first unchecked item.

## Ownership
`src/lib/alarms/adapter.ios.ts`, `src/lib/alarms/notifications-ios.ts` (new), `src/lib/notifications.ts` (new, shared
foreground handler + response routing), `app.json`, this notes file. Everything else → cross_area_requests.

## Research (installed expo-notifications 57.0.23 — build/*.d.ts, build/*.js, ios/*.swift; v57 docs)
- **Scheduling**: `scheduleNotificationAsync({identifier, content, trigger: {type: SchedulableTriggerInputTypes.DATE, date}})`.
  iOS turns a DATE trigger into `UNTimeIntervalNotificationTrigger(timeInterval: floor(ts/1000) − now)` (TriggerRecords.swift
  `DateTriggerRecord`) → an interval ≤ 0 throws → never schedule items < ~2 s away. Interval triggers are absolute
  (unaffected by timezone / clock-format changes). `getAllScheduledNotificationsAsync()` returns the trigger as
  `timeInterval` (not the instant) → store `at` + a signature in `content.data` to diff. Same identifier = the new
  request replaces the pending one (UNUserNotificationCenter `add`). `cancelScheduledNotificationAsync(id)`,
  `dismissNotificationAsync(id)`, `getPresentedNotificationsAsync()`.
- **Content** (`NotificationContentInput`): `title, body, data, sound, categoryIdentifier, attachments, interruptionLevel`
  (`'passive' | 'active' | 'timeSensitive' | 'critical'`), no `threadIdentifier` in the TS type. `sound`:
  `boolean | 'default' | 'defaultCritical' | 'defaultRingtone' | '<file.wav>'`; a custom name that isn't in the bundle
  logs `jsLogger.error` on every schedule (SchedulerModule `customSoundExists`) and iOS falls back to the default sound →
  check `new File(Paths.bundle, 'orza_alarm.wav').exists` once and use `'default'` until the file ships.
- **Attachments** `{identifier, url, type, typeHint?, hideThumbnail?, thumbnailClipArea?, thumbnailTime?}`; native builds
  `try? UNNotificationAttachment(identifier:url:options:)` while building the request — a bad file is silently dropped;
  iOS MOVES the file into its own store at that moment → always attach a fresh copy (Paths.cache/orza-alarm-attach/),
  never the cached photo (Documents/orza-alarm-photos/, owned by photos.ts which prunes that folder).
- **Categories**: `setNotificationCategoryAsync(id, actions, options)`; id must not contain ":" or "-" (docs).
  Action `options.opensAppToForeground` — native (TriggerRecords.swift) inserts `.foreground` ONLY when it is `true`, so
  pass it explicitly. Docs (Notifications.types.d.ts): "If `false` and your app is killed … listeners will not be
  triggered". `registerTaskAsync` docs: "Only on Android, the task also runs in response to a notification action tap".
  NotificationCenterManager.swift calls `completionHandler()` immediately after offering the response, so a background
  action on a killed app would be lost (or run seconds later, if at all) → **all three actions open the app**.
- **Responses**: `addNotificationResponseReceivedListener`, `getLastNotificationResponse()` (sync; Async variant is
  deprecated), `clearLastNotificationResponse()`. Responses that arrive before the emitter module exists are queued natively
  (`pendingResponses`) and handed to it when it is created (→ `lastResponse`), so a cold start via a notification tap or
  action is readable with `getLastNotificationResponse()`. `DEFAULT_ACTION_IDENTIFIER` = tap on the body.
- **Foreground**: `setNotificationHandler({handleNotification})` must answer within 3 s or the notification is dropped;
  `NotificationBehavior {shouldShowBanner, shouldShowList, shouldPlaySound, shouldSetBadge}`.
- **Permissions**: `getPermissionsAsync()` / `requestPermissionsAsync({ios:{allowAlert, allowBadge, allowSound}})` →
  `ios.status` (`IosAuthorizationStatus` NOT_DETERMINED/DENIED/AUTHORIZED/PROVISIONAL/EPHEMERAL), `allowsAlert`,
  `allowsSound`, `allowsDisplayOnLockScreen`, `allowsDisplayInNotificationCenter`. The time-sensitive switch is NOT exposed.
  Provisional = quiet delivery → not an alarm (treated as "undetermined, can ask").
- **Config plugin** (plugin/build/withNotificationsIOS.js): `sounds` are `copyFileSync`'d into the Xcode project
  (and `res/raw` on Android) during prebuild → **a missing file fails the EAS build**; sets `aps-environment` (mode,
  default development). `npx expo config --type introspect` does not run the Xcode-project mod, so it won't catch it.
- **EAS capabilities** (docs build-reference/ios-capabilities): Time Sensitive Notifications
  `com.apple.developer.usernotifications.time-sensitive` and Push Notifications `aps-environment` are auto-synced.
- iOS keeps at most 64 pending local notifications (soonest win) → `maxScheduled = 60` leaves room for Snoozes / tests.

## Decisions
- Identifier = plan key (`dose:<iso>`, `snooze:…`, `reminder:…`, `refill:…`); ours = identifiers with those prefixes.
  `schedule()` diffs against pending: cancel ours not in the plan, keep those whose `data.sig` matches, (re)add the rest.
  Operations are serialised (one promise chain) so schedule / snooze / cancelAll never interleave.
- Content: doses/snoozes `interruptionLevel: 'timeSensitive'`, sound `orza_alarm.wav` (when bundled) else `'default'`,
  category `orzadose` (1 medicine: Take / Snooze 10 min / Skip) or `orzadoses` (several: Take all / Snooze all / Skip
  all); reminders / refills `'active'`, default sound, no category (tap opens). One photo attachment (iOS shows one):
  the item's first downloaded photo (plan orders each medicine's first photo first), copied to a unique temp file.
- `data`: `{orza: 1, key, kind, ring, at, sig, path, url (= path), deepLink, doses: [{medId, scheduledFor}], photo}`.
- Actions open the app (`opensAppToForeground: true`, Skip `isDestructive`). Take / Skip / Snooze → dismiss the
  presented notification, Snooze schedules the re-ring itself at now + 10 min under `snoozeAlarmKey(...)` with the same
  texts + photo, then the event goes to `onAction` (buffered until the engine subscribes; deduped). A toast confirms.
- Foreground: a ring alarm arriving while the app is active and the engine listens → no banner (kept in the list,
  sound plays) and the alarm screen opens (`open` event); everything else → banner + list + sound.
- `src/lib/notifications.ts`: one handler + one response subscription for the whole app (cold start + live, deduped by
  notification id + action + date, last response cleared once handled), `notificationPath(data)` (path / url / orza://
  deep link → in-app path), in-app alarm presenter hook. Android: C2's native module owns its channels / alarms.
- `status()`: AUTHORIZED (with at least one of alert / lock screen / centre / sound on) → granted; DENIED → denied
  (`canAskNotifications: false`); NOT_DETERMINED / PROVISIONAL / EPHEMERAL → undetermined (can ask). `exact` /
  `fullScreen` undefined (not applicable / not readable). `openSettings(*)` → `Linking.openSettings()` (app settings page,
  which holds Notifications → Time Sensitive).
- `takeNativeActions()` → [] (every action opens the app, so JS always sees it).

## Checklist
- [x] notes (this file)
- [x] src/lib/notifications.ts (handler, response subscription + dedupe + cold start, path helper, in-app presenter)
- [x] src/lib/alarms/notifications-ios.ts (categories, sound check, content builder, attachment copies, permission mapping)
- [x] src/lib/alarms/adapter.ios.ts (PlatformAdapter: schedule diff, cancelAll, dismiss, status, request, openSettings,
      takeNativeActions, onAction + snooze re-ring + toast)
- [x] app.json (expo-notifications `sounds`, ios.entitlements time-sensitive; Android permissions untouched)
- [x] `npx expo config --type introspect` check (no android/ios folders left)
- [x] `npm run typecheck` ✓, `npx expo lint` ✓
- [x] device test plan + cross-area requests written in the report

## Verification
- `npm run typecheck` ✓, `npx expo lint` ✓ (whole project).
- `npx expo config --type introspect`: ios entitlements = `time-sensitive: true`, `aps-environment: development`
  (expo-notifications plugin), `healthkit`; UIBackgroundModes `fetch, processing` unchanged; no android/ ios/ folders.
- `npx expo export --platform ios` (output outside the repo, deleted) ✓ 6.5 MB HBC — the adapter is in the bundle.
- Scratch test (NOT in the repo): `<scratchpad>/c3test/adapter-ios.test.mts` with stubbed expo-notifications /
  react-native / expo-file-system (tsx + tsconfig `paths`) — 10/10: categories (all actions open the app, Skip
  destructive), content (time-sensitive, `orza_alarm.wav` when bundled, category per group size, one photo COPY, data
  without nulls), diffing (unchanged → no re-add, changed → only it, removed → cancelled, foreign ids untouched),
  attachment rejected → re-added without it, Snooze (dismiss, `snooze:<med>:<iso>` at +10 min with photo, event + toast,
  duplicate response ignored, kept through a re-plan in the 90 s grace), cold-start tap + action held until `onAction`,
  last response cleared, foreground in-app presentation vs banner, status mapping (provisional → undetermined, all
  display off → denied, denied → no prompt), cancelAll (pending + presented, foreign kept), snooze photo found after
  the app container moved.
- `assets/sounds/orza_alarm.wav` (C2) exists: PCM 16-bit mono 44.1 kHz, 6.0 s (iOS limit 30 s) → the plugin's
  prebuild copy will succeed.

## Notes for C4 / integration
- iOS plays a notification sound ONCE (≤ 30 s): the 6 s chime is short for an alarm → ask C2 for a ~28 s version
  (repeat the chime; Android's insistent channel loops it anyway).
- Silent switch: time-sensitive does NOT bypass mute (only Critical Alerts do — Apple-approved entitlement
  `com.apple.developer.usernotifications.critical-alerts`, medication reminders qualify). With it: `interruptionLevel:
  'critical'`, `sound: 'defaultCritical'` / a critical custom sound, request `allowCriticalAlerts`.
- Snooze inside quiet hours: the toast says it rings again, but the next plan (web parity) drops a re-ring inside
  quiet hours.
- `installNotificationHandling()` should also run from the root layout (Android / before sign-in).
