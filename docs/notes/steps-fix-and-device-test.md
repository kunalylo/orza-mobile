# steps-fix-and-device-test — review fixes for auto steps + emulator test

Follows `steps-build.md` (commit `bc9bf2b`). Review findings N1–N7 (native) and F1–F11 (JS) verified one by one; fixes,
refutations and the D1 device test are logged here. Resume from the checklist.

Resumed after a usage-limit stop from WIP `a51733d` (all fixes drafted, unverified, lint failing). The resumed run
re-read every fix against its finding, fixed what was still wrong ("Resumed run" below), added the tests, then built.

## Checklist

- [x] N1 midnight samples: exact when "Alarms & reminders" is allowed, else an inexact chain whose worst case lands before midnight
- [x] N2 BOOT_COUNT change without a kernel reboot (elapsed decides)
- [x] N3 runtime ACTION_SHUTDOWN receiver while the process lives
- [x] N4 QUICKBOOT_* (unprotected) only re-arm, never sample; store collapses forced samples < 1 min apart
- [x] N5 samples + flags in noBackupFilesDir (not backed up / transferred), legacy prefs removed
- [x] N6 periodic spacing by App Standby bucket
- [x] N7 read waits for flush completion when flush() accepted; else event time
- [x] F1 never-lower guard reads the server right before every save, never Today's cache
- [x] F2 member edits (web lower than this phone's save, or Edit on the phone) → day base, new steps add on
- [x] F3 permission flow: read/publish single-flight, saves on their own queue, reader calls bounded
- [x] F4 past days final only when read + complete; up to 7 pending days
- [x] F5 long-gap estimate for today shown as estimate, not posted until the day is past
- [x] F6 session order by BOOT_COUNT / boot instant; wall clock re-anchored per boot
- [x] F7 counting starts mid-day on top of a saved count → base (saved + counted since)
- [x] F8 sign-out during prepare can't re-enable the sampler
- [x] F9 Today offline shows the steps card
- [x] F10 Today across midnight switches day
- [x] F11 tests for the sync decisions (`plan.ts` + `save.ts` against a fake server)
- [x] checks: typecheck ✓, lint ✓, test:alarms 34/34 ✓, test:steps 66/66 ✓
- [x] native rebuild (orza-mobile-build) + emulator test against the LOCAL server (safety gate SAFE first)
- [x] PROGRESS.md entry, commit, push

## Findings — verdicts and fixes

All 18 confirmed (none refuted). Kotlin facts checked against the SDK-36 sources / docs named in each finding.

- **N1 (confirmed)** — `set()` / `setAndAllowWhileIdle` may be delivered up to 1 h late (Android 12+; 75 % of the lead
  before). `StepScheduler.armMidnight`: with "Alarms & reminders" (`canScheduleExact`, same rule as orza-alarms: always
  true below 12) → `setExactAndAllowWhileIdle` at midnight ± 5 min (exact, still temp-allowlists the app for the sensor
  read; no new permission). Without it → an inexact chain: each alarm is set at the latest time whose WORST-case
  delivery is still 2 min before midnight (`latestTriggerBefore`: lead / 1.75, or lead − 1 h when capped), each run
  re-arms a closer one (shorter lead = smaller window) until one lands within 15 min of that deadline, then one at
  00:03. Frequent / Rare bucket: one pre-midnight sample within 3 h is enough (fewer alarms).
  `getStatus().exactMidnight` reports which mode is used.
- **N2 (confirmed)** — `counter.rebootedBetween`: with both boot clocks, rebooted ⇔ `b.elapsed < a.elapsed` or b's boot
  instant (ts − elapsed) is > 5 min after `a`; the same BOOT_COUNT with a growing elapsed is never a reboot, and a
  different BOOT_COUNT alone isn't either. BOOT_COUNT decides only without elapsed. Test: boot 41 → 42 with a
  continuous elapsed → 300, not 21 300.
- **N3 (confirmed)** — ACTION_SHUTDOWN reaches only context-registered receivers from Android 9.
  `StepSensor.keepCounting` (runs whenever the process lives: module create, start, every alarm / boot run) registers
  `StepShutdownReceiver` once (`RECEIVER_EXPORTED` on 13+: a protected system broadcast), which samples with goAsync;
  `stopCounting` unregisters it. Best effort: Android 14+ defers context-registered broadcasts to CACHED processes, so
  a cached process can still miss it. Loss window = time since the last stored sample (≤ ~1 h periodic + inexact
  delay, so up to ~2 h; longer in the Frequent / Rare buckets).
- **N4 (confirmed)** — QUICKBOOT_* aren't protected broadcasts. QUICKBOOT_POWERON now only re-arms alarms that are
  MISSING (never samples, never pushes an armed alarm out); the QUICKBOOT power-off actions are no longer in the filter.
  Boot samples only for the protected BOOT_COMPLETED / MY_PACKAGE_REPLACED; `StepStore.add` collapses a forced sample
  < 1 min after the last one of the same boot (replaces it; dropped when the counter didn't move).
- **N5 (confirmed)** — expo-secure-store's backup rules include every shared-prefs file. Samples and settings now live in
  two JSON files in `noBackupFilesDir` (never in Auto Backup / device transfer), written through `AtomicFile` (synced,
  then renamed: a shutdown sample survives the power-off), one lock around every read-modify-write; the legacy
  `orza_steps` prefs are deleted on first use. Flag writes no longer rewrite the samples.
- **N6 (confirmed)** — App Standby alarm quotas are per app (shared with medicine reminders). `standbyBucket()` (API 28,
  own app, no permission): Active / Working set → hourly; Frequent → 3 h; Rare → 4 h; Restricted → no periodic and no
  midnight samples (its single alarm a day is left to medicines). Trade-off: longer gaps = more time-split estimates
  (F5) and more loss at a reboot; the counter is cumulative, nothing else is lost.
- **N7 (confirmed)** — `OneRead`: when `flush()` is accepted the read ends at `onFlushCompleted` (or the 3 s timeout,
  keeping the newest value); SETTLE_MS (400 ms) only when flush returned false / threw, and then the reading is stamped
  with the event's own time (event.timestamp on the elapsedRealtimeNanos base, if ≤ 15 min old, else "now").
- **F1 (confirmed)** — `save.ts` reads the server (`GET /dashboard/today?date=`) right before EVERY post (≤ 1 GET per
  save; saves stay throttled) and never trusts Today's cache. Real reads are remembered with the time the request
  STARTED (`serverSeen.ts`; fed by Today's dashboard query and the sync's own GET, never by this phone's saves).
  Remaining race, documented: a count saved elsewhere between that GET and the POST (~1 s; the endpoint has no
  conditional write).
- **F2 (confirmed)** — a real read, requested after this phone's last save completed, that is LOWER than that save is
  the member's edit (automatic saves only ever raise). It becomes the day's BASE (`policy.DayBase`, kind `edit`): the
  day is then the member's number + what is counted after it; a past day edited with nothing counting stays at it.
  The card has "Not right? Edit" (today) / "Edit" (past days) → `StepsSheet` mode `edit` → the same base. A change of
  the best source re-anchors the base (`rebased`, no double counting). Label "Edited by you".
- **F3 (confirmed)** — `refreshSteps` = read + publish only (single-flight); saves run on their own queue that the UI
  never awaits (`queueSave`; newer readings win, pending past days kept: `plan.mergeDays`). `requestAccess` re-reads
  access right after the prompt and publishes it, then starts a refresh without awaiting it. A queued run keeps the
  most important reason (`plan.mergeReason`: permission > launch > foreground > background > today); `permission`
  bypasses the 5 s gap. Every reader call is bounded with `within()` (access 6 s, prepare 6 s, read 20 s).
- **F4 (confirmed)** — readers report `complete` per day (phone counter: `coversDayEnd` — a reading after the next
  midnight exists; CMPedometer / health store: the day was read at all). A past day is marked final only when read
  complete AND saved; up to 7 days back stay pending (`plan.pendingPastDays`), re-read on launch / permission / a new
  day, else every 30 min at most.
- **F5 (confirmed)** — `DayCount.estimatedSteps` → `DaySteps.estimated`; today's save leaves the estimate out
  (`policy.postTarget`), the past day's final save includes it; the card says "about N of these are estimated from
  hours the phone couldn't check".
- **F6 (confirmed)** — `orderSamples`: boots by BOOT_COUNT when every boot has one, else by boot instant; within a boot
  readings by elapsed, re-anchored to the boot's latest wall clock when they disagree by > 2 min; readings still before
  2025 (a reset clock nothing could re-anchor) are dropped; a reboot delta whose new reading isn't after the old one is
  credited from the new boot's own instant, or skipped. Test: the 2016 boot sample → 3 600, not 12 600.
- **F7 (confirmed)** — a START base: when the phone counter begins partway through a day (`partialFrom`) that already had
  a count saved (server read), the day is max(automatic count, saved + counted since). Card: "Counting since 2:00 pm,
  on top of the 5,000 saved earlier today."
- **F8 (confirmed)** — the run checks `stale()` right after `prepare` and resets the sampler itself when the member
  signed out meanwhile; `clearStepsOnSignOut` bumps the epoch, waits ≤ 4 s for the run in flight, then stops + clears.
- **F9 (confirmed; offline fixed)** — Today's error branch renders the StepsCard for today (`serverSteps` null, no entry
  sheet). While the dashboard is LOADING the skeleton stays (it mirrors the layout; normally < 1 s) — deliberate.
- **F10 (confirmed)** — Today arms a timer for the next local midnight besides focus / app-active. The WIP timer stopped
  after its first ≤ 6 h hop (setToday with an unchanged day doesn't re-run the effect) and the WIP's setState-in-effect
  on the steps date failed lint: both fixed in the resumed run (self re-arming timer, effect removed).
- **F11 (confirmed)** — `save.ts` (resumed run): saving one day with its I/O injected (`SaveDeps`); the tests run the
  real decisions against a fake server + store + clock (another device's higher count, a web edit seen by Today or only
  by the pre-save read, a mid-day start, the phone's own Edit, a lower number typed with nothing counting, offline /
  permanent errors, today's estimate, a stale run), plus `plan.ts`, the base / edit / estimate policy and the counter
  cases N2 / F5 / F6. `test:steps` 38 → 66.

Resumed run, beyond the WIP:
- `save.ts` extracted from `sync.ts` (F11), with a re-check after the pre-save GET (the day changed meanwhile → skip).
- Manual saves serialised with the automatic queue (`saveManualSteps`, used by `useLogSteps`): the sheet's POST waits
  (≤ 25 s) for the automatic save in flight, and the queue waits for it before its next day — an automatic POST can no
  longer land after the member's number and undo it. The edit is recorded inside the same critical section.
- A real server read also updates Today's cached steps (`mergeServerSteps`), so a lower web edit / a higher count from
  another phone shows without waiting for a refetch.
- Reset-clock readings nothing can re-anchor are dropped (`MIN_PLAUSIBLE_TS`).
- Found on the emulator (device test rows 2, 10, 11): the no-counter card wording + "Use Health Connect"; a number typed
  lower today with nothing counting is a plain save (not a frozen edit base); the Health screen's steps note knows
  when the phone has no counter.

## Device test (D1, emulator Medium_Phone, local server)

Setup: safety gate `node scripts/e2e/verify-local-bundle.mjs` → SAFE (API `http://10.0.2.2:3100`), run before the first
interaction and again before each cold start. Build worktree detached at `cbcc07d` (native code is unchanged after it),
`CI=1 npx expo prebuild --platform android --clean --no-install`, `gradlew assembleDebug -PreactNativeArchitectures=x86_64
--max-workers=2` → BUILD SUCCESSFUL in 12 m 36 s; all seven orza-steps Kotlin files compile (no warnings from the
module). Installed over the Oct-19 APK. Account qa4@orza.test (already signed in, profile zone Asia/Calcutta, step
target 7,000). Screenshots: scratchpad `e2e/s01…s29`.

**The emulator has no step counter.** `dumpsys sensorservice` lists the Goldfish accelerometer / gyroscope / magnetic /
orientation / temperature / proximity / light / pressure / humidity sensors and the AOSP fusion sensors — no
`TYPE_STEP_COUNTER` (19) — and the emulator's `hardware-properties.ini` has no step-counter option. So the native sampler
can't produce a reading here: the no-sensor path was tested for real, the permission UX with the counter's presence
faked in JS only (`phoneAvailable` forced true, marked D1-TEMP, reverted before the commit — `git diff` clean).

| # | Check | Result |
|---|-------|--------|
| 1 | Metro bundle over `10.0.2.2:8081` | Blank screen again: `ProtocolException: Expected leading [0-9a-fA-F] character but was 0xd` in BundleDownloader, although `EX_DEV_CLIENT_NETWORK_INSPECTOR=false` is in gradle.properties and Metro's chunk framing is valid (checked with `curl --raw` on the host). Workaround that works: `adb reverse tcp:8081 tcp:8081` + `url=http://localhost:8081` → README + `scripts/e2e/adb.sh app_start` updated. Dev-only. |
| 2 | No counter: Today card | Was "0 of 7,000 · ✓ Not counted yet · A short walk…" + Log steps — misleading ("counted" on a phone that can't). FIXED: "○ Not logged yet", "This phone has no step counter. Log your steps here, or connect Health Connect to count them automatically.", buttons **Log steps** + **Use Health Connect ↗** (s04). |
| 3 | Log steps 1,200 (typing fallback) | `saveManualSteps` → local DB `tracking 2026-10-20 steps 1200`; card "1,200 · ✓ Logged today · 5,800 to go" (s06); phone record `{server 1200}`. |
| 4 | Permission: undetermined | CTA "Count my steps automatically" only (s07) → explain sheet (why / all day / privacy, "Next, your phone asks to allow 'Physical activity'", "Wear a watch? Use Health Connect") (s08) → Allow → system dialog "Allow ÖRZA to access your physical activity?" (s09). |
| 5 | Denied | "Don't allow" → toast "No problem — tap … whenever you'd like …", card keeps the CTA + **Log steps** fallback (s11). |
| 6 | Blocked | Second "Don't allow" → NEVER_ASK_AGAIN → the sheet switches to the blocked note with the exact path + **Open Settings** (s13); card: Open Settings + "Settings › Apps › ÖRZA › Permissions › Physical activity › Allow" + Log steps (s14). Open Settings → ÖRZA App info (s15). |
| 7 | Granted from Settings | Permissions › Physical activity › Allow → back → card: **Live** pill, "5,800 to go · updates on its own", "Not right? Edit" (s18b). Native `start()` ran: `no_backup/orza-steps-state.json` = `{"tz":"Asia/Calcutta"}` and no `enabled` (no counter → false, nothing armed). |
| 8 | Refresh on return to the app | Temp log: the `foreground` run read access 0.16 s after the app came back; the `today` run that fired with it was merged and skipped by the 5 s gap. (A first ~10 s delay seen after the Settings round trip came from the dev client's Metro reconnect after adb dropped the reverse — not the app.) |
| 9 | Offline (F9) | Cold start with `svc wifi/data disable`: "We couldn't load your day" + the steps card still shows 1,200 ✓ Logged today (s19). Online + Try again → loads. |
| 10 | Typed LOWER today, nothing counting | Found: the WIP made it a frozen edit base (source null) — an automatic source appearing later that day would have been ignored. FIXED (`applyManualSteps`: a plain save, `sent`/`server` = the number, no base; tests added). Device: 900 → server 900, card "900 · Logged today · 6,100 to go", record `{sent 900, server 900}` (s29). |
| 11 | Health screen | "Steps now count automatically" card. On a phone without a counter it claimed "this phone's step counter" → FIXED: "This phone has no step counter. Connect Health Connect above and Today counts your steps from it … — or log them on Today." (s25). |
| 12 | Alarms / receivers | `dumpsys alarm` → no orzasteps alarm (correct without a counter). StepBootReceiver filter: BOOT_COMPLETED, MY_PACKAGE_REPLACED, TIME_SET, TIMEZONE_CHANGED, ACTION_SHUTDOWN, QUICKBOOT_POWERON (+HTC) — no QUICKBOOT_POWEROFF (N4). `am broadcast -a …QUICKBOOT_POWERON -n …StepBootReceiver` from the shell: delivered, nothing armed / sampled, no crash; the same with BOOT_COMPLETED → `SecurityException: not allowed to send broadcast` (protected — N4's premise). |
| 13 | Storage (N5) | `no_backup/` holds `orza-steps-state.json`; no `shared_prefs/orza_steps.xml`. |

Not testable on this emulator (no step counter) — **real-phone D1 checklist**:
- `getStatus()` → `armed`, `midnightArmed`, `exactMidnight`, `standbyBucket`; `adb shell dumpsys alarm | grep -A4 orzasteps`
  → PERIODIC (ELAPSED_WAKEUP ~1 h) + MIDNIGHT (RTC_WAKEUP; exact with "Alarms & reminders", else the inexact chain).
  Around midnight: `getSamples(...)` reasons `midnight` before and after 00:00, and the alarm's actual delivery time.
- `adb shell am set-standby-bucket in.co.ylo.orza frequent|rare|restricted` → periodic every 3 h / 4 h / none (N6).
- Walk with the app closed → samples grow (`periodic`); open Today → the number moves within 60 s; the website shows
  the same number after the next save.
- Reboot → a `boot` sample; power off with the process alive → a `shutdown` sample (N3; Android 14+ may defer it when
  the process is cached).
- Doze: `adb shell dumpsys deviceidle force-idle` → the midnight alarm still samples.
- Website edit lower than the phone's save → within a minute the card shows the edit ("Edited by you") and keeps adding.
- Sign-out → alarms cancelled, `no_backup/orza-steps-samples.json` removed.
- iOS (no Mac here): Motion & Fitness prompt, CMPedometer history for the last 7 days, Apple Health max.

## Open issues

- The emulator can't exercise the sampler (no step counter) — the real-phone checklist above is the remaining
  verification for N1, N3, N6, N7 and the end-to-end auto save.
- Emulator state left behind: ACTIVITY_RECOGNITION granted for in.co.ylo.orza, the JS store's `asked: true`; qa4's
  steps for 2026-10-20 = 900 on the local server.
- "Blocked" comes from the app's own record of a NEVER_ASK_AGAIN answer: if the member later resets the permission to
  "ask" in Settings, the card keeps offering Open Settings (that path works) instead of the prompt. Minor.
- Health screen: the Connect card stays a skeleton for ~40 s on the emulator (Health Connect status) — outside steps.
- From `steps-build.md`, unchanged: phones whose counter only counts while an app is registered (Recording API /
  foreground service need a product decision); Health Connect background reads need READ_HEALTH_DATA_IN_BACKGROUND;
  HealthKit is unreadable while the iPhone is locked.
