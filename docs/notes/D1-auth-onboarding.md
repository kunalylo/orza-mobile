# D1 — auth-onboarding (emulator E2E)

Emulator Medium_Phone (Android 16, 1080x2400), dev build 0b45fa1 + alarm module, Metro from main repo, local server
http://10.0.2.2:3100 (JSON DB `E:\aylo\orza-localtest\.data\orza-db.json`). Safety gate printed SAFE at start.
Test accounts for this area: qa2, qa3, qa4 @orza.test (passwords in `E:\aylo\orza-localtest\.data\test-accounts.json`).
Resumed 2026-10-19 20:05 after a usage-limit stop (checkpoint `ed4e93a`); safety gate printed SAFE again first.
Screenshots (sNN/tNN/zNN first session, rNN resumed session) in the session scratchpad `e2e/` folder.

Tooling notes: `ui` (uiautomator dump) fails with "could not get idle state" on onboarding (the orbs animate forever) —
use screenshots + coordinates there. adb `key 66`/text typed with no field focused activates whatever view has
keyboard focus (opened the onboarding "Sign out?" dialog once) — always focus a field before `type`. A hardware key
event (`key 66`) also takes Android out of touch mode, so a grey default focus box can show on a button (r96) — not an
app bug. `ui` used to print the PREVIOUS screen when uiautomator failed (stale /sdcard/ui.xml) — `_dump` now deletes it
first. Offline launch: `adb reverse tcp:8081 tcp:8081`, start the dev client with `url=http://localhost:8081`, then
`svc wifi/data disable` (Metro keeps working, the API at 10.0.2.2:3100 is unreachable); re-run `adb reverse` if the dev
launcher then says "Failed to connect to localhost".

## Test cases

| # | Case | Result | Evidence / notes |
|---|------|--------|------------------|
| 1 | Welcome screen layout | PASS | s03_welcome: hero, orb, signals, CTAs, no clipping |
| 2 | Sign-up: empty fields | PASS | s05: three inline errors, red fields |
| 3 | Sign-up: bad email | PASS | s07 "That doesn't look like an email address" |
| 4 | Sign-up: short password | PASS | s07 "Password must be at least 8 characters"; strength meter while typing |
| 5 | Sign-up: duplicate email (qa1) | PASS | s08 409 → "An account with this email already exists…" under email |
| 6 | Sign-up qa2 → onboarding | PASS | 201, guard opened onboarding step 1/14 (s10) |
| 7 | Onboarding: goal free text ("I want to lose some weight") | PASS | parsed as lose |
| 8 | Onboarding: sex chips | PASS | |
| 9 | Onboarding: age number (+ invalid 12) | PASS | hint bubble "designed for people aged 13 and over" |
| 10 | Onboarding: height ft/in (5 ft 8 in) | PASS | "5'8" (173 cm) — got it" |
| 11 | Onboarding: weight lb (170) | PASS | placeholder converted, 77.1 kg |
| 12 | Onboarding: target weight (+ 180 lb above current) | PASS (backend copy nit) | error says "77.1 kg" for an lb user — backend |
| 13 | Onboarding: activity option cards / diet chips | PASS | |
| 14 | Onboarding: allergies multi-select (exclusive None, custom) | FIXED | "Add another" field kept the text after adding → now clears |
| 15 | Onboarding: region search + Show all + city (Pune → Maharashtra) | PASS (+ fix) | after "Show all" the question scrolled out of view → log keeps the end in view |
| 16 | Onboarding: language / household | PASS | |
| 17 | Onboarding: lifestyle chips + free text | FIXED | placeholder clipped ("late dinn") → multiline field |
| 18 | Onboarding: plan summary | PASS | s41/s42 card, macros, facts |
| 19 | Onboarding: restart (summary "Start over" + header ↺ with confirm) | PASS | both reset to goal; first restart slow (dev compile ~3 s) |
| 20 | Onboarding: complete → Today | PASS | qa3 resumed at step 7 after sign-in (r07), activity/diet/allergies (2 chips + 2 custom)/region search "Bengal"/language/household/lifestyle chip+text/summary → "All set" (r32) → Today (r35, 1,890 kcal target). Server: onboarding_complete, allergies [peanuts, brinjal, mushrooms], lifestyle saved. Today skeleton ~8 s on first open = Next dev compile of /api/dashboard/today (3.6 s) + Metro lazy bundle, not the app |
| 20b | Onboarding: keyboard vs answer area (Android) | FIXED | r12: keyboard covered the whole composer ("Add another", numbers, lifestyle, region search) — bug 7 |
| 21 | Sign out (Settings → Sign out, confirm) | PASS | r43 dialog (back = cancel ✓), r44 row spinner, r46 welcome; server session + device of qa3 removed |
| 21b | Sign out from the onboarding header | PASS | r92 dialog, r93 header "Signing out…" + composer locked, r94 welcome |
| 22 | Sign in: empty / wrong password | PASS | t07 inline errors; t09 "Incorrect email or password", stays on sign-in |
| 23 | Sign in right password | PASS | resumes onboarding (t11) |
| 24 | App restart keeps session | PASS | force-stop + relaunch → Today for qa3 (r37); back on Today exits, relaunch from the launcher → Today (r38). Signed-out state survives a relaunch (t06) |
| 25 | Launch offline → unreachable + Try again | FIXED (polish) | With a snapshot: opens straight into onboarding, its "We couldn't load your setup" + Try again (r72); Try again offline flashed the skeleton and came back with no feedback → bug 11; now busy button ≥ 0.7 s + error buzz (r78); online → conversation restored (r80). Token without snapshot: "Offline · Can't reach ÖRZA" (r82); Try again offline → spinner (r87) then the same screen + buzz; online → onboarding at the saved step (r89) |
| 25b | Answer while offline (onboarding) | PASS | r90 toast "Can't reach ÖRZA right now…", typed 72 kept, my bubble removed; resend online → next step (r91) |
| 26 | Android back: dialogs / sign-in / sign-up / welcome / onboarding / Today | PASS (+ fix) | sign-in → welcome ✓; sign-up: 1st back closes the keyboard, 2nd → welcome (r48) ✓; sign-in ⇄ sign-up links use replace, so back → welcome (r51) ✓; welcome / onboarding / Today → app exits (activity finishes; relaunch restores state) ✓; onboarding + settings Alerts cancelable (bug 4) ✓ |
| 27 | Status bar on auth screens | FIXED | sign-in / sign-up had light (white) status icons on cream |
| 28 | Sign-up qa4 (strength "Strong", keyboard Go submits) → onboarding step 1 | PASS | r52–r54 |
| 29 | Onboarding ft/in typed feet → inches | FIXED | r61/r62: the feet field's keyboard action key sent 6'0" at once; focus never moved to inches → bug 10; r70/r71 5 ft 10 in ✓ |
| 30 | Onboarding qa4: restart (header ↺), target "Not sure yet", activity card, Vegetarian, allergies Gluten→None (exclusive), city "Indore" → Madhya Pradesh, Hinglish, Just me, lifestyle Skip, summary → Today | PASS | r63–r108 (1,680 kcal plan) |
| 31 | Sign in wrong password (qa4) then right | PASS | r96 "Incorrect email or password" banner, stays signed out; right password → resumes onboarding at step 6 (r97) |
| 32 | `Screen keyboard` regression check outside this area (Meals composer, Ask composer) | PASS | r110 meal field and r112 Ask composer sit right above the keyboard, nothing covered (drafts cleared, nothing sent, no AI call) |

## Bugs

1. FIXED — sign-in / sign-up: status-bar icons white on the cream canvas (welcome's `<StatusBar style="light">` stays
   mounted under the pushed screens). welcome.tsx renders it only while focused (`useIsFocused`). Verified:
   `dumpsys window` → LIGHT_STATUS_BARS on sign-in, light icons back on welcome.
2. FIXED — onboarding allergies: the "Add another" field kept "mushrooms" after it was added as a chip.
   Composer `InlineText clearOnSubmit`.
3. FIXED — onboarding lifestyle: single-line field clipped the placeholder ("…late dinn") and long answers scroll
   sideways. Field `multiline` (Return still sends), send button bottom-aligned.
4. FIXED — onboarding "Start over?" / "Sign out?" Alerts were not cancelable: Android back did nothing.
   `{ cancelable: true }`.
5. FIXED — onboarding: when the answer area grows (region "Show all", keyboard) the latest question scrolled out of
   view. Log ScrollView `onLayout` → scrollToEnd.
6. NOT AN APP BUG (observed) — at 16:04:57–16:05:00 something outside this test tapped the onboarding sign-out
   button and "SIGN OUT" (click sounds + dialog window in logcat, 2× POST /api/auth/logout) while I was editing
   code; the app correctly signed out. Probably manual input on the emulator window.
7. FIXED — Android: the keyboard covered every bottom composer / footer (onboarding answer area: you could not see what
   you typed in "Add another", age/height/weight, region search, lifestyle). Cause: the app is edge-to-edge
   (`edgeToEdgeEnabled=true`, RN 0.86 / Android 16), so `adjustResize` no longer resizes the window, and `Screen keyboard`
   used `KeyboardAvoidingView behavior={undefined}` on Android. Fix: `behavior="padding"` on both platforms
   (src/ui/Screen.tsx), footer drops its bottom safe-area pad while the keyboard is up, shared `useKeyboardHeight`
   (src/ui/useKeyboardHeight.ts, moved out of Sheet). Onboarding composer max height = 44 % of the space above the
   keyboard; the log's scroll-to-end on layout runs next frame (it landed on the old end). Verified r19/r26/r30. Affects
   every `Screen keyboard` screen (meals, snap, ask, account forms, med edit, rx review…) — later areas should recheck.
8. FIXED (earlier, in checkpoint ed4e93a) — session ended (401) during onboarding: a red toast "Please sign in to continue"
   on top of the sign-in screen's own "Your session ended" banner (e02) → onboarding skips the toast for 401 (e04).
9. FIXED (earlier, ed4e93a) — onboarding / settings sign-out: no feedback for the seconds the logout + calendar clean-up
   take → header says "Signing out…", the composer is locked. Offline boot "Try again" kept a blank screen while
   retrying → the unreachable screen stays with a busy button (retested in case 25 ✓).
10. FIXED — onboarding height in ft/in: the feet field takes one digit, but nothing moved focus to inches, and the
    keyboard action key on the feet field SENT the answer (6 ft → 6'0" saved, r62). Feet now jumps to inches on the
    digit and its Return key is "next"; the inches field sends. Verified 5 → focus jumps → 10 → 5'10" (r70/r71).
11. FIXED — "Try again" on the onboarding load error and on the boot "Can't reach ÖRZA" screen gave no feedback offline
    (the request fails instantly; onboarding even swapped to the skeleton and back). Both keep their screen, show a busy
    button for at least 0.7 s and buzz on failure (onboarding.tsx `retrying`, auth.tsx boot retry).
12. NOTED (cosmetic, not changed) — summary step reads "Step 14 of 14" with the progress bar not quite full (server
    `progress.value`); it fills on confirm.
