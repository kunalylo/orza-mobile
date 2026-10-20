# D1 — today-meals (emulator E2E)

Emulator Medium_Phone (Android 16, 1080x2400), dev build 0b45fa1 + alarm module, Metro from main repo, local server
http://10.0.2.2:3100 (JSON DB `E:\aylo\orza-localtest\.data\orza-db.json`). Safety gate printed SAFE at start (2026-10-19 ~20:50).
Test account: qa4@orza.test (onboarded in D1 auth-onboarding: 1,680 kcal, 10 glasses, 7,000 steps, metric, tz Asia/Calcutta,
no meals at start). Screenshots `mNN` in the session scratchpad `e2e/` folder.
AI calls budget: 1–2 per feature (meal text log).

## Test cases

| # | Case | Result | Evidence / notes |
|---|------|--------|------------------|
| 1 | Today header: date eyebrow, greeting, streak tag | PASS | m01 "Today · Monday, 19 October", "Good evening, QA." at 20:50 IST, "Log a meal to start a streak" → "1-day streak" after logging (m43) |
| 2 | Calorie ring vs target, macros | PASS | m01 1,680 left of 1,680; m43 after 4 meals "Over target +273 of 1,680", 1,953 eaten = 500+938+170+345, 116 %, P 50/101 C 240/202 F 89/52 (server totals match) |
| 3 | Insight card | FIXED | m02: violet ambient light ended in a hard-edged rectangle 40 dp short of the card's right/bottom edge — bug 1; m03 fixed |
| 4 | Quick action "Type or speak" → Meals composer focused | PASS | m07 Meals tab, composer focused, keyboard up |
| 5 | Composer: < 2 chars + keyboard send | FIXED | m08: inline error but the keyboard closed (focus lost) — bug 2; m10 keyboard stays, error shown |
| 6 | Log by text (AI) "2 roti, dal and a bowl of rice" | FIXED | logged to dinner 500 kcal (roti/dal/rice, follow-up question) but TWO meals + 2 credits from one Enter — bug 3; logged card was below the fold with no visible feedback — bug 4 |
| 7 | Delete via trash button + confirm (back = keep) | PASS | m19 "Delete this meal? 3 items · 520 kcal…", back closes it with nothing deleted (m20), Delete → list + totals update, server row gone |
| 8 | Food list: search (debounced) "dal makh" → result → pick | PASS | m27/m28 |
| 9 | Food list: restaurant toggle, servings typed (2.5) then Add without leaving the field | PASS | m29 ≈938 kcal; server: Dal Makhani (restaurant) 2.5 katori 938 kcal |
| 10 | Food list: meal type preselected from the group's + Add | PASS | Lunch/Breakfast/Dinner "+ Add" preselect that chip (m35) |
| 11 | Food list: Add / close with keyboard up → screen below | FIXED | m31/m37: keyboard stayed ~1 s over Meals after the sheet closed, then the lower half was blank and the tab bar missing — bug 5; m50 clean |
| 12 | Food list: popular chips (Chai, Poha) + typed servings 2 / 1.5 | PASS | server Chai 2 cup 170, Poha 1.5 plate 345 |
| 13 | Custom item: blank → errors; valid → added | PASS | m47 name + kcal highlighted, "Give this item a name · Calories: 0–5000"; m50 Protein bar 210/20/22/7.5 saved to lunch |

## Bugs

1. FIXED — Today insight card: the ambient SVG (`width/height 100%` with absoluteFill) inside the padded card resolved
   against the content box, so the violet light stopped 2 × padding short of the right/bottom edge as a hard rectangle.
   Wrapped in an absolute-fill View (src/features/today/InsightCard.tsx).
2. FIXED — Meals composer: a too-short entry sent with the keyboard's send key showed the error but the field lost focus
   (`submitBehavior="blurAndSubmit"` blurred right after `focus()`). Now `submitBehavior="submit"`; the composer blurs
   itself only for a valid entry (src/features/meals/MealComposer.tsx).
3. FIXED — Meals composer: one hardware Enter (adb keyevent / emulator / Bluetooth keyboard) logged the meal twice
   (2 server rows 7 ms apart, 2 AI calls, 2 credits): the editor action fires on key-down and key-up and `isPending` only
   flips on the next render. Synchronous in-flight ref guard around the mutation.
4. FIXED — Meals: after logging, the "Logged to …" card with Undo appeared below the fold; only a toast at the top said
   anything happened. The card is scrolled into view once it has a layout (src/app/(app)/(tabs)/meals.tsx).
5. FIXED — Sheets (shared UI) closing with the keyboard up: the keyboard stayed ~1 s over the screen below, then that
   screen (Meals, `Screen keyboard` padding) showed a blank lower half without its tab bar until Android reported the
   keyboard hidden (~0.6 s after close start). Sheet dismisses the keyboard when it starts closing, and a small store
   (src/ui/sheetKeyboard.ts) marks the keyboard as the sheet's from mount until it is unmounted and the keyboard is down;
   Screen's KeyboardAvoidingView / footer and the TabBar ignore it meanwhile.

## Resumed run (2026-10-20 07:10, after the auto-steps work 59bad40)

The first run also tested edit / swipe delete / mic / water / steps-tile / weight (screenshots m51–m103) and committed
fixes for them in the WIP checkpoint f8bd255 without writing them down here. Reconstructed from that diff (each is
re-verified below before it counts):
6. Edit meal: "Discard changes?" was not cancelable (Android back on the dialog) → `cancelable: true`.
7. Edit meal: Save with the keyboard up → blank screen below until the keyboard hid → `Keyboard.dismiss()` before the
   mutation; `goBackOrHome` dismisses the keyboard too (src/app/(app)/meal/[id].tsx, src/ui/ScreenHeader.tsx).
8. Water: fast taps were lost ("+ +" wrote 7, 7) → synchronous `latest` ref in `useWaterWriter` (today/api.ts, WaterCard).
9. Steps / weight sheets: `autoFocus` focused the field before the Modal window had focus → no keyboard → focus after
   the sheet sprang up (BodyCards `useFocusWhenShown`).
10. Sheets: Android keyboard height excludes the nav-bar inset → Save/Add partly under the keyboard → inset added back
    (src/ui/useKeyboardHeight.ts).
Since then the steps tile was replaced by the automatic StepsCard (steps-build / steps-fix notes).
Safety gate SAFE at resume (07:09).

Screenshots of the resumed run: `nNN` in the same scratchpad folder. The tab bar's Snap halo animates forever, so
`uiautomator dump` never gets an idle screen on the tab screens — driven by screenshots + coordinates instead.

| # | Case | Result | Evidence / notes |
|---|------|--------|------------------|
| 14 | Date navigation: ‹ / › / week strip / "Today" pill, never past today | PASS | n02–n06, n13: ‹ → "Looking back · Monday" (stale dim while loading, then 2,153 kcal), › twice on today stays on today (› disabled) |
| 15 | Date picker calendar ("Pick a day", Today + Meals) | FIXED | n08: grid wrapped after 6 columns — 1 Oct (a Thursday) under F, 20 Oct under S, Saturday header on its own row — bug 11; n10 fixed (7 columns, Thu 1 … Tue 20), future days dimmed + not tappable (n11), 14 Oct → "Wednesday, at a glance" (n12) |
| 16 | Quick action Snap a meal → Snap tab | PASS | n16 (first open ~3 s on the dev build while the tab mounts; later < 1 s, n18 strip) |
| 17 | Quick action Ask ÖRZA → Ask, back → Today | PASS | n20, n21 (Ask mounts fresh each time: ~2 s on the dev build) |
| 18 | Medicines card empty state | PASS | n14: "No medicines scheduled today…" + Add medicine / Scan prescription |
| 19 | Water: 7 fast "+" taps, then 3 "−" + 2 "+" and an immediate pull-to-refresh | PASS | n25 7 glasses / 1.75 L, server 7; n26 refreshing, n28 6 glasses / 1.5 L, server `water_glasses: 6` (bug 8 fix holds) |
| 20 | Steps (no counter on the emulator): card states + typing fallback | FIXED | n29 "900 · Logged today · Log steps · Use Health Connect ↗"; the Log steps sheet's field looked focused but NO keyboard came up (n31, `mInputShown=false`) — bug 12; after the fix the keyboard comes up as the sheet lands (n36 strip). 150000 → "Enter a step count between 0 and 1,00,000." (n38); 2500 + keyboard ✓ → server steps 2500, card 2,500 · 36 % (n40); Use Health Connect → Health screen, back keeps the scroll (n42) |
| 21 | Steps permission flow (counter faked in JS, D1-TEMP, reverted) | PASS | `pm revoke` + cleared flags → card "Count my steps automatically" + Log steps (n48) → explain sheet (n50) → system "Allow ÖRZA to access your physical activity?" (n52) → Allow → toast "Step counting is on…", LIVE pill, "Saved earlier today", "4,500 to go · updates on its own", "Not right? Edit" (n53). Live counting itself: BLOCKED (no step-counter sensor in the emulator, see steps-fix notes) |

11. FIXED — Date picker (src/features/meals/DateNavigator.tsx, shared by Today and Meals): the month grid was one
    wrapping row of `width: 100/7 %` + `aspectRatio: 1` + `maxHeight: 48` cells; on Android Yoga broke the line after
    six cells, so every date sat under the wrong weekday. Now one row per week with `flex: 1` cells, all rows in one
    block (the Sheet body's `gap` no longer spreads the rows apart).
12. FIXED — Sheets that open with a focused field (Today steps / weight, food list search): the field was focused by a
    fixed 380 ms timer (bug 9's fix). On the dev build the sheet's Modal window wasn't focused yet after 380 ms, so the
    field showed a caret but no keyboard (and a second focus() is a no-op while RN thinks it is focused). New Sheet
    prop `initialFocus` (src/ui/Sheet.tsx): focuses on the Modal's `onShow`, and on Android retries blur + focus every
    400 ms (max 4) until a keyboard is up; BodyCards + FoodPickerSheet use it.

## Resumed run 2 (2026-10-20 11:00, after the usage-limit pause; checkpoint 0e392b7)

Safety gate SAFE at resume (11:02). Screenshots `pNN`. The previous run's screenshots n54–n82 (weight sheet, a second
text log "2 roti, dal and a bowl of rice" → breakfast 500 kcal, the Try-saying chip) were never written down; the cases
below re-verify them. AI budget for the text log is used up (3 server calls so far, 2 of them from bug 3) — no more AI
meal logs in this run. Emulator note: after ~3.5 h the app process held ~500 MB (5 JS reloads in one process) on a 2 GB
emulator with swap 100 % full — every tap took seconds; `am kill-all` + `app_start` brought it back to ~245 MB.
Grey rectangles over a card (n60_b, n70_closed, p06) are Android's keyboard-navigation focus highlight: `adb input
text` / `keyevent` leave touch mode — a test artefact, not an app bug.

| # | Case | Result | Evidence / notes |
|---|------|--------|------------------|
| 22 | Today header after a reload: "Good morning, QA." at 11:06, "2-day streak" (meals on 19 + 20 Oct), skeleton while loading | PASS | p21 skeleton, p22 loaded; insight "1,180 kcal and 85 g protein to go" = 1,680−500 / 101−16 (p11) |
| 23 | Weight sheet: 500 → "Enter a weight between 20 and 400 kg.", IME ✓ keeps the keyboard; close + reopen → empty field, focused, keyboard up; "72,8" (comma) + ✓ → server `weight_kg: 72.8`, tile 72.8 "Logged today" | PASS | p17, p27a, p29a/b, p30 |
| 24 | Today's meals list (breakfast group, entry, macros line, + Log / Log a meal) | PASS | p23 |
| 25 | Edit meal: Lunch chip + roti quantity typed "3" (keyboard up) → Save changes tapped at once | PASS | p33 570 kcal live; p34a keyboard goes down while saving (spinner), p35 back on Today: Lunch · Roti ×3 · 570 kcal; server `meal_type: lunch`, Roti 3 roti 105 g 210 kcal, totals 570 |
| 26 | Edit meal: change → Android back → "Discard changes?" → back again = keep editing (Dinner still picked) → Discard → leaves, server unchanged (bug 6 holds) | PASS | p67, p68, p69 |
| 27 | Mic: permission revoked + flags cleared → tap mic → system "Allow ÖRZA to record audio?" → Don't allow → "ÖRZA needs the microphone to hear you. Tap the mic again to allow it — or just type." → mic again → While using the app → listening UI (stop button, "Listening…" placeholder, "Listening — speak now, tap ■ when done", chips dimmed, mic indicator) → no speech → "Didn't catch that — tap the mic and try again, a little closer." | PASS | p41, p42, p44 strip, p45a, p48 |
| 28 | Past-day logging: Meals ‹ → "Yesterday" + "Logging for Yesterday — new entries go to that day."; food list "banana" → Banana, Snack chip, servings typed "2" + "Add 2 × Banana" tapped with the keyboard up | PASS | p49, p53–p56; server: `date 2026-10-19`, snack, Banana 2 piece 210 kcal; Yesterday totals 2,153 → 2,363 (p58) |
| 29 | Swipe delete: swipe left → "Delete this meal? 1 item · 210 kcal…" → Android back = keep (card closes) → swipe again → Delete | PASS | p60, p61, p62; server row gone, Snacks 670 → 460 kcal |
| 30 | Today pull to refresh | PASS | p64 spinner, p65 settled (1,110 left / 570 eaten after the edit) |
| 31 | Logged card + Undo | BLOCKED | The "Logged to breakfast · AI estimate · 3 items · 500 kcal" card with Adjust portions / Undo was seen (n76, bug 4). Undo itself needs another AI text log — the AI budget for this feature is spent (3 server calls), so not pressed on device. Code: Undo → `removeMeal(meal, true)` = the same delete mutation as cases 7 / 29 + toast "Undone — that meal was removed" |
| 32 | Offline (wifi + data off): Today pull to refresh | FIXED | p100: banner read "…can't reach örza right now. check your connection…" (lower-cased server message) — bug 15; p101 fixed. After reconnecting the banner stayed until a manual refresh (p106) — bug 16; p113 strip: banner stays through 40 s offline, clears by itself ~10–20 s after reconnect |
| 33 | Offline: water + / delete a meal → error toast | FIXED | p71/p73b: toast see-through over the dark insight card ("Talk it through" showing through the message) and 419 dp wide in a 379 dp host — both rounded ends off-screen — bug 14; t31c fixed (opaque, inside the gutters). Water value and meal kept, nothing written |
| 34 | Offline: Meals pull to refresh | FIXED | p102: the spinner ended with no word (cached meals stay) — bug 17; p103 "Can't reach ÖRZA right now…" toast; online again p105 silent success |
| 35 | Motion: Edit meal rows entering / Add item / remove item, toasts | FIXED | rec2/rec5 frame tracking: rows overshot ±25 px and wobbled ~2.5 s, toasts swelled — bug 13; rec7 after the fix: removed row's neighbour glides 381 → 0 px monotonic, settled in 0.9 s |
| 36 | Edit meal ring | NOT REPRODUCED | p75/p76: once (after a long session with screen recording) the summary ring stayed an empty track at 938 kcal = 56 %; 4 later opens (p78, p81, p90, p117) drew the arc every time |

13. FIXED — Motion (app-wide, 142 layout animations): Reanimated 4's `withSpring` defaults are mass 4 / stiffness 900,
    so every `.springify().damping(14–20)` builder (written for Reanimated 3's mass 1 / stiffness 100) ran at a damping
    ratio of ~0.15: cards entering a screen, item rows added/removed in the meal editor and the toast pill overshot by
    up to 60 % and wobbled for ~2 s. All chains now set `.stiffness(…)` + `.mass(1)` (existing stiffness kept); rule
    documented above `motion` in src/theme/index.ts.
14. FIXED — Toast (src/ui/Toast.tsx): `glassSolid` (92 % white) let a dark card show through the message, and the
    animated row wasn't limited to the host width, so a two-line message made the pill 40 dp wider than the screen
    gutters. Opaque white + `maxWidth: '100%'` on the row.
15. FIXED — Today offline banner (src/app/(app)/(tabs)/index.tsx): the server/network message was lower-cased into the
    sentence ("örza"). Now two sentences, message as written.
16. FIXED — Today / Meals after a lost connection: React Query has no network listener in this app (no NetInfo), so
    the offline banner / "couldn't load your meals" card stayed after the phone was back online until a manual
    refresh. `retryWhileUnreachable` (src/lib/api.ts) as `refetchInterval` on the Today dashboard and Meals day queries:
    every 15 s while the last load failed with no response / timeout / 5xx. The banner no longer hides during those
    background retries (it flickered), only during a pull to refresh.
17. FIXED — Meals pull to refresh offline ended silently (cached meals stay, error card is only for a day that never
    loaded) → error toast with the reason.

Emulator note: after the restart the weight sheet's keyboard comes up ~0.8 s after the tap (initialFocus, bug 12) —
the no-keyboard sheets seen first in this run (p04–p09) were in the memory-starved process noted above.
Checks: `npm run typecheck`, `npx expo lint`, `npm run test:steps` (66 pass). Safety gate SAFE after each Metro restart.
