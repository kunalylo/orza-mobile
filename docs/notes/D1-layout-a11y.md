# D1 — layout-a11y (visual robustness + TalkBack labels — emulator E2E)

Emulator Medium_Phone (Android 16, 1080x2400, density 420), dev-client build 0b45fa1 + native alarm module (package in.co.ylo.orza),
Metro from the main repo, local server http://10.0.2.2:3100 (JSON DB `E:\aylo\orza-localtest\.data\orza-db.json`).
Safety gate (`node scripts/e2e/verify-local-bundle.mjs`) printed SAFE at start (2026-10-27).
System animation scales set to 0 (Reduce Motion path) for the run; restored to 1 at the end.
Screenshots `lNN` in the session scratchpad `e2e/` folder.

Plan: main screens (Welcome, Sign-in, Today, Meals, Snap, Medicines, Alarm via orza://alarm, More, Settings, Reminders) on
(a) default 1080x2400 @420 — TalkBack label audit via uiautomator (icon-only buttons need a content-desc),
(b) small phone 720x1280 @320, (c) large font 1.3 (on the small phone = worst case), then reset both.

## Test cases

| # | Case | Result | Evidence / notes |
|---|------|--------|------------------|

## Bugs

| # | Bug | Status |
|---|-----|--------|
