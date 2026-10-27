# D1 — wrap-up (native fixes, rebuild, retests, checks)

Emulator Medium_Phone (Android 16, 1080x2400, emulator-5554), package in.co.ylo.orza, Metro from the main repo,
local server http://10.0.2.2:3100 (JSON DB `E:\aylo\orza-localtest\.data\orza-db.json`). Screenshots `wNN` in the
session scratchpad `e2e/` folder.

Safety gate (`node scripts/e2e/verify-local-bundle.mjs`): SAFE at start (2026-10-27, HEAD 8d96956).

## Plan

1. Native issues from the area reports → fix (Kotlin module / app.json / config plugins) or record why not.
2. Rebuild the dev client in `E:\aylo\orza-mobile-build`, reinstall, safety gate, retest each native fix.
3. Retest still-failing / blocked cases that later commits may have fixed.
4. typecheck, lint, expo-doctor, test:alarms.
5. PROGRESS.md: D1 results table, fixes, backend issues, open items; commit + push.

## Native issues — triage

| # | Issue (area) | Decision | Status |
|---|--------------|----------|--------|
| N1 | Health Connect per-app permission intent can't resolve (package visibility, `<queries>`) (care) | Added the intent queries (config plugin) and rebuilt: the intent then RESOLVES, but starting it throws `SecurityException: Permission Denial … requires android.permission.GRANT_RUNTIME_PERMISSIONS` — on Android 14+ `MANAGE_HEALTH_PERMISSIONS` is a system-only (@SystemApi) entry point; it only worked from adb because the shell uid holds that permission. Not fixable in the manifest → plugin removed again. JS fix: `openManage` (src/lib/health/bridge.android.ts) goes straight to Health Connect's public home (`HEALTH_HOME_SETTINGS`) on Android 14+ (the hints already say "› App permissions › ÖRZA"); Android 9–13 still tries the Health Connect app's own per-app action first | FIXED (JS) — retested: one clean start of HC home, App permissions › ÖRZA reachable, Back returns to Health sync |
| N2 | Health Connect never re-shows its sheet once a type is USER_FIXED (care) | Platform behaviour; JS already steers to Health Connect (care B1/B4). N1 makes that one tap onto ÖRZA's own page | covered by N1 |
| N3 | Alarm with the process dead: notification ~6 s after the alarm time (alarms) | `AlarmReceiver` does not touch React (no ReactHost / bridge on the fire path: store → photos → notify); the delay is process start-up: zygote fork + `MainApplication.onCreate` (`loadReactNative` + Expo lifecycle listeners, incl. the dev launcher in this debug build), which Android runs before ANY receiver. Moving the receivers to their own process would split the alarm store lock / lock-screen state across processes — not done. Added: `AlarmReceiver` logs per fired alarm how late it was handled, whether the process was started for it and ÖRZA's own work (`adb logcat -s OrzaAlarms`) so a real phone / release build can be checked in one line | MEASURED on the rebuilt debug build: app killed (`am kill` 11:57:41) → alarm due 11:57:48.44 → "Start proc … for broadcast AlarmReceiver" 11:57:48.46 → `Alarm test:… handled 3583 ms after its time (process started for it 3085 ms before; own work 206 ms)` → ringtone 11:57:52.23. Warm process: "handled 209 ms … own work 187 ms". ÖRZA's part is ~0.2 s; the rest is the debug app's start-up (the earlier ~6 s was with the AVD swapping) |
| N4 | BOOT_COMPLETED ~65 s after boot (alarms) | System broadcast queue; reschedule + MISSED_GRACE handle it. Direct-boot (LOCKED_BOOT_COMPLETED) would need the alarm store + photos in device-protected storage and an RN `Application.onCreate` that survives the locked state — design decision + real-device proof (C6 F3), not a wrap-up fix | open (documented) |
| N5 | Endless Snap halo: RenderThread 50–70 % CPU idle, uiautomator never idle (snap) | JS, not native: `src/components/TabBar.tsx` pulses the halo 3× when the bar appears / the member lands on another tab, none while Snap is open, then rests | FIXED (JS) — RenderThread CPU time flat on idle Today after reload |
| N6 | Photo lost when Android kills ÖRZA while the camera is open (snap bug 10) | JS recovery (`getPendingResultAsync`) exists; the dev client can't deliver the result (dev launcher creates the React context ~20 s late). Needs a release-type build | retest on a release build if feasible |
| N7 | Reanimated settled-prop revert after tab re-render (today-meals) | Library bug (Reanimated 4.5.1, Fabric); worked around on Today. Retest charts in goals / health / reports | retest |
| N8 | ANRs / ~670 MB PSS / swap on the 2 GB AVD (snap, care) | Environment + debug build (unminified bundle, dev launcher). Check on a release build / real phone | env |
| N9 | No step-counter sensor on the AVD (today-meals); floating Gboard (coach); edge-to-edge adjustResize (auth) | Environment / informational (keyboard avoidance is in JS) | env |
| N10 | NEW in wrap-up: the dev build crashed natively (SIGSEGV on `mqt_v_js`) 51 s after a dev-menu Reload (11:34:24, no tombstone written — the AVD was starved by the parallel gradle build). The only other ÖRZA tombstone (01:50, layout-a11y run) is the same thread, 21 s after process start (= right after the dev launcher loaded the bundle): `MountingCoordinator::pullTransaction` jumping into freed heap (`[anon:scudo:primary]`, "trying to execute non-executable memory") — a stale mounting-override delegate (Reanimated's layout-animation proxy) from a previous React instance | Library (react-native 0.86 Fabric / Reanimated 4.5.1), both right after a JS (re)load in the dev client; no ÖRZA native code on the stack. Watch for it on the release build (no reloads there) | report |

## Test cases

| # | Case | Result | Evidence / notes |
|---|------|--------|------------------|

## Bugs

| # | Bug | Status |
|---|-----|--------|
