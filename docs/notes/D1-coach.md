# D1 — coach (Ask ÖRZA chat, Recipes, Rebalance — emulator E2E)

Emulator Medium_Phone (Android 16, 1080x2400), dev-client build 0b45fa1 + native alarm module (package in.co.ylo.orza),
Metro from the main repo, local server http://10.0.2.2:3100 (JSON DB `E:\aylo\orza-localtest\.data\orza-db.json`).
Safety gate (`node scripts/e2e/verify-local-bundle.mjs`) printed SAFE at start (2026-10-26).
System animation scales set to 0 (Reduce Motion path) so uiautomator reads every screen.
Screenshots `coNN` in the session scratchpad `e2e/` folder.

Feature code: `src/app/(app)/ask.tsx`, `src/features/chat/**`, `src/app/(app)/recipes.tsx`, `src/app/(app)/recipe/**`,
`src/features/recipes/**`, `src/app/(app)/rebalance.tsx`, `src/features/rebalance/**`.

AI-call budget (real OpenAI via local server): chat question 1, chat meal 1, recipe 1, rebalance 1 (+1 retry max each).

## Test cases

| # | Case | Result | Evidence / notes |
|---|------|--------|------------------|
| 1 | Ask ÖRZA welcome (More → Ask ÖRZA, no conversation today): orb, "Namaste, QA", 5 starter chips (prefill ✎ / send ✦ icons), quick actions, disclaimer, composer + mic + EN chip. Header title read just "Ask" — "ÖRZA" wrapped onto a clipped 2nd line (bug B1) | FIXED | co01 → co02z |
| 2 | Prefill starter chip "Today I had a wedding meal": text into the composer, focused, keyboard up, composer sits right above the keyboard, nothing sent | PASS | co03 |
| 3 | Network error (wifi + data off) → send starter "What should I eat for dinner?": user bubble "Not sent" + Retry, toast "Can't reach ÖRZA right now. Check your connection and try again.", composer draft kept, nothing on the server | PASS | co04 |
| 4 | Retry after network back (1 AI call): bubble dims while sending, typing indicator "ÖRZA" dots, send button busy, sending quick actions disabled (prefill "Log a meal" stays enabled); reply in ~4 s, header subtitle = session title, timestamps, draft "Today I had a wedding meal" untouched; server: 1 session + 2 messages (`meta.ai:true`) | PASS | co05, co06, local DB |
| 5 | Keyboard vs composer: typing a message — composer stays directly above the keyboard (adjustResize), conversation scrolls above it | PASS | co07 |
| 6 | "I had 2 idli and sambar for breakfast" (1 AI call): reply confirms 240 kcal + ~36 kcal left (276 − 240 ✓), logged-meal card "LOGGED · BREAKFAST 2 × idli, sambar (1 katori) 240 kcal, P 6 g · C 44 g · F 3 g, Meal log ↗"; server meal `source:chat` breakfast 240 kcal, message `meta.logged_meal_id` = that meal; credits 91 → 89 (2 chat calls) | PASS | co08, local DB |
| 7 | Logged-meal card → opens that meal's editor ("Breakfast · Today", CHAT · 5:24 PM, “2 idli with sambar”, idli ×2 …); Back → the same conversation | PASS | co09 |
| 8 | Markdown rendering (sample reply injected locally — no AI call — then removed): heading → bold, **bold**, *italic*, bullets with coral dots, numbered list, `code`, https link underlined; `javascript:` link stays plain text. App links "[Rebalance](/dashboard/compensation)" / "[Meal log](/dashboard/meals?date=…)" — which the coach prompt tells the AI to use — were dead plain text (bug B2). After the fix they are links: Rebalance opens on top of the chat (Back → chat), Meal log switches to the Meals tab on that date | FIXED | co10 → co11z |

## Bugs

| # | Bug | Status |
|---|-----|--------|
| B1 | Ask ÖRZA header: the title "Ask ÖRZA" (variant `title`, letterSpacing −0.1, shrink-wrapped in a row with the online dot) was measured a hair narrower than Android draws it, so "ÖRZA" wrapped onto a clipped second line — the header read "Ask" (co01). Same class as EmptyState/alarm B2. Fix `src/app/(app)/ask.tsx`: title `letterSpacing: 0` | FIXED, retested co02z |
| B2 | Chat replies: the coach prompt (web `coachSystemPrompt`) lets the AI link app pages as markdown with website paths (/dashboard/meals, /dashboard/compensation, /dashboard/recipes …); RichText rendered every non-https link as plain text, so those links were dead on the phone. Fix: new `src/features/chat/links.ts` (`appLinkFor` maps /dashboard/<page>[?date=] to the app screen; `openAppLink` switches tab or pushes the screen) used by `RichText.tsx` | FIXED, retested co11z |

## Native issues

## Backend issues

## Not covered / notes
