# D1 — layout-a11y (visual robustness + TalkBack labels — emulator E2E)

Emulator Medium_Phone (Android 16, 1080x2400, density 420), dev-client build 0b45fa1 + native alarm module (package in.co.ylo.orza),
Metro from the main repo, local server http://10.0.2.2:3100 (JSON DB `E:\aylo\orza-localtest\.data\orza-db.json`).
Safety gate (`node scripts/e2e/verify-local-bundle.mjs`) printed SAFE at start and on resume (2026-10-27).
System animation scales set to 0 (Reduce Motion path) for the run; restored to 1 at the end.
Screenshots `lNN` and uiautomator dumps `ui-*.xml` in the session scratchpad `e2e/` folder; `tools/a11y.mjs` lists clickable
nodes without an accessible name, off-screen text and stale "Loading…" content descriptions.

Plan: main screens (Welcome, Sign-in, Today, Meals, Snap, Medicines, Alarm via orza://alarm, More, Settings, Reminders) on
(a) default 1080x2400 @420 — TalkBack label audit via uiautomator (icon-only buttons need a content-desc),
(b) small phone 720x1280 @320, (c) large font 1.3 (on the small phone = worst case), then reset both.

## Test cases

| # | Case | Result | Evidence / notes |
|---|------|--------|------------------|
| 1 | Default size — Today label audit (all scroll positions) | PASS | ui-today..today4: all clickables labelled (tab bar "Today, tab 1 of 5" etc.) |
| 2 | Default size — Meals label audit | FIXED | ui-meals1..3: loaded totals card kept content-desc "Loading the day's totals" (bug 1). After fix ui-meals6: loaded card has no stale desc |
| 3 | Default size — Snap label audit | PASS | ui-snap, ui-snap1 |
| 4 | Default size — Medicines label audit | PASS | ui-meds..meds6 |
| 5 | Default size — More label audit | PASS | ui-more..more2 |
| 6 | Default size — Settings label audit | PASS | ui-settings..settings4 |
| 7 | Default size — Reminders label audit + visual | PASS | ui-rem..rem9 all labelled (Go back, New reminder, presets "Add Log lunch (Daily · 1:30 pm)", switches "Log breakfast on"); l01_rem layout clean |
| 8 | Default size — Alarm screen (orza://alarm?at=<8:00 dose>) label audit + visual | PASS | ui-alarm..alarm2: Close alarm, Take all 2, per-dose Take/Snooze/Skip labelled with the medicine name, photo "Glimepiride, photo 1 of 1"; l03_alarm clean |
| 9 | Default size — Welcome + Sign-in label audit + visual | PASS | ui-welcome2, ui-signin1 all labelled ("Show password" eye); l06_welcome, l07_signin clean |
| 10 | Deliberate sign-out (Settings › Sign out) → sign-in screen | FIXED | Showed "Your session ended. Please sign in again." after a voluntary sign-out (bug 2). Server log: POST /api/auth/logout 200 then GET /api/meds/today 401 |
| 11 | Small phone 720x1280 @320 + font 1.3 — Welcome | FIXED | l08: "I have an account" sat under the gesture bar on first view (bug 3); after fix l11 both buttons visible, rest scrolls |
| 12 | Small + font 1.3 — Sign-in incl. keyboard | PASS | l12 fits; l13 keyboard up: focused password field above the keyboard, Enter submits; signed in as qa4 |
| 13 | Small + font 1.3 — Today (all scroll positions) | FIXED | audits today_s..s7 all labelled. l16: "Snap a …" / "Type or …" empty-state buttons cut (bug 4), quick-action hints cut to 2 lines, week legend "Warm bars = calories vs y…" (bug 5). After fixes l17/l18 full labels |
| 14 | Small + font 1.3 — Meals (all scroll positions + keyboard) | FIXED | audits meals_s0..s5 labelled; l19: "TODAY · TOTAL…" eyebrow cut → 2 lines. l20 keyboard: the input stays above the keyboard (its 0/500 counter sits under it — fine while typing); meal-type and "Try saying" chips scroll sideways by design |
| 15 | Small + font 1.3 — Snap | FIXED | audits snap_s0..s3 labelled; viewfinder caption "Frame the whole plate, from sli…" → wraps to 2 lines (l23) |
| 16 | Small + font 1.3 — Medicines | FIXED | audits meds_s0..s5, meds_f4..f9 labelled. l24: names broke mid-word ("Pantopr / azole") beside the 72 pt photo, rail clock "10:0 / 0", "Next alarm 8:00 am to…" cut (bug 6). After fix l25: photo above the text in narrow rows, clock on one line, title wraps. Medicine-list meta lines end in "…" (details one tap away) — accepted |
| 17 | Small + font 1.3 — More | FIXED | audits more_s0..s5 labelled; credits pill "Balance & hi…" → 2 lines |
| 18 | Small + font 1.3 — Settings | FIXED | audits set_s0..s8 labelled; rows "What ÖRZA remem…", "…all of your da…" cut → SettingsRow title 2 / subtitle 3 lines (l28) |
| 19 | Small + font 1.3 — Reminders + New reminder sheet with keyboard | PASS | audits rem_s1..s8, remsheet labelled; l29/l30 layout fine (presets scroll sideways by design); l32 focused Message field sits between header and the Add reminder footer above the keyboard |
| 20 | Small + font 1.3 — Alarm screen (orza://alarm) | FIXED | audits alarm_s0..s4 labelled; l33: "Snooze 10 …" cut beside "Skip this dose" (bug 7) → l34 Snooze full width, Skip below. Note: the dev server took 8.5 s for /api/meds/doses, so the alarm used the phone copy and said "No connection — …" (by design after 4.5 s; wording see open issues) |

## Bugs

| # | Bug | Status |
|---|-----|--------|
| 1 | Meals DailySummary: React reused the loading GlassCard's native view for the loaded card; RN Android never clears a removed accessibilityLabel, so TalkBack read "Loading the day's totals" over the real totals | FIXED (keyed loading/totals cards, `src/features/meals/DailySummary.tsx`) — confirmed on device |
| 2 | Deliberate sign-out showed "Your session ended": after /auth/logout revoked the token, screens still refetched with it, the 401 handler took it for an expiry | FIXED (`src/lib/auth.tsx`: 401s for the token a sign-out is ending are ignored) |
| 3 | Welcome on a small phone with large text: second button under the gesture bar on first view | FIXED (`src/app/(auth)/welcome.tsx`: compact + fontScale>1.1 → smaller orb, tighter gaps) |
| 4 | Today "Nothing on your plate yet": two flex:1 buttons in a wrap row never wrap (minWidth 0) → both labels cut at large text | FIXED (`MealsSection.tsx`: flexGrow-only buttons wrap) |
| 5 | Today quick-action hints and week legend truncated at large text | FIXED (`QuickActions.tsx` hint up to 4 lines, `TodayHeader.tsx` legend 2 lines right-aligned) |
| 6 | Medicines timeline at large text on a small phone: medicine names broken mid-word, "10:00" rail clock broken in two, next-alarm title cut | FIXED (`TodayTimeline.tsx`: row measures itself and stacks the photo above the text when the text column is under 118 pt × fontScale; clock `numberOfLines=1 adjustsFontSizeToFit`; `AlarmStatusCard.tsx` title 2 lines) |
| 7 | Alarm screen: "Snooze 10 min" cut to "Snooze 10 …" at large text | FIXED (`AlarmDoseCard.tsx`: wrap row, content-width buttons) |
| 8 | Minor truncations at large text: Meals totals eyebrow, Snap viewfinder caption, More credits pill hint, Settings rows | FIXED (2–3 lines instead of 1–2) |
