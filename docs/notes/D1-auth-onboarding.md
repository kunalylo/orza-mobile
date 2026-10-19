# D1 — auth-onboarding (emulator E2E)

Emulator Medium_Phone (Android 16, 1080x2400), dev build 0b45fa1 + alarm module, Metro from main repo, local server
http://10.0.2.2:3100 (JSON DB `E:\aylo\orza-localtest\.data\orza-db.json`). Safety gate printed SAFE at start.
Test account for this area: qa2@orza.test (password in `E:\aylo\orza-localtest\.data\test-accounts.json`).

Tooling notes: `ui` (uiautomator dump) fails with "could not get idle state" on onboarding (the orbs animate forever) —
use screenshots + coordinates there. adb `key 66`/text typed with no field focused activates whatever view has
keyboard focus (opened the onboarding "Sign out?" dialog once) — always focus a field before `type`.

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
| 20 | Onboarding: complete → Today | TODO | |
| 21 | Sign out | TODO | |
| 22 | Sign in: empty / wrong password | PASS | t07 inline errors; t09 "Incorrect email or password", stays on sign-in |
| 23 | Sign in right password | PASS | resumes onboarding (t11) |
| 24 | App restart keeps session | TODO | (signed-out state survives a relaunch: PASS t06) |
| 25 | Launch offline → unreachable + Try again | TODO | |
| 26 | Android back: dialogs / sign-in / welcome / onboarding | PARTIAL | sign-in → welcome ✓, welcome → exits ✓; onboarding Alerts ignored back → FIXED (cancelable) |
| 27 | Status bar on auth screens | FIXED | sign-in / sign-up had light (white) status icons on cream |

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
