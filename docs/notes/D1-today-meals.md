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
