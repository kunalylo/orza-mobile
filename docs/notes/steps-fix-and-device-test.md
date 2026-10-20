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
- [x] checks: typecheck ✓, lint ✓, test:alarms 34/34 ✓, test:steps 64/64 ✓
- [ ] native rebuild (orza-mobile-build) + emulator test against the LOCAL server (safety gate SAFE first)
- [ ] PROGRESS.md entry, commit, push

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
  by the pre-save read, a mid-day start, the phone's own Edit, offline / permanent errors, today's estimate, a stale
  run), plus `plan.ts`, the base / edit / estimate policy and the counter cases N2 / F5 / F6. `test:steps` 38 → 64.

Resumed run, beyond the WIP:
- `save.ts` extracted from `sync.ts` (F11), with a re-check after the pre-save GET (the day changed meanwhile → skip).
- Manual saves serialised with the automatic queue (`saveManualSteps`, used by `useLogSteps`): the sheet's POST waits
  (≤ 25 s) for the automatic save in flight, and the queue waits for it before its next day — an automatic POST can no
  longer land after the member's number and undo it. The edit is recorded inside the same critical section.
- A real server read also updates Today's cached steps (`mergeServerSteps`), so a lower web edit / a higher count from
  another phone shows without waiting for a refetch.
- Reset-clock readings nothing can re-anchor are dropped (`MIN_PLAUSIBLE_TS`).

## Device test (D1, emulator Medium_Phone, local server)

## Open issues
