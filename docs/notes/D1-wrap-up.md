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
| N1 | Health Connect per-app permission intent can't resolve (package visibility, `<queries>`) (care) | Fix: config plugin adds the two MANAGE_HEALTH_PERMISSIONS intent queries | in progress |

## Test cases

| # | Case | Result | Evidence / notes |
|---|------|--------|------------------|

## Bugs

| # | Bug | Status |
|---|-----|--------|
