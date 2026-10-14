# ÖRZA mobile — build progress (resume from the first unchecked item)

ÖRZA iOS + Android app, React Native with Expo (SDK 57, RN 0.86, expo-router, TypeScript, new architecture).
Backend: the live web app's API at https://orza-nine.vercel.app/api (code in `E:\aylo\orza`, contract in `E:\aylo\orza\SPEC.md`).
Design: ÖRZA brand — cream canvas `#FBF7F1`, frosted glass cards, Playfair Display headings, Figtree body, JetBrains Mono labels,
dark hero `#07090C` with glowing amber→coral→pink orb (`#FFB454 → #FF7A6A → #FF5FA2`), cyan accent `#0BBEDC`. Mobile gets richer
motion: animated orb, energy rings, haptics, glass tab bar.

**How to resume:** read this file → `git log --oneline -10` in `E:\aylo\orza-mobile` → continue the first unchecked item.
Rules: `npx expo install <pkg>` for every dependency; check Expo v57 docs (https://docs.expo.dev/versions/v57.0.0/) before using any
Expo API; never edit `android/` or `ios/` by hand (config plugins only); run `npx tsc --noEmit` + `npx expo lint` before marking done.

IDs: bundle/package `in.co.ylo.orza`, Expo owner `kunal_ylo`, scheme `orza`.

## Phase A — Foundation
- [x] A1 Backend (E:\aylo\orza): mobile Bearer-token auth (login/register return a session token for `X-ORZA-Client: mobile`; `Authorization: Bearer` accepted everywhere a cookie is; logout revokes it), device registry for push/alarm de-dup. Test locally, push to live only with the user's OK.
  — Committed locally (web `3583c79` + `96a63af`), **not pushed / not deployed**: the live site can't sign the app in until the user OKs a push. Contract: web `SPEC.md` "Mobile app (React Native) — auth & devices".
- [x] A2 Mobile foundation: app.json (name ÖRZA, ids, permissions text, plugins), eas.json (development / preview APK / production), fonts, theme tokens, UI kit (Screen, Text, GlassCard, Button, Chip/Tag, Input, Segmented, EnergyRing, Orb, Skeleton, EmptyState, Toast), API client (SecureStore token, 401 → sign-in), auth + user context, navigation shell (welcome → auth → onboarding → tabs), brand icon + splash.

## Phase B — Features (parallel streams)
- [ ] B1 Today dashboard, Meal log (text / voice / food list), Snap & Know (camera + gallery → AI scan → edit → log)
- [ ] B2 Medicines (photos via camera/gallery, schedules, stock), prescription scan → alarms, photo alarm screen (Take/Snooze/Skip), adherence
- [ ] B3 Ask ÖRZA chat, Goals, Recipes, Rebalance, Reports, Credits, Settings (profile, targets, prefs, memory, password, export, delete)
- [ ] B4 Health sync (HealthKit iOS / Health Connect Android → /api/health/import), device Calendar (expo-calendar), Reminders

## Phase C — Native alarms & notifications
- [ ] C1 Local scheduling engine (rolling window; iOS 64-pending limit; reschedule on app open, med change, timezone change; dedupe with server push)
- [ ] C2 Android native module: exact alarms + full-screen alarm activity with the medicine photo, sound/vibration, Take/Snooze/Skip actions, boot re-schedule
- [ ] C3 iOS: time-sensitive local notifications with medicine photo attachment + actions; notification permission flow

## Phase D — Test & fix (Android emulator "Medium_Phone" + EAS dev build; iOS via TestFlight)
- [ ] D1 EAS development build (Android) → install on emulator → E2E every flow → fix → repeat
- [ ] D2 iOS build via EAS → TestFlight (needs the user's Apple Developer login) → user tests on iPhone
- [ ] D3 Release builds (AAB + IPA), store listing assets, privacy (iOS PrivacyInfo, Health usage strings, Play Data safety, exact-alarm / full-screen-intent declarations)

## Log
- 2026-10-14: project created (`create-expo-app` default template, SDK 57). Plan written.
- 2026-10-14: Phase A started as a workflow (A1 backend mobile auth in E:\aylo\orza — committed locally, NOT pushed; A2 mobile foundation). If interrupted: check
  `git log` in both repos and the files present, then finish whatever A1/A2 item is incomplete before starting Phase B.
- 2026-10-14: first Phase A run was cut off by a usage limit. Checkpoints: web `3583c79` (A1 WIP: Bearer auth, devices — tsc clean, not pushed),
  mobile `2c86496` (A2 WIP: app config/icons/eas.json/theme). Phase A re-launched with "resume from WIP" instructions.
- 2026-10-14: **A2 done** (mobile). EAS project linked (`@kunal_ylo/orza`, projectId `58a9c430-3cd5-4ca2-acc1-4269354382a8`). Built:
  - `src/theme` tokens; `src/ui` kit (Screen/ScreenHeader, Text, GlassCard, Button, IconButton, Chip/Tag, TextField, Segmented, EnergyRing,
    Orb, ProgressBar, Skeleton, EmptyState, SectionHeader, Toast, PressableScale, Icon) — see README "Conventions".
  - `src/lib/api.ts` (Bearer token, JSON, timeouts, ApiError, 401 → sign-out), `auth.tsx` (AuthProvider + React Query, SecureStore token +
    small user snapshot for offline launch, `/auth/me` refresh on launch/foreground), `device.ts` (`POST /api/devices` after sign-in and on
    foreground, throttled 10 min), `onboarding.ts` (types + API).
  - Routes: root guards with `Stack.Protected` (signed out → `(auth)/welcome`; admin → `admin`; not onboarded → `onboarding`; else `(app)`),
    `(auth)` welcome/sign-in/sign-up, full chat onboarding (chips, option cards, region search, multi-select, number + units incl. ft/in,
    free text, plan summary card, restart, sign-out), `(app)/(tabs)` Today/Meals/Snap/Medicines/More with a custom glass tab bar
    (`components/TabBar.tsx`, raised Snap button), feature placeholders (ask, goals, recipes, rebalance, reports, health, calendar, reminders,
    credits, settings → `components/FeaturePlaceholder.tsx`), `alarm` full-screen modal placeholder, `+not-found`.
  - Checks: `tsc --noEmit` ✓, `expo lint` ✓ (eslint-config-expo added), `expo-doctor` 21/21 ✓, `expo export --platform android` ✓ (4.7 MB HBC).
    Visual QA on the web target at 360×640 (welcome, sign-in validation, tabs + tab bar, More, pushed screen, onboarding flow with a temporary
    stub, offline/error states): no console warnings.
  - Notes for Phase B/C:
    - Replace a placeholder by rewriting its route file (`src/app/(app)/<name>.tsx` or `(tabs)/<name>.tsx`); keep `Screen tabBar` on tab roots.
    - `registerDevice()` sends `alarms_local: false` on purpose — the server stops medicine Web Push while a phone claims local alarms. C1 must
      pass `{ alarmsLocal: true, pushToken }` only once alarms really ring on the phone. (Since the A verification below, `device.ts` remembers
      that declaration and re-sends it on every re-registration until sign-out, so the token isn't dropped — the server deletes an omitted
      `push_token`. Pass `pushToken: null` when notifications are turned off; `unregisterDevice()` calls `DELETE /api/devices/<id>`.)
    - Android tab bar uses dense glass (expo-blur needs a `BlurTargetView` on Android); iOS uses real blur.
    - Keyboard: `Screen keyboard` (KeyboardAvoidingView `padding` on iOS; Android relies on `softwareKeyboardLayoutMode: resize`). The tab bar
      hides itself while the Android keyboard is up.
    - The app cannot sign in against production until A1 (Bearer auth + devices) is deployed to the live site. To test earlier, run the web app
      with A1 and set `EXPO_PUBLIC_API_URL` to its LAN address (e.g. `http://192.168.x.x:3100`).
- 2026-10-14: **Phase A verified** (A1 + A2 both ticked).
  - Web (`E:\aylo\orza`): `npx tsc --noEmit` ✓; A1 is in local commits `3583c79` + `96a63af` (main is 2 ahead of origin, **not pushed**); A1's
    pure-helper scratch test 18/18 ✓ (no database).
  - Mobile: `npx tsc --noEmit` ✓, `npx expo lint` ✓, `npx expo-doctor` 21/21 ✓, `npx expo export --platform android` ✓ (4.7 MB HBC).
  - Cross-check of the mobile client against A1's real contract (header names `X-ORZA-Client`/`X-ORZA-Device`/`X-ORZA-Platform`,
    `{user, token}`, Bearer, `credentials: "omit"`, logout, `/api/devices`, `/api/media`). Already matched: headers, token field, JSON bodies,
    bodyless DELETE, 401 handling, device body fields. Fixed on the mobile side:
    - `api.ts`: removed the multipart `form` option (the server answers 415 to any non-JSON write; photos go as data URLs in JSON).
    - `api.ts`: `deviceLabel()` now cleans the name like the server (control/line-separator chars, single spaces, 80 code points without
      splitting an emoji — the old `.slice(0, 80)` could leave a lone surrogate and make `encodeURIComponent` throw on sign-in);
      `deviceHeaderValue()` URL-encodes it for `X-ORZA-Device` with a safe fallback.
    - `device.ts`: remembers the declared `pushToken`/`alarmsLocal` so foreground re-registrations don't wipe them; a changed or failed
      declaration bypasses the 10-min throttle; sign-out discards an in-flight registration; added `unregisterDevice()`.
    - `auth.tsx`: offline sign-out keeps the token in `orza.session.unrevoked`; the next launch retries `POST /api/auth/logout` with it and the
      next sign-in/sign-up sends it as the Bearer so the server replaces that session (A1 `startMobileSession`) — otherwise the session and its
      device registration stayed live for 30 days. `signOut({ everywhere: true })` now throws (and stays signed in) if the server can't be
      reached, instead of silently signing out only this phone.
  - Contract test (scratch, not in the repo): the real `api.ts`/`device.ts` driven with a fake fetch, each request checked with the web
    backend's own helpers (`mobileClientFrom`, `cleanDeviceLabel`, `assertSameOriginRequest`/`assertSameOriginJson`, `resolveCredential`,
    `isTimeZone`, `EXPO_PUSH_TOKEN_RE`): 11/11 ✓.
  - Still untested end to end: sign-in/logout/devices against a running backend (only production is configured — needs a local web app with
    a dev database), and anything on a real device (D1).
