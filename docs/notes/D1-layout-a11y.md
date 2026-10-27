# D1 — layout-a11y (visual robustness + TalkBack labels — emulator E2E)

Emulator Medium_Phone (Android 16, 1080x2400, density 420), dev-client build 0b45fa1 + native alarm module (package in.co.ylo.orza),
Metro from the main repo, local server http://10.0.2.2:3100 (JSON DB `E:\aylo\orza-localtest\.data\orza-db.json`).
Safety gate (`node scripts/e2e/verify-local-bundle.mjs`) printed SAFE at start, on both resumes and before the commit (2026-10-27).
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
| 20 | Small + font 1.3 — Alarm screen (orza://alarm) | FIXED | audits alarm_s0..s4 labelled; l33: "Snooze 10 …" cut beside "Skip this dose" (bug 7) → l34 Snooze full width, Skip below. Note: the dev server took 8.5 s for /api/meds/doses, so the alarm used the phone copy and said "No connection — …" (by design after 4.5 s; the "No connection" wording → case 25, bug 10) |
| 21 | Reset after the small-phone / large-text pass | PASS | `wm size` 1080x2400 (no override), `wm density` 420, `font_scale` 1.0 — verified after every later size/font change too |
| 22 | Default size + font 1.0 — Today re-look after the large-text fixes | FIXED | l41/l42: week legend on one line, quick-action hints 2 lines, cards unchanged. l43: the empty-state "Snap a meal" / "Type or speak" pair now stacked even at normal size (bug 9; old layout l44 = equal halves). After fix: equal halves at 1080@420/1.0, stacked at font 1.3 (default size), at 720x1280@320 + 1.3 (l45) and 1.0 (l46, 278 pt row is too narrow for both labels) |
| 23 | Default size + font 1.0 — Medicines re-look | PASS | l47: photo beside the text (no stacking), "8:00 AM" rail clock one line at full size, next-alarm title one line, Take / Snooze / Skip unchanged |
| 24 | Default size + font 1.0 — Alarm re-look (orza://alarm?at=2026-10-27T02:30:00.000Z) | FIXED | l48: Snooze 202 pt / Skip 136 pt — no longer the equal halves of before (bug 9). After fix l49: 169.5 pt each; small phone + 1.3 (l50): Snooze full width, Skip below, nothing cut |
| 25 | Alarm offline note wording (open point from case 20) | FIXED | A slow answer (no reply within 4.5 s, server reachable) said "No connection" (bug 10). Retest: ONLINE_WAIT_MS temporarily 1 ms → l54 "ÖRZA is taking a while to answer — …" with a clock icon; wifi + data off → l56 "No connection — …" with wifi-off. Timeout restored to 4 500 ms, network back on |
| 26 | Animation scales restored to 1 (animator / transition / window) → animations spot-check | PASS | App restarted: no "[Reanimated] Reduced motion" warning. Frame diffs 1.5 s apart on Today (l51a/b): top-right orb 904 px, tab-bar halo 7 990 px, ring glow changed; alarm (l53a/b): breathing glow changes 269k px (subtle, max Δ6) in the header |
| 27 | `npm run typecheck`, `npx expo lint`, `npm run test:alarms` | PASS | tsc rc 0, lint rc 0, alarms 34/34 |

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
| 9 | Bugs 4 and 7 fixes (content-width `flexGrow` buttons) changed the normal layout: Today's empty-state pair stacked at 1080@420 / font 1.0 (the 20 pt paddings need 340 pt, the row has 329) and the alarm's Snooze / Skip became unequal (202 / 136 pt) | FIXED (`MealsSection.tsx`, `AlarmDoseCard.tsx`: `flexBasis: 0` + `minWidth: 150 × fontScale` — the row wraps on the min width, then each line shares its width equally: equal halves while both labels fit, stacked full-width buttons at large text / on narrow phones) |
| 10 | Alarm said "No connection" when ÖRZA was merely slow (no answer within 4.5 s → the phone's copy) | FIXED (`features/alarm/api.ts` marks that fallback `slow`; `app/(app)/alarm.tsx` OfflineNote: "ÖRZA is taking a while to answer — this alarm was saved on your phone. Your answers sync automatically." with a clock icon) |

## Environment notes

- The adb device transport reconnected several times during the run (`adb reverse --list` went empty, host-18 ↔ host-23); the dev
  client then failed with "Unable to load script" / "Cannot connect to Expo CLI" and Fast Refresh stopped. Fix: `adb reverse tcp:8081
  tcp:8081`, then dev menu (keyevent 82) › Reload. Not an app bug.
- With animations on, uiautomator dumps can fail (endless orb / halo / glow animations) — use screenshots then.

## Open issues

- None in this area. Medicine-list meta lines ending in "…" at font 1.3 on a 720x1280 phone are accepted (details are one tap away).
