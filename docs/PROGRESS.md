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
- [x] B1 Today dashboard, Meal log (text / voice / food list), Snap & Know (camera + gallery → AI scan → edit → log)
  — Today `(tabs)/index.tsx` + `features/today` (`GET /dashboard/today`, energy card, insight, quick actions, meds card on the
  shared meds hooks, water / steps / weight). Meals `(tabs)/meals.tsx` + `meal/[id].tsx` + `features/meals` (type / speak →
  `/meals/text`, food list + custom item → `/meals/manual`, edit / delete; params `compose` `voice` `date` `meal_type`).
  Snap `(tabs)/snap.tsx` + `features/snap` (camera / gallery → `/meals/scan` → review with the meals ItemEditor → confirm).
  Voice: `lib/voice.ts` (expo-speech-recognition, en-IN / hi-IN, shared remembered language). Notes: `docs/notes/B1a*`, `B1b*`.
- [x] B2 Medicines (photos via camera/gallery, schedules, stock), prescription scan → alarms, photo alarm screen (Take/Snooze/Skip), adherence
  — Photos: `lib/image.ts` (system picker, camera permission, contextual manipulator, size steps; `maxBytes` option).
  Medicines tab `(tabs)/medicines.tsx`, `med/[id].tsx`, `med/edit.tsx` (full-screen modal) + `features/meds` (timeline,
  Take / Snooze / Skip, 7-day adherence, schedule editor, stock / refill). Prescriptions `rx/index|review|done.tsx` +
  `features/rx` (scan, manual entry, review → apply). Alarm `alarm.tsx` (`?med=&at=`) + `features/alarm`. Notes: `B2a*`, `B2b*`.
- [x] B3 Ask ÖRZA chat, Goals, Recipes, Rebalance, Reports, Credits, Settings (profile, targets, prefs, memory, password, export, delete)
  — `ask.tsx` + `features/chat` (sessions, voice, logged-meal cards); `recipes.tsx`, `recipe/[id].tsx` + `features/recipes`;
  `rebalance.tsx` + `features/rebalance`; `goals.tsx` + `features/goals` (goal-math port, weight chart); `reports.tsx` +
  `features/reports` (daily / weekly, weekly CSV share); `credits.tsx` + `features/credits` (request credits, no prices);
  More tab + `settings.tsx` + `account/{profile,targets,preferences,memory,password,data}.tsx` + `features/settings|more`.
  Notes: `B3a*`, `B3b*`, `B3c*`.
- [x] B4 Health sync (HealthKit iOS / Health Connect Android → /api/health/import), device Calendar (expo-calendar), Reminders
  — `app.json` plugins / permissions (speech, camera, photos, calendar, HealthKit, Health Connect, notifications, SDK 26/36);
  `lib/health/*` (per-platform bridge, store, `syncHealth`, auto-sync mounted in `(app)/_layout.tsx`) + `health.tsx` +
  `features/health`; `calendar.tsx` + `features/calendar` (month grid, agenda, phone-calendar copy, subscribe feed, connect
  own calendar); `reminders.tsx` + `features/reminders` (server reminders, quiet hours, WhatsApp, notification permission).
  Notes: `B4a*`, `B4b*`.

### Phase B open issues (carry into C / D)
- **Backend (web repo, not changed by the app work):** add `"health_connect"` to `IMPORT_SOURCES` in
  `E:\aylo\orza\src\components\care\health\metrics.ts` (Android uploads fall back to `apple_health` until then). A1 (Bearer
  auth + devices) is still unpushed — the app can't sign in against production until it is deployed.
- **Never run on a device or against the live API** (D1): mic permission flow + Hindi recognition, camera / gallery
  permission flows (deny → blocked → Open Settings), swipe-to-delete in scroll views, sheets inside sheets (time picker inside
  the medicine editor), `med/edit` opening over the alarm on iOS, Android keyboard with edge-to-edge (`Screen keyboard` uses no
  KeyboardAvoidingView behaviour on Android — may need `padding` or a keyboard controller), expo-sharing of cache-folder files
  (reports CSV, data export) on Android, Reanimated SVG animations, phone-calendar sync (dev build; iOS needs full access),
  HealthKit / Health Connect (dev build), 360×640 layouts. Response shapes come from the web route handlers.
- **Phase C:** local reminder / alarm notifications (reminders arrive via the server today); alarm screen doesn't keep the
  screen awake (`expo-keep-awake` is not a direct dependency — add with a time limit in C2/C3); iOS time-sensitive
  entitlement, a dedicated 96×96 notification icon; Play Console declarations (USE_FULL_SCREEN_INTENT, SCHEDULE_EXACT_ALARM,
  Health Connect permissions form, privacy policy covering health data).
- **Deliberate gaps:** prescription free-text frequency parser (web `lib/care/frequency.ts`) not ported — pattern chips +
  custom times instead, "As written" read-only; no per-medicine dose-history endpoint (detail shows 7 / 30-day totals);
  Android camera process-death recovery (`getPendingResultAsync`) not handled; Health Connect reads only 30 days before the
  first grant; web-only pieces left out (credit price cards — App Store 3.1.1; doctor print view — weekly CSV instead, PDF
  would need expo-print; browser-alarm explainer); food-list allergy filter is a compact copy of the web matcher; `for_person`
  is per prescription (API shape); Today's "Type or speak" opens the composer — no one-tap mic shortcut yet (Meals accepts
  `voice=1`). The memory screen trusts a fresh `GET /api/profile`; any future `setUser` with a stale / partial user could
  make a memory edit overwrite the list.
- **Duplicated helpers (fine for now, tidy later):** `formatNumber` ×4 (chat, goals, meals, settings); date helpers (`addDays`
  ×3, `todayInTz` / `todayIn` ×4, `DEFAULT_TZ` ×3); unit maths + activity / target defaults in `goals/math` and `settings`;
  two Steppers (meals, meds), two scan Viewfinders (snap, rx), `FALLBACK_COSTS` (meals, credits), photo-problem mapping (snap,
  rx, meds PhotoGrid), `useLogWeight` (today, goals).

## Phase C — Native alarms & notifications
- [x] C1 Local scheduling engine (rolling window; iOS 64-pending limit; reschedule on app open, med change, timezone change; dedupe with server push)
  — `src/lib/alarms/**`: pure planner mirroring web `dispatch.ts` + `schedule.ts` port (doses grouped per minute, snooze
  re-rings, quiet hours silence doses / snoozes / reminders → `quietDoses` warning, refill alerts 08:00–21:00 once a day,
  7-day window, cap with 25 % kept for reminders), photo cache (first 2 photos per medicine, JPEG ≤ 1080 px, Bearer
  download), offline action queue → `POST /api/meds/doses`, sync orchestrator (single-flight, cached last good data,
  `registerDevice({alarmsLocal})` only when alarms really ring), hourly background task (`index.ts` entry), sign-out
  cleanup. `npm run test:alarms` 28/28. Notes: `docs/notes/C1-engine.md`.
- [x] C2 Android native module: exact alarms + full-screen alarm activity with the medicine photo, sound/vibration, Take/Snooze/Skip actions, boot re-schedule
  — local Expo module `modules/orza-alarms` (Kotlin, **never compiled here — the first EAS / local Gradle dev build is the
  compile check**): `setAlarmClock` / exact / inexact fallback, insistent "orza_alarms" channel with the ÖRZA tone, BigPicture
  of the photos, full screen over the lock screen, Take / Snooze 10 min / Skip working with the app killed, boot / update /
  time-change re-schedule, battery-exemption status. Adapter `src/lib/alarms/adapter.android.ts`. Notes: `C2-android.md`.
- [x] C3 iOS: time-sensitive local notifications with medicine photo attachment + actions; notification permission flow
  — `adapter.ios.ts` + `notifications-ios.ts` (≤ 60 pending, diffed scheduling, photo COPY attachment, categories with
  Take / Snooze / Skip — all open the app, local snooze re-ring), `lib/notifications.ts` (foreground handler, one response
  stream incl. cold start), app.json time-sensitive entitlement + bundled alarm sound. Notes: `C3-ios.md`.
- [x] C4 Integration + UI — custom entry `index.ts`; root `installNotificationHandling()`; reminder / quiet-hours /
  preference / permission changes re-plan the alarms; one Android "Reminders" channel (`orza_reminders`); alarm screen ↔
  phone alarm (tap → dismissed on open; raised by the ringing alarm → rings until the first press, `silenceRinging`;
  unlock before leaving; lock screen released when the last alarm screen closes; one screen per alarm); offline alarm
  screen from the phone's data with queued presses; "Alarms on this phone" card (full on Reminders, compact on Medicines:
  permissions + fixes, next alarm with names, quiet-hour doses, battery tip, Test alarm in 10 s with a medicine photo or
  the sample strip); first-run permission sheet after the first alarm medicine / an applied prescription; 27 s alarm
  tone; dev builds refuse a missing API URL; Android `networkInspector: false`. Notes: `C4-integrate.md`.

### Phase C device test plan (D1 Android emulator + EAS dev build, D2 iPhone via TestFlight)
Before anything: the bundle must carry the LOCAL origin (`.env.local` → `http://10.0.2.2:3100`); a dev build without a URL
must show "API URL not configured" (never the live site). First Android dev build = the Kotlin compile check (expect small
fixes); confirm `npx expo-modules-autolinking resolve --platform android` lists `orza-alarms` in the build tree.
- **Permissions** (Android 13+ / 14+ / iOS): add the first medicine with times → the "Let your medicine alarms ring" sheet →
  system prompt; deny → card shows "Off" + Open Settings; grant → card "On", Next alarm with names. Android: "Alarms &
  reminders" off → "Alarms may ring late" + Allow (Settings page) → back in the app the card updates and alarms re-plan;
  full-screen intents off (Android 14) → warning + Allow; battery not Unrestricted → tip + Battery settings. Applying a
  prescription without permission shows the sheet too; "Not now" → not asked again for 24 h.
- **Test alarm**: tap → rings in 10 s with the first medicine's photo (sample strip without photos). App open → alarm screen
  opens itself (`?test=…&ringing=1`) and keeps ringing until a press; phone locked → Android full screen over the lock
  screen, iOS time-sensitive banner with the photo + 27 s tone; Take / Snooze / Skip record nothing; Android test alarm
  survives a re-plan.
- **Real doses**: a dose 2 min ahead → rings with photos (two medicines at the same minute → one alarm, both photos,
  "Take all"). Cases: app open (screen opens, rings until first press), app in background, app swiped away / killed,
  phone locked (Android full screen; iOS lock-screen banner), airplane mode (still rings; alarm screen shows "No
  connection — saved on your phone", presses queued and sent when back online — check the web shows them), Doze
  (`adb shell dumpsys deviceidle force-idle`), reboot (Android: alarms restored; a dose missed ≤ 30 min while off rings
  after unlock), timezone change, clock change.
- **Actions from the notification/alarm**: Take / Skip / Snooze in the shade with the app killed (Android records natively,
  shows in the app after opening; iOS opens the app then records); Snooze re-rings 10 min later under the same alarm (no
  duplicate); a press while offline syncs later; Take on the web → the phone's pending alarm disappears after the next sync.
- **Alarm screen**: opened by a tap → its notification disappears; raised over the lock screen → sound continues until the
  first press, stops on Take / Snooze / Skip / Close; "Go to medicines" / "Add a photo" ask for PIN / fingerprint first;
  Close over the lock screen returns to the lock screen (the app isn't reachable without unlocking); a second alarm while
  one is open stacks, closing both releases the lock screen.
- **Quiet hours**: set quiet hours covering a dose → the Reminders card and the Medicines compact card warn ("N doses …
  won't ring"), QuietHoursCard shows the count; the dose doesn't ring; a refill alert waits until quiet hours end.
- **Reminders**: meal / water / weigh-in / custom reminders with push on ring as normal notifications on "orza_reminders"
  (one "Reminders" channel in Android settings); "Gentle reminders" off in Settings → they stop; tap opens the right screen.
- **Server dedupe**: with alarms ringing on the phone `POST /api/devices` declares `alarms_local: true` (web medicine Web
  Push paused — card note); revoke notification permission → declares false (Web Push resumes); sign out → every alarm
  cancelled, photos / cache / queue / test record deleted, no alarm rings for the next account.
- **Background refresh**: leave the app closed for a few hours with a medicine change made on the web → the phone's alarms
  follow after the OS runs the hourly task (timing is up to the OS; force-quit on iOS stops it).
- **iOS specifics (D2)**: ≤ 60 pending (busy schedule → `coveredUntil` < 7 days, extended on the next open); Time
  Sensitive switch on → rings through Focus; silent switch → vibrates + shows only (Critical Alerts would be needed — CEO
  decision); snooze re-ring keeps its photo after an app update; cold-start tap opens the right alarm.

### Phase C backend requests (web repo — optional, not blocking)
1. `POST /api/meds/doses`: accept an optional client `acted_at` (clamped to [scheduled_for − 36 h, now]) and, for snooze, a
   client `snooze_until` (clamped to now … now + 60 min), so presses made offline on an alarm record when they happened
   (today the phone drops a snooze that couldn't be sent within its 10 minutes).
2. `GET /api/meds/doses?from=&to=` returning only acted dose logs for a range (the engine calls `/api/meds/today` per local
   day — up to 9 calls on a cold cache, usually 1–3).
3. A push sender (FCM / APNs) would let the server wake the phone after a web-side change; until then the phone re-plans on
   open, on change events and in the hourly background task (`push_token` stays null).

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
- 2026-10-14: Phase B prep: all Phase B/C native deps installed in one go (expo-image-picker/-manipulator, expo-speech-recognition,
  expo-notifications, expo-calendar, HealthKit (@kingstinct + nitro), react-native-health-connect, background-task, build-properties…);
  `src/lib/image.ts` interface stub (B2 implements). Phase B launched: B1 food, B2 meds (+image.ts), B3 coach/account, B4 health/calendar/
  reminders (+ owns app.json plugin config). If interrupted: inspect git log/status, finish incomplete streams (resume prompts), then verify.
- 2026-10-14: first Phase B run hit the session limit while the 4 agents were still researching (nothing written). Re-planned for
  resilience: 9 smaller builder steps in 4 lanes (each lane sequential, lanes parallel), every builder keeps a research + checklist
  file `docs/notes/<step>.md` (written early, read first on resume) and writes code incrementally; then one verify/integrate step.
  Added before relaunch: `scripts/gen-routes.cjs` (`npm run routes` / `npm run typecheck` — typed routes without a dev server),
  `src/lib/voice.ts` (useVoiceInput stub, implemented by B1a), `src/features/meds/events.ts` (dose events), `src/ui/Sheet.tsx`
  (shared bottom sheet). Lanes: food B1a meals+voice → B1b snap+today · meds B2a image.ts+medicines → B2b prescriptions+alarm ·
  coach B3a chat+recipes+rebalance → B3b goals+reports+credits → B3c settings+more · care B4a app.json+health → B4b calendar+reminders.
  Pushed routes use singular folders: meal/, med/, rx/, recipe/, chat/, account/ … Modal routes: listed for the verifier to add to
  `src/app/(app)/_layout.tsx`. If interrupted: re-run the same workflow script with resumeFromRunId (finished steps are cached), or
  check `docs/notes/*.md` checklists + `git status` and finish each step by hand.
  Run: workflow `orza-mobile-phase-b2`, run id `wf_1e9916a7-4c3`, script
  `C:\Users\ADMIN\.claude\projects\E--aylo-orza\28092694-1d2e-42df-925f-dfe01d5728c5\workflows\scripts\orza-mobile-phase-b2-wf_1e9916a7-4c3.js`.
- 2026-10-15: **Phase B verified + integrated** (B1–B4 ticked; per-step notes in `docs/notes/`). Steps B1a/B2a/B3a then
  B1b/B2b/B3b/B4a were checkpointed in `8e87b92` / `081bb61`; B3c and B4b were finished from those checkpoints. Integration:
  - `(app)/_layout.tsx`: health auto-sync mounted once for the signed-in area (removed from the Health screen); `med/edit`
    registered as a full-screen modal (exact safe-area / keyboard; opens over the alarm — a plain push from a modal lands
    underneath it on iOS). No other modal routes needed.
  - Links: stack screens now return to tab routes with `router.dismissTo` (calendar agenda, reminders, reports meal log,
    medicine / recipe "not found") — `navigate`/`push`/`replace` there stacked a second copy of the tabs. Chat memory links →
    `/account/memory`, chat logged-meal card → `/meal/[id]?date=`, Goals "Fine-tune" → `/account/targets`, recipes kitchen
    card → `/account/profile`.
  - `lib/api.ts`: a `wrong_password` 401 no longer signs out (as on the web); the password change uses the normal client.
  - `lib/voice.ts`: `loadVoiceLang` / `saveVoiceLang` (`orza.voiceLang`) shared by the meal composer and the chat composer.
  - `lib/image.ts`: optional `maxBytes`; Snap sends up to 2.5 MB (base64 body stays under the host's 4.5 MB limit).
  - `features/meals/api.ts` exports `DAY_SUMMARY_ROOTS` / `invalidateDaySummaries` (Snap and chat reuse them); water / steps
    also refresh Reports. Removed the unused `components/FeaturePlaceholder.tsx`; README layout / conventions updated.
  - Expo patch updates (`npx expo install --fix`: expo 57.0.29, expo-router 57.0.27, @expo/ui, expo-linking, expo-notifications).
  - Checks: `npm run typecheck` ✓ (typed routes regenerated; every link resolves), `npx expo lint` ✓, `npx expo-doctor` 21/21 ✓,
    `npx expo export --platform android` ✓ (6.5 MB HBC) and `--platform ios` ✓ (6.4 MB HBC), exported outside the repo.
  - Next: Phase C (native alarms & notifications), then D1 device testing of everything above.
- 2026-10-15: pushed `81e8516` to origin. Web: `619f0cc` (local, NOT pushed) — `/api/health/import` accepts `health_connect`
  (web is now 3 commits ahead of live: A1 `3583c79` + `96a63af`, and `619f0cc`; push needs the user's OK).
  Phase B review launched (find → refute → fix per area: food, meds, coach, account+shared core, care; then integrate + commit).
  Run: workflow `orza-mobile-phase-b-review`, run id `wf_4b919118-66d`, script
  `C:\Users\ADMIN\.claude\projects\E--aylo-orza\28092694-1d2e-42df-925f-dfe01d5728c5\workflows\scripts\orza-mobile-phase-b-review-wf_4b919118-66d.js`.
  If interrupted: re-run it with resumeFromRunId (finished agents are cached); fixers keep `docs/notes/review-<area>.md` checklists.
  Plan after the review: Phase C (C1 scheduler, C2 Android alarm module, C3 iOS notifications), then D1 on the emulator against a
  LOCAL web server (JSON-file DB, `EXPO_PUBLIC_API_URL=http://10.0.2.2:3100`) so testing never touches production data.
- 2026-10-15: review finding food-1 is also a LIVE web bug: editing a meal whose stored items hold `null` (grams / confidence —
  MongoDB keeps missing values as null) failed with 400. Fixed server-side in web `3aac35a` (local, NOT pushed): the meal item
  schema treats null as "not given"; the web editor no longer sends null. Web is now 4 commits ahead of live.
- 2026-10-15: user OK'd "push web" → web pushed `b8e37d7..3aac35a` (A1 Bearer auth + devices, health_connect import source,
  meal-edit null fix); Vercel auto-deploys. `next build` passed locally before the push. The app can now sign in to production.
- 2026-10-15: **Phase B review** (workflow `orza-mobile-phase-b-review`, run `wf_4b919118-66d`, resumed after a usage-limit
  stop; find → skeptic refute → fix per area → integrate). Each fixer's checklist and notes: `docs/notes/review-<area>.md`.

  | Area | Found | Confirmed | Fixed | Ids |
  |---|---|---|---|---|
  | food (Today, Meals, Snap, meal edit, voice) | 6 | 6 | 6 | food-1 (high) … food-6 |
  | meds (medicines, med edit, rx, alarm) | 6 | 6 | 6 | meds-1 … meds-6 |
  | coach (chat, recipes, rebalance, goals, reports, credits) | 4 | 4 | 4 | chat-1, contract-1, recipes-1, credits-1 |
  | account + shared core (settings, more, auth, api, ui) | 5 | 5 | 5 | account-1 … account-5 |
  | care (health, calendar, reminders) | 5 | 5 | 5 | calendar-1/2/3, health-1/2 |
  | **Total** | **26** | **26** | **26** | none refuted, none "needs device", none left unfixed |

  - Highlights: editing a meal sent `confidence: null` → 400 (food-1, also a live web bug, fixed server-side in web `3aac35a`);
    a quantity typed into the Stepper was dropped when Save was tapped with the field focused (food-2); the text-log timeout
    equalled the server's AI timeout, so a retry could log twice (food-3, now 75 s + "may still have logged" message);
    `ai_busy` 503s treated as "AI off" (food-4 / meds-3); a Take could be overwritten by an in-flight refetch (meds-2) and
    the edit form re-sent an old stock count (meds-1); the phone-calendar link outlived sign-out and passed to the next
    account (calendar-2) and two syncs could duplicate events (calendar-3); late `/auth/me` / mutation answers could bring a
    signed-out user back (account-5); Profile / Targets saves put back stale values (account-2/3).
  - Integration (shared requests): `DailyReportView` passes the report's `date` to `/meals` (stale-day bug like food-5);
    `Sheet` gains `onBlockedDismiss` (backdrop, X and Android back call it while `dismissible={false}`; swipe stays off) and
    the rx row editor uses it, so every way out asks "Discard changes?"; one zod-400 parser `validationField(e)` →
    `{field, path, message}` in `lib/api.ts` replaces the copies in chat, goals, meds and settings, and is also used by the
    meal text composer (`text`) and Snap (`note`), which checked an `e.field` the meals routes never send; `signOut`
    deletes the phone's ÖRZA calendar (`clearPhoneCalendar`, dynamic import, ≤ 4 s, deliberate sign-out / account deletion
    only). README conventions: `validationField`, `Sheet` `onBlockedDismiss`.
  - Checks: `npm run typecheck` ✓, `npx expo lint` ✓, `npx expo-doctor` 21/21 ✓, `npx expo export --platform android` ✓
    (6.5 MB HBC) and `--platform ios` ✓ (6.4 MB HBC), exported outside the repo.
  - Backend issues (web, not changed here):
    1. `src/lib/db.ts:78` builds the `MongoClient` without `ignoreUndefined: true`, so `undefined` optional fields are stored
       as `null` and echoed back to every client. `3aac35a` (meal item schemas accept null) is pushed; still consider
       `ignoreUndefined: true` (or stripping undefined before insert) so other routes whose `.optional()` schemas get stored
       documents sent back don't hit the same 400.
    2. `/api/meals/text` (worst case ≈ 45 s AI + parser fallback + DB write) and `/api/meals/scan` (60 s vision timeout) set
       no `maxDuration`; if the Vercel plan's default is lower the platform answers 504 instead of the fallback. Consider
       `export const maxDuration = 60` on both (health import / sync and cron already do).
  - Check on device (D1): the review flagged nothing as "needs device" and left nothing unfixed. Worth a look on the phone
    because the fixes touch platform behaviour: rx row editor with edits → Android back / backdrop / X ask "Discard
    changes?" and swipe-down does nothing; Stepper typing ("1." stays, Save with the field focused keeps the value); mic
    takeover between the meal composer and chat (the first screen stops "listening" and keeps its text); scrolling over a
    Health chart doesn't select a day; Health Connect "awake in bed" not counted as sleep; phone calendar deleted on
    sign-out and not inherited by another account, a single sync when Calendar is reopened mid-sync; a slow text log
    (> 45 s) shows the "may still have logged" message and the meal appears after the refetch.
    Known narrow edge (food-5, left as is): if Meals' own `today` is stale across midnight while unfocused, an incoming
    `date` equal to the new today is ignored until its focus sync runs.
  - Next: Phase C (C1 scheduler, C2 Android alarm module, C3 iOS notifications), then D1 against a LOCAL web server.
- 2026-10-15: web follow-ups from the Phase B review: (1) explicit `maxDuration` on the six AI routes (60 s text, 90 s vision) —
  web `c3e234c`, local, NOT pushed (needs the user's OK); (2) audit of every web write route for the stored-null echo bug class
  (workflow `orza-web-null-echo-audit`): 0 further cases — only meal items were affected (fixed + live in `3aac35a`); not switching
  MongoClient `ignoreUndefined` globally because 78 `$set` sites would change meaning (undefined would stop clearing fields).
- 2026-10-15: **Phase C launched** (workflow `orza-mobile-phase-c`, run `wf_8fc4efa1-cae`, script
  `C:\Users\ADMIN\.claude\projects\E--aylo-orza\28092694-1d2e-42df-925f-dfe01d5728c5\workflows\scripts\orza-mobile-phase-c-wf_8fc4efa1-cae.js`):
  C1 engine (pure planner mirroring web dispatch.ts + schedule.ts port, photo cache, action queue, sync orchestrator, tests) →
  C2 Android local Expo module `modules/orza-alarms` (exact alarms, insistent alarm channel, BigPicture photo, full-screen over lock
  screen, Take/Snooze/Skip receivers, boot reschedule, synthesised alarm tone) ‖ C3 iOS (time-sensitive local notifications with photo
  attachments, ≤60 pending window, categories/actions, app.json) → C4 integration + "Alarms on this phone" card + test alarm → review/fix.
  Decision: quiet hours keep web parity (doses inside quiet hours don't ring) + the phone warns about such doses.
  If interrupted: re-run with resumeFromRunId; each step keeps `docs/notes/C*.md`.
- 2026-10-15→19: **D1 setup (local Android builds)** — Temurin JDK 17.0.20.1 at `C:\Users\ADMIN\.jdks\jdk-17.0.20.1+1` (sha256 verified);
  build worktree `E:\aylo\orza-mobile-build` (detached, prebuild → `gradlew assembleDebug -PreactNativeArchitectures=x86_64`, first
  build 14 min, incremental ~5 min; JAVA_HOME/ANDROID_HOME passed per command, nothing changed system-wide); local web test copy
  `E:\aylo\orza-localtest` (worktree of the web repo, `.env.local` WITHOUT MONGODB_URI → JSON-file DB `.data/`, test accounts in
  `.data/test-accounts.json`); emulator AVD Medium_Phone (Android 16, x86_64) started detached; Metro via launch config
  `orza-mobile-metro-local` with `EXPO_PUBLIC_API_URL` from the build copy's `.env.local`.
  Findings:
  1. Blank screen on Android dev builds: the dev-client network inspector corrupts Metro's chunked multipart bundle response
     (`ProtocolException: Expected leading [0-9a-fA-F] character but was 0xd`). Fix: `expo-build-properties` → `android.networkInspector: false`.
  2. INCIDENT: the first emulator sign-up went to PRODUCTION — `set "EXPO_PUBLIC_API_URL=…"` inside the cmd launcher never reached Expo,
     and `config.ts` silently defaults to the production origin. One QA account (`qa1@orza.test`) was created live 15:53 UTC and removed
     minutes later (user + 1 credit_transaction + 1 session + 1 device, nothing else existed); production re-checked clean. Fixes: env via
     `.env.local`, Metro launched with `--clear`, the bundle is grepped for the local origin before any interaction, and dev builds must
     never silently fall back to production (config guard — C4 task).
  Local sign-up against the test server then worked.
- 2026-10-19: **Phase C complete (C1–C4), unverified on devices.** C4 integration (resumed after a usage-limit stop; WIP
  `4932dc0`): custom entry, notification handling at the root, alarm data events from reminders / quiet hours / Gentle
  reminders / permission requests, Android reminders channel = the module's `orza_reminders`, presence-aware alarm opening
  (`lib/alarms/presence.ts`, `ringing=1` when the alarm itself raised the screen), alarm screen ↔ native (dismiss on a tap,
  ring until the first press when raised by the alarm, `silenceRinging`, `requestUnlock`, `releaseLockScreen`), offline
  alarm screen (`features/alarm/offline.ts`, waits ≤ 4.5 s for the server, presses queued), Test alarm (`lib/alarms/test.ts`,
  `/alarm?test=<at>` demo), "Alarms on this phone" card (`features/alarms`, full on Reminders, compact on Medicines,
  QuietHoursCard dose count), first-run permission sheet (`promptAlarmPermission` from medicine create / prescription
  apply), dev-build API URL guard (`lib/config.ts` `API_CONFIG_ERROR` → blocking screen, `.invalid` origin; release builds
  unchanged), `expo-build-properties` `android.networkInspector: false`, README conventions + emulator `.env.local`.
  Checks: `npm run typecheck` ✓, `npx expo lint` ✓, `npm run test:alarms` 28/28 ✓, `npx expo config --type introspect` ✓
  (Android `EX_DEV_CLIENT_NETWORK_INSPECTOR=false`, iOS time-sensitive + aps-environment, alarm permissions), `npx expo
  export` android ✓ (6.7 MB HBC) / ios ✓ (6.6 MB HBC) outside the repo, dev export confirms the URL guard is inlined.
  `npx expo-doctor` 20/21: three patch updates published since Phase B (`@expo/ui` 57.0.25, `expo` 57.0.30, `expo-router`
  57.0.28) — run `npx expo install @expo/ui expo expo-router` before the next dev build.
  Next: D1 — Android dev build (Kotlin compile check) → emulator against the LOCAL web server → device test plan above.
