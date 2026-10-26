# D1 — alarms (medicine alarms ringing on the phone, emulator E2E)

Emulator Medium_Phone (Android 16, 1080x2400), dev-client build 0b45fa1 + native alarm module (package in.co.ylo.orza),
Metro from the main repo, local server http://10.0.2.2:3100 (JSON DB `E:\aylo\orza-localtest\.data\orza-db.json`).
Safety gate (`node scripts/e2e/verify-local-bundle.mjs`) printed SAFE at start (2026-10-26 11:38 IST).
Account: qa4@orza.test (already signed in; Metformin 18:30/21:00 Mon–Sat for Papa, Glimepiride 08:00/21:00,
Amlodipine 22:00, Pantoprazole 08:00 — nothing due between 11:40 and 18:30, so test doses go into that window).
Screenshots `alNN` in the session scratchpad `e2e/` folder. `uiautomator dump` can't get an idle screen on any screen
with the tab bar halo / hero orb (endless animations), so the run is driven by screenshots + coordinates.

Feature code: `src/lib/alarms/**` (engine, plan, adapter.android.ts, test.ts), `src/features/alarms/**` (status card,
first-run prompt), `src/features/alarm/**` + `src/app/(app)/alarm.tsx` (alarm screen), native module
`modules/orza-alarms` (read only — native issues are reported, not changed).

## Test cases

| # | Case | Result | Evidence / notes |
|---|------|--------|------------------|
| 1 | Reminders → "Alarms on this phone" (all granted): ON tag, next alarm 6:30 pm Metformin with photo, "27 medicine alarms and 2 reminders", Notifications / Exact / Full-screen ok, battery tip | PASS | al01 |

## Bugs

(none yet)

## Native issues

(none yet)

## Backend issues

(none yet)
