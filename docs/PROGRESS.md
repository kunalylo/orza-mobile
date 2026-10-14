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
- [ ] A1 Backend (E:\aylo\orza): mobile Bearer-token auth (login/register return a session token for `X-ORZA-Client: mobile`; `Authorization: Bearer` accepted everywhere a cookie is; logout revokes it), device registry for push/alarm de-dup. Test locally, push to live only with the user's OK.
- [ ] A2 Mobile foundation: app.json (name ÖRZA, ids, permissions text, plugins), eas.json (development / preview APK / production), fonts, theme tokens, UI kit (Screen, Text, GlassCard, Button, Chip/Tag, Input, Segmented, EnergyRing, Orb, Skeleton, EmptyState, Toast), API client (SecureStore token, 401 → sign-in), auth + user context, navigation shell (welcome → auth → onboarding → tabs), brand icon + splash.

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
