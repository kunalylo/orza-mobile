# steps-fix-and-device-test — review fixes for auto steps + emulator test

Follows `steps-build.md` (commit `bc9bf2b`). Review findings N1–N7 (native) and F1–F11 (JS) verified one by one; fixes,
refutations and the D1 device test are logged here. Resume from the checklist.

## Checklist

- [ ] N1 midnight samples: exact when "Alarms & reminders" is allowed, else an inexact chain whose worst case lands before midnight
- [ ] N2 BOOT_COUNT change without a kernel reboot (elapsed decides)
- [ ] N3 runtime ACTION_SHUTDOWN receiver while the process lives
- [ ] N4 QUICKBOOT_* (unprotected) only re-arm, never sample; store collapses forced samples < 1 min apart
- [ ] N5 samples + flags in noBackupFilesDir (not backed up / transferred), legacy prefs removed
- [ ] N6 periodic spacing by App Standby bucket
- [ ] N7 read waits for flush completion when flush() accepted; else event time
- [ ] F1 never-lower guard uses real server observations only (< 60 s), not Today's cache
- [ ] F2 member edits (web lower than this phone's save, or Edit on the phone) → day base, new steps add on
- [ ] F3 permission flow: read/publish single-flight, saves on their own queue, reader calls bounded
- [ ] F4 past days final only when read + complete; up to 7 pending days
- [ ] F5 long-gap estimate for today shown as estimate, not posted until the day is past
- [ ] F6 session order by BOOT_COUNT / boot instant; wall clock re-anchored per boot
- [ ] F7 counting starts mid-day on top of a saved count → base (saved + counted since)
- [ ] F8 sign-out during prepare can't re-enable the sampler
- [ ] F9 Today offline shows the steps card
- [ ] F10 Today across midnight switches day
- [ ] F11 tests for the sync decisions (pure `plan.ts`)
- [ ] checks: typecheck, lint, test:alarms, test:steps
- [ ] native rebuild (orza-mobile-build) + emulator test against the LOCAL server (safety gate SAFE first)
- [ ] PROGRESS.md entry, commit, push

## Findings — verdicts and fixes

## Device test (D1, emulator Medium_Phone, local server)

## Open issues
