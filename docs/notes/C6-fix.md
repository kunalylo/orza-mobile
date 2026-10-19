# C6-fix — Phase C review: verify + fix (Android module, engine, iOS adapter)

Resume: read this file + `git status`, continue from the first unchecked item. Ownership: any mobile file.
Nothing native can be compiled here — every Kotlin edit is re-read for imports / nullability / API levels.

## Research (verified in node_modules sources — not from memory)
- **RN 0.86 `ReactHostImpl.onNewIntent`** (ReactHostImpl.kt:692-710): emits the `url` event only when
  `currentReactContext != null`; otherwise `raiseSoftException(… "context is not ready")` and the intent is dropped.
  **`IntentModule.getInitialURL`** reads `currentActivity.intent` (ACTION_VIEW + data) — `getIntent()` is the ORIGINAL
  launch intent unless someone calls `setIntent()` (Activity.onNewIntent does nothing by default).
- **expo 57 `ReactActivityDelegateWrapper.onNewIntent`**: returns false (→ `Activity.onNewIntent`, no listener) until
  `loadAppReady` completes; `loadAppReady` completes synchronously inside `onCreate` (UNDISPATCHED coroutine) unless a
  delay-load handler (expo-updates) holds it. Then every `ReactActivityLifecycleListener.onNewIntent` runs, then RN's.
- **expo-router 57** `useLinking.native.js:184-200` — Android initial URL = `Linking.getInitialURL()` (RN), raced with
  a 150 ms timeout; iOS uses `ExpoLinking.getLinkingURL()`.
- **Web `recordDose`** (web `src/lib/care/meds.ts`): overwrites status unconditionally; `take` lowers stock when
  `prev.status !== 'taken'`; `acted_at` / `snooze_until` = server now. **`GET /api/meds/doses?at=<iso>`** returns every
  dose of that instant (± 30 s) with its status / `acted_at` (acted ones included) — used before sending a queued
  snooze / skip.
- `loadAlarmCache(userId)` returns the SAME in-memory object every call (store.ts) — mutations are shared with a running
  sync; `saveAlarmCache({...cache})` replaces it with a shallow copy (nested objects still shared).

## Verdicts
| id | verdict | fix |
|---|---|---|
| F1 | confirmed | `scheduleAll` keeps undelivered past-due items (≤ MAX_LATE_MS) and re-sets them (fire at once); `rescheduleStored(false)` uses MAX_LATE_MS instead of 2 min; `dismiss(key)` also drops a PAST-DUE pending entry (the engine dismisses every settled key on each sync, the alarm screen when its doses are handled) |
| F2 | confirmed | `AlarmActivityListener.onNewIntent`: alarm intent → `activity.setIntent(intent)` before `handle`; JS safety net: root layout releases the lock screen when no alarm screen opened within 8 s |
| F3 | confirmed (the missed-dose part); direct boot NOT done | missed ring items up to 12 h (reboot) and fires later than MAX_LATE_MS (≤ 12 h) post a quiet "Missed" notification with Take / Snooze / Skip + photos; direct-boot awareness left for D1 (Application.onCreate of the RN app would run before the first unlock — must be proven on a device first) |
| F4 | confirmed | native status `alarmChannelImportance` / `alarmChannelSound` / `alarmChannelSilenced` (importance < DEFAULT or no sound) + `alarmChannelPopup`; adapter `silenced` → alarms stay scheduled but `alarmsLocal` false + fix-it row; `openNotificationSettings` opens the channel page when silenced too |
| F5 | confirmed | root cause in JS: a sent action vanished from the planner's data when the refetch failed → server-confirmed logs (flush, alarm screen, Today screen) are kept in the cache (`recent`) and merged over older day logs until a later refetch covers them; native rule unchanged (keeping drained snoozes natively would double-ring with the plan's split keys, C5L-7) |
| F6 | confirmed | `writeText` returns success; `scheduleAll` / `scheduleOne` throw before touching AlarmManager when pending.json can't be written → JS rejects → engine declares false + shows the error |
| C5L-1 | confirmed | `alarmAdapter.snoozeNow(item)` (Android `scheduleOne`, iOS notification + native-snooze grace); alarm screen + Today snooze call `alarmSnoozePressed` BEFORE the POST (also offline); sent logs kept (`recent`, see F5) |
| C5L-2 | confirmed | snooze / skip never apply to a dose already taken / skipped: filtered in `recordAlarmAction`, for drained native actions, before the iOS re-ring, in the planner overlay and before the queue sends (fresh `GET ?at=`); Android: a partly-handled alarm still showing is re-posted (quietly) with only the open doses (`refreshShowing`) so its buttons / photos / texts no longer include the taken one |
| C5L-3 | confirmed | `supersedeQueuedDose` on any in-app success; planner applies a pending action only when it isn't older than a newer server log (60 s skew) and never lets a pending snooze / skip override taken / skipped; flush drops a queued snooze / skip whose dose is already taken / skipped |
| C5L-4 | confirmed | ring items get the whole cap (reminders fill what's left); when doses are cut the last scheduled dose alarm says "Open ÖRZA to set your next alarms"; backend request `alarms_local_until` |
| C5L-5 | confirmed | imminent items stay in `keys` (pending one left alone); never cancel a pending notification of ours due within 5 s |
| C5L-6 | confirmed | adapters THROW when the permission can't be read; sync keeps the alarms + previous declaration and reports the error |
| C5L-7 | confirmed | snoozes of one scheduled time group when their ends are within 60 s; iOS cancels a graced native snooze once the plan carries snoozes covering its doses |
| C5L-8 | confirmed | last declaration persisted in SecureStore (`orza.device.declared`, cleared on sign-out / unregister) and loaded before the first registration |
| C5L-9 | confirmed | iOS: no sound + no banner + no lock screen (Notification Center only) → `silenced` (alarmsLocal false + warning) |
| C5L-10 | confirmed | `onAction` listeners return "handled"; `presentInApp` hides the banner only when the engine opened / is showing that alarm; presence tracks focus — an alarm screen buried under another screen isn't "on screen" (a new one is pushed) |

## Checklist
- [ ] notes (this file)
- [ ] Kotlin: F1 (scheduleAll / rescheduleStored / dismiss), F6 (writeText → Boolean, throw), F3 (missed quiet), F4 (status fields + settings), F2 (setIntent), refreshShowing (C5L-2)
- [ ] module JS (types + OrzaAlarms.ts): new status fields, `refreshShowing`
- [ ] adapter contract + noop: `silenced`, `snoozeNow`, `refreshShowing`, listener returns handled, status throws when unreadable
- [ ] Android adapter: status (silenced, throw), snoozeNow, refreshShowing, open handled
- [ ] iOS adapter: C5L-5, C5L-6, C5L-7, C5L-9, C5L-10, snoozeNow, pre-snooze dose filter (C5L-2)
- [ ] plan.ts: C5L-3 overlay rule, C5L-7 grouping, C5L-4 cap + continuation, `snoozeAlarmItem`, `partialAlarms`
- [ ] queue.ts: send check (GET ?at=), recent logs, `supersedeQueuedDose`
- [ ] sync.ts: unknown status, silenced, recent merge, action filter, `ringAgainAfterSnooze`, `doseActionSaved`, refreshShowing step
- [ ] bridge (`lib/alarms/bridge.ts`) + alarm screen / Today screen calls
- [ ] device.ts persisted declaration (C5L-8)
- [ ] presence focus + useAlarmSync handled (C5L-10); root-layout lock-screen safety net (F2)
- [ ] status card: silenced row
- [ ] tests (planner) updated + new
- [ ] checks: typecheck, lint, test:alarms, expo-doctor, config introspect, export android + ios (outside repo)
- [ ] PROGRESS.md review summary + commit
