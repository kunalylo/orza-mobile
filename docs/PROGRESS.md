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
  7-day window, cap: medicine alarms first, reminders fill the rest), photo cache (first 2 photos per medicine, JPEG ≤ 1080 px, Bearer
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
- [x] C5/C6 Phase C review — 16 findings (6 Android module, 10 engine / iOS), all confirmed and fixed (none refuted;
  direct-boot awareness, an optional part of F3, left for D1). Notes: `docs/notes/C6-fix.md`.
  - Android: a due alarm not delivered yet (Doze / inexact delay) is never dropped by a re-plan or a time / update
    re-schedule (kept ≤ 3 h, set again → fires at once; `dismiss` drops one whose doses were handled); alarm launch of a
    killed app with its task in Recents keeps the alarm deep link (`setIntent`) + JS safety net releasing the lock screen
    when no alarm screen opened within 8 s; doses missed while the phone was off (> 30 min, ≤ 12 h) or held back > 3 h show
    as a silent "Missed" alarm with photos and Take / Snooze / Skip instead of vanishing; "Medicine alarms" channel set to
    Silent / no sound → `silenced` (alarms stay set, `alarms_local` false, fix-it row); a pending.json write failure rejects
    `scheduleAll` / `scheduleOne` (nothing set, engine declares false); a partly handled alarm still showing has its
    buttons (and quiet copy) reduced to the open doses.
  - Engine: Snooze in the app (alarm / Today screen) sets the re-ring on the phone at once (also offline) and keeps it
    through a plan made just before; logs ÖRZA confirmed are kept (`lib/alarms/recent.ts`) so a failed refetch can't
    lose a snooze / bring back a taken dose; snooze / skip never apply to a dose already taken / skipped (alarm buttons,
    native actions, planner overlay, and a `GET /api/meds/doses?at=` check before a queued one is sent); older queued
    presses are superseded by an in-app action; snoozes of one alarm sent one after another ring once (60 s grouping);
    medicine alarms get the whole iOS cap, the last one says "Open ÖRZA to set your next alarms" when cut; an unreadable
    permission changes nothing (no mass cancel); iOS never cancels an alarm due within 5 s, and Notification-Center-only
    counts as silenced; the last `alarms_local` declaration persists across launches (no false → true flip on cold
    start); the iOS banner is hidden only when the alarm screen really is in front.

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
  after unlock, older ones ≤ 12 h show as a silent "Missed" alarm), timezone change, clock change.
- **Review fixes (C6)**: inexact mode (Alarms & reminders off) + Doze — open the app a few minutes after a dose time that
  hasn't rung yet → it still rings; kill the app (task kept in Recents) → the alarm opens the alarm screen over the lock
  screen, never the home screen; "Medicine alarms" set to Silent → card "Silent" + Fix, server gets `alarms_local: false`;
  two medicines at 08:00 ringing → take one on Today → "Snooze 10 min" on the ringing notification re-rings only the
  other; Snooze on the alarm screen then lock the phone at once → rings 10 min later (iOS too); offline Snooze queued,
  then the dose taken on the web → the queued snooze is not sent.
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
1, 2, 4 and 5 are LIVE since web batch 1 (2026-11-01) and used by the phone (see the 2026-11-01 "Phone: use the live web
batch 1" log entry); 3 is still open.
1. `POST /api/meds/doses`: accept an optional client `acted_at` (clamped to [scheduled_for − 36 h, now]) and, for snooze, a
   client `snooze_until` (clamped to now … now + 60 min), so presses made offline on an alarm record when they happened
   (today the phone drops a snooze that couldn't be sent within its 10 minutes).
2. `GET /api/meds/doses?from=&to=` returning only acted dose logs for a range (the engine calls `/api/meds/today` per local
   day — up to 9 calls on a cold cache, usually 1–3).
3. A push sender (FCM / APNs) would let the server wake the phone after a web-side change; until then the phone re-plans on
   open, on change events and in the hourly background task (`push_token` stays null).
4. `alarms_local_until` on `POST /api/devices` (the phone's `coveredUntil`): the dispatcher resumes medicine Web Push after
   it — iOS keeps 64 notifications, so a member with many dose times can be covered for less than 7 days (C5L-4).
5. `recordDoseAction`: refuse `snooze` / `skip` over a dose already `taken` unless explicitly overridden (the phone now
   checks first; this protects against other clients and races).

## Phase D — Test & fix (Android emulator "Medium_Phone" + EAS dev build; iOS via TestFlight)
- [x] D1 Android dev build (local Gradle, JDK 17) → emulator → E2E every flow against the LOCAL server → fix → retest (2026-10-27, 250 cases)
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
- 2026-10-19: **Phase C review fixed (C6)** — 16 findings verified, all confirmed and fixed (summary under Phase C;
  details + D1 device checks in `docs/notes/C6-fix.md`). Resumed after a usage-limit stop from WIP `a31d030`; the resumed
  run re-verified every fix and added: ringing partly-handled Android alarms get their "showing" record reduced to the
  open doses (Snooze all / Skip all can't hit a taken medicine), in-app snooze re-rings survive a plan made just before
  the press (`withInAppSnoozes`), an empty channel sound URI counts as silenced. Checks: `npm run typecheck` ✓, `npx expo
  lint` ✓, `npm run test:alarms` 34/34 ✓, `npx expo config --type introspect` ✓, `npx expo export` android ✓ (6.7 MB) /
  ios ✓ (6.6 MB) outside the repo, `npx expo-doctor` 20/21 (same three patch updates as before). Kotlin still uncompiled —
  the D1 dev build is the compile check.
- 2026-10-19: Phase C complete + pushed (`0b45fa1`: C4 integration, 16 review findings fixed). First native build with
  `modules/orza-alarms` compiles (`--max-workers=2`; the C++ "unspecified system_category error" is a transient Windows file lock —
  re-run). App launches with the module, no crash. Metro now serves JS from the MAIN repo (`.env.local` → local server) so D1 fixes
  hot-reload. Safety gate `node scripts/e2e/verify-local-bundle.mjs` + helpers `scripts/e2e/adb.sh` (`baf87eb`).
  **D1 launched**: workflow `orza-mobile-d1-e2e`, run `wf_13c9ee26-f64`, script
  `C:\Users\ADMIN\.claude\projects\E--aylo-orza\28092694-1d2e-42df-925f-dfe01d5728c5\workflows\scripts\orza-mobile-d1-e2e-wf_13c9ee26-f64.js`
  — 9 areas sequential on the emulator (auth-onboarding, today-meals, snap, meds-rx, alarms, coach, progress-account, care, layout-a11y),
  each test → fix JS → retest → commit; then wrap-up (native fixes, rebuild, retest, PROGRESS, push). Each area keeps `docs/notes/D1-<area>.md`.
  If interrupted: restart emulator / `orza-localtest` / `orza-mobile-metro-local`, run the safety gate, re-run the workflow with resumeFromRunId.
- 2026-10-20: D1 progress: auth-onboarding DONE (`094f922`: keyboard avoidance on Android edge-to-edge via Screen padding, ft/in focus flow,
  offline retry feedback + 5 earlier fixes); today-meals partial (`f8bd255`: double meal log on one Enter, logged card visibility, sheet +
  keyboard, insight glow, composer focus). Client request: "why do we have to enter steps manually — it has to do it by itself" → **auto
  steps** workflow `orza-mobile-auto-steps` (run `wf_fc8a83eb-b97`): iOS HealthKit / CMPedometer, Android Health Connect / native step-counter
  sampler (`modules/orza-steps`), pure tested day math, Today card, auto-save via POST /api/track/steps (no backend change). D1 resumes after
  it (today-meals task now includes auto steps).
- 2026-10-20: **Auto steps — review fixed + emulator test** (`bc9bf2b` build, WIP `a51733d`/`cbcc07d`, then this commit;
  details `docs/notes/steps-fix-and-device-test.md`). 18 review findings (N1–N7 native, F1–F11 JS), all confirmed and
  fixed: midnight samples exact with "Alarms & reminders" else an inexact chain whose worst case lands before midnight;
  reboot decided by the boot clock, not BOOT_COUNT; runtime ACTION_SHUTDOWN receiver; unprotected QUICKBOOT only
  re-arms; samples in `noBackupFilesDir` (never backed up / transferred) via AtomicFile; periodic spacing by App Standby
  bucket (medicine alarms keep their quota); reads wait for the sensor flush; the server is read right before every
  save (never Today's cache); the member's own number (website / another phone / the card's new "Edit") becomes the
  day's base and counting adds on; permission flow never waits on saves; past days final only when read to their end
  (7 days back); long-gap estimates not saved for today; boot order by BOOT_COUNT + wall clock re-anchored; mid-day
  start on top of a typed count; sign-out race; Today offline + across midnight. New `save.ts` (I/O injected) +
  `plan.ts`; manual saves serialised with the automatic queue. Checks: typecheck ✓, lint ✓, test:alarms 34/34 ✓,
  test:steps 66/66 ✓. Native rebuild compiles (orza-steps Kotlin). Emulator Medium_Phone has NO step counter: no-sensor
  state, typing fallback → local server, permission prompt / denied / blocked → Settings → granted, offline card, Health
  note all checked (3 small fixes from it); the sampler itself needs the real-phone checklist in the notes. Dev note:
  the 10.0.2.2 Metro blank screen recurred → `adb reverse` + `localhost:8081` (README, `adb.sh app_start`). Next: D1
  resumes (today-meals …) and the real-phone steps checks.
- 2026-10-20: **Auto steps done + pushed** (`59bad40`): 20 review fixes, steps tests 66/66, native `orza-steps` compiles, emulator-verified
  permission flow / card states / manual fallback / offline / local-server save. Unverified (needs a real Android phone): live counting +
  background sampler (the emulator has no TYPE_STEP_COUNTER). Planned next for reliability: Google's Recording API on mobile (Play services
  `LocalRecordingClient`, background step recording without a foreground service) as the primary Android phone source, our sampler as
  fallback. Dev note: Metro over 10.0.2.2:8081 can still blank-screen → `adb reverse` + localhost:8081 (`adb.sh app_start`). D1 resumes.
- 2026-10-20: D1 today-meals DONE (notes `docs/notes/D1-today-meals.md`, 36 cases, 17 bugs fixed). Last part: app-wide spring fix
  (Reanimated 4 defaults mass 4 / stiffness 900 made every `.springify().damping(n)` wobble ~2 s — all chains now set stiffness +
  mass 1), opaque toast kept inside the gutters, Today/Meals recover by themselves after a lost connection (`retryWhileUnreachable`),
  offline banner wording, Meals offline refresh toast. Open: Undo on the logged card not pressed on device (AI budget), live step
  counting needs a real phone.
- 2026-10-20: **NEXT after D1 (client requirement, repeated):** steps must count fully automatically "like other health apps" and sync with
  them. Task "auto steps v2": (1) Android primary source = Google Play services Recording API on mobile (`LocalRecordingClient`,
  TYPE_STEP_COUNT_DELTA, play-services-fitness in `modules/orza-steps`; background recording with no foreground service, up to 10 days),
  our step-counter sampler = fallback without Play services; (2) two-way sync — keep reading Health Connect / Apple Health (highest source
  per day, no double counting) and add an opt-in "Share my steps with Health Connect" write (WRITE_STEPS, own data origin; HC priority dedupes);
  (3) real-device test on a USB-connected Android phone (the emulator has no step sensor) — ask the user to connect one.
- 2026-10-26: D1 alarms DONE (`bfb35ea`): 24 cases — 16 pass, 7 fixed, 1 blocked (first-run permission sheet). Verified on the emulator:
  photo alarm foreground / screen-off + keyguard, grouped doses, snooze re-ring, Skip/Take from notification, quiet hours, reminders,
  process killed, reboot, offline action retry. For wrap-up: (native) ~6 s from alarm to notification when the process is dead (app cold
  start); BOOT_COMPLETED arrives ~65 s after boot → add a direct-boot-aware LOCKED_BOOT_COMPLETED path. (backend, needs push OK)
  POST /api/meds/doses should accept acted_at + absolute snooze_until for queued offline actions. Efficiency: remaining areas switch
  system animations off (Reduce Motion) so uiautomator can read screens.
- 2026-10-26: D1 coach DONE: 31 cases (Ask ÖRZA, Recipes, Rebalance) — 10 bugs fixed in JS (B1–B10, see docs/notes/D1-coach.md):
  chat header clipping, app links in replies, keyboard after New chat from the sheet, mic never re-asked after a Settings reset
  (src/lib/voice.ts), recipe prompt multiline, Recipes over-scroll after delete + scroll-back on failure, Rebalance result reveal,
  floor wording, history chevron. Backend note: rebalance floor (BMR) above the usual target means trims are always 0.
- 2026-10-27: D1 coach DONE (`9772c06`): 31 cases — 21 pass, 10 fixed (chat sheet/mic, markdown, recipes prompt/scroll/offline/delete,
  rebalance validation + reveal + wording). Backend for the next web batch: Rebalance floor = max(1200, BMR) makes maxCut 0 when BMR >
  target (every plan walks-only) and the "never below {floor}" sentence contradicts day targets — web src/lib/compensation.ts +
  RebalancePlanView.tsx. Also earlier: onboarding lb wording, dose acted_at/snooze_until, adherence history vs edited schedules.
- 2026-10-27: **Client note for D3 (iOS release): Apple review is strict — audit every permission and requirement before submitting.**
  Checklist to do in D3: purpose strings specific + just-in-time requests + app fully usable when denied (camera, photos, microphone,
  speech, motion, HealthKit share/update, calendar full/write-only, notifications); HealthKit 5.1.3 (no ads/iCloud, privacy policy,
  visible HealthKit UI, entitlement only for used types); time-sensitive notification entitlement (no critical alerts); background modes
  only as used; PrivacyInfo.xcprivacy required-reason APIs (app.json ios.privacyManifests) + App Store Connect privacy labels; in-app
  account deletion (exists); 3.1.1 — no prices / external purchase links for credits in the iOS app; 1.4.1 medical/AI disclaimers
  (prescription scan, dosing); demo account + review notes; Play equivalents (Data safety, exact-alarm/full-screen-intent/health/activity
  declarations).
- 2026-10-27: D1 progress-account DONE: 36 cases — 21 pass, 15 fixed, 16 bugs (goal planner hints, weight-chart scroll, report labels/CSV
  averages/day label, credits pill + labels, memory note field, SaveBar note, password card/keyboard reveal, sign-out-everywhere copy, delete
  field caps, auto-retry of Credits/Goals/Reports/Settings once back online). Shared UI: `Screen`/`TextField` now scroll a focused field +
  its error above a footer (`ui/scrollReveal.ts`). Web follow-up: weekly CSV "Average (logged days)" row in src/components/reports/format.ts.
- 2026-10-27: D1 care DONE (`2dd0c2a`): 38 cases (Health Connect, Calendar, Reminders) — 25 pass, 13 fixed. Health Connect denial
  recovery (after two "Don't allow"s HC never shows its sheet again → hint + "Open Health Connect", auto-connect on return), 30/90-day
  switch, calendar selected-day square, offline month states, deleted reminders left ringing in the phone calendar after the app was
  killed (re-sync flag now persisted), refill alerts counted apart from reminders, reminder sheet delete/validation scroll. For wrap-up
  (native): manifest `<queries>` for `android.health.connect.action.MANAGE_HEALTH_PERMISSIONS` (+ `androidx.health.ACTION_MANAGE_HEALTH_PERMISSIONS`
  for Android 9–13) so "Manage access" opens ÖRZA's own Health Connect page. Env: 2 GB AVD thrashes with the ~600 MB dev build (PC has
  7.4 GB, so the AVD stays at 2 GB; stop Chrome/Play/Messages if adb hangs).
- 2026-10-27: layout-a11y resumed (run `wf_13c9ee26-f64`, WIP `19f4e6f`). In parallel: web backend batch 1 being prepared in worktree
  `E:\aylo\orza-backend` (branch `mobile-backend-batch`, node_modules = junction to the main repo's; run `wf_8d8cf45b-08d`): dose
  acted_at/snooze_until, refuse snooze/skip over taken, GET /api/meds/doses range, devices alarms_local_until, adherence history after
  schedule edits, onboarding lb wording + full bar on summary, weekly CSV averages, rebalance "no room to trim" honesty (floor unchanged).
  NOT pushed — needs the user's OK; test it first by checking the branch out in `E:\aylo\orza-localtest` after D1, then adapt the phone.
  Also running: auto steps v2 research + plan (run `wf_a75a741e-df0`, read-only) → session scratchpad `steps-v2\PLAN.md`; copy it to
  `docs/notes/steps-v2.md` when D1 is committed.
- 2026-10-27: D1 layout-a11y DONE: 27 cases — 14 pass, 13 fixed, 10 bugs (`docs/notes/D1-layout-a11y.md`). TalkBack audit of every main screen
  (all icon-only buttons labelled; stale "Loading the day's totals" label on the Meals totals card fixed); deliberate sign-out no longer
  says "session ended"; small phone (720x1280 @320) + font 1.3: Welcome buttons above the gesture bar, Today / Medicines timeline / Alarm
  / Settings / More / Snap / Meals text no longer cut (button pairs: equal halves while the labels fit, stacked otherwise — normal layout
  unchanged); alarm says "ÖRZA is taking a while to answer" (not "No connection") when it falls back to the phone's copy because the
  server is slow. Emulator restored: size/density/font reset, animation scales 1.
- 2026-10-27: **D1 DONE** (wrap-up `6cc6a25`, notes `docs/notes/D1-wrap-up.md`). Results per area (final run of each area):

  | Area | Cases | Pass | Fixed | Still open |
  |---|---|---|---|---|
  | auth-onboarding | 21 | 14 | 7 | — |
  | today-meals | 17 | 11 | 5 | live step counting needs a real phone (AVD has no step sensor) |
  | snap | 24 | 15 | 8 | photo lost on process kill → FIXED in wrap-up (W14/W15, release build) |
  | meds-rx | 17 | 7 | 10 | — |
  | alarms | 24 | 16 | 7 | first-run permission sheet → PASS in wrap-up (W7) |
  | coach | 31 | 21 | 10 | — |
  | progress-account | 36 | 21 | 15 | — |
  | care | 38 | 25 | 13 | — |
  | layout-a11y | 27 | 14 | 13 | — |
  | wrap-up | 15 | 11 | 4 | — |
  | **Total** | **250** | **155** | **92** | 1 (needs a real phone) |

  Native wrap-up: Health Connect "Manage access" opens HC home on Android 14+ (per-app page is system-only); alarm cold start measured
  (release 1.8 s, debug 3.8 s; ÖRZA's own work ~0.2–0.3 s; `adb logcat -s OrzaAlarms` shows it per alarm); Snap camera photo recovered
  after Android kills the app (from expo-image-picker's temp file); charts draw plain SVG after their entrance (Reanimated settled-value
  bug); single-line placeholders; Reduce-Motion-safe layout transitions; Snap halo no longer animates forever. Release-type build
  (local only, debug-signed, prod unreachable by a wrong pin) RSS 302–325 MB vs debug 471 MB + swap.
  Checks at `6cc6a25`: typecheck ✓, lint ✓, test:alarms 34/34, test:steps 66/66. expo-doctor: 6 Expo patch updates available
  (expo 57.0.31, expo-router 57.0.29, expo-notifications 57.0.24, expo-calendar 57.0.6, expo-sharing 57.0.24, @expo/ui 57.0.26) —
  apply with the next native rebuild (steps v2) via `npx expo install --check`.
  Still open (not wrap-up fixes): N4 direct-boot (LOCKED_BOOT_COMPLETED) needs device-protected storage design + real phone; N10 rare
  native crash right after a dev-client JS reload (RN 0.86 Fabric / Reanimated layout-animation proxy, no ÖRZA code) — watch on release.
  Backend findings → web batch 1 (`E:\aylo\orza-backend`, not pushed). Web-only notes (not changed): MealComposer "1 credit · 0 left"
  hint at 0 credits although the text parser logs for free; macro bar colours differ between Today and Meals (web too); slow first
  /api/meds/doses on the local dev server (8.5 s) — check production cold starts.
- 2026-10-27: **Auto steps v2 started** — plan `docs/notes/steps-v2.md` (research + 2 critics in `docs/notes/steps-v2/`; run
  `wf_a75a741e-df0`). One reference number = the health store's day total (HC aggregate / HealthKit cumulativeSum), Today = max(store,
  phone) live; Android 14+ HC Steps, Android 9–13 Play services Recording API (sampler = fallback), iPhone Apple Health; no writes;
  per-member consent + off switch; server modes manual/auto/reconcile on /api/track/steps. Resume: first unticked step in §10.
  Phase J (pure core) running as `wf_743ae41a-b53` (WIP commit per step group; resume with resumeFromRunId).
- 2026-10-27: Web batch 1 on `mobile-backend-batch`: meds/devices `118c538` (review fixes included), onboarding + CSV `bae08b1`;
  rebalance (uncommitted) + review nits + whole-branch review running as `wf_6409d7a1-e8f`. Phone follow-up package after Phase J:
  send acted_at / snooze_until from the alarm queue, GET /api/meds/doses?from&to in alarms sync, alarms_local_until on POST /api/devices,
  409 dose_already_taken = taken, rebalance at-floor rule `usual − floor < 10` (src/features/rebalance/PlanView.tsx + types.ts).
  Rebalance + onboarding fixes committed `a53a1cb`; whole-branch review: no blockers. Last fixes + LIVE test on the local server
  (localtest switched to the branch head; DB copy in scratchpad backend/orza-db.before-batch1.json) running as `wf_1d35a352-ef8`.
  Phone-side rebalance change (exact code): docs in that run's fix-rebalance result — `atFloor = usual − floor < 10`,
  `belowFloor = floor − usual >= 10`, note shown on `atFloor || released_kcal > 0`, PRINCIPLES[0] "…if your target is already at or under it, meals stay as they are."
- 2026-11-01 (after the weekly limit): J1–J2 done `19a04fb`, J3 partial checkpoint `9d6dfe6` (test:steps 112/112); both runs resumed
  (`wf_743ae41a-b53`, `wf_1d35a352-ef8`). Emulator now has the RELEASE-TYPE TEST BUILD from the D1 wrap-up (a1b610b, installed
  2026-10-27 13:11, not debuggable): embedded JS with API http://10.0.2.2:3100, network security config `d1_test_network_security`
  = cleartext only to 10.0.2.2 + bogus pin on *.vercel.app (production unreachable) — checked with aapt2 on the pulled APK. No Metro
  needed for it; reinstall the dev build (and run the safety gate) before any JS-change testing.
- 2026-11-01: **Web batch 1 READY** (branch `mobile-backend-batch` head `47897ad`, 4 commits on top of main `c3e234c`, fast-forward):
  review fixes (lenient alarms_local_until incl. epoch ms, snoozed-then-edited doses, conditional Skip/Snooze write, legacy adherence
  heuristics), LIVE test on the local server 16/16 pass incl. the current phone build (backward compatible), `next build` clean.
  `E:\aylo\orza-localtest` is LEFT on 47897ad (switch back: `git -C E:\aylo\orza-localtest checkout --detach c3e234c`; DB backup in
  scratchpad backend/orza-db.before-batch1.json). New local account qa5@orza.test (lb onboarding). Waiting for the user's push OK.
  Phone follow-ups found by the live test (add to the phone adaptation package): on 409 dose_already_taken mark the dose taken +
  invalidate today/medicine queries (card stayed DUE NOW ~25 s); alarms days old rang on opening after the phone was off (27 Oct doses
  on 1 Nov, no date shown) → drop alarms older than ~a day / show the date for non-today doses; rebalance trim tile at the floor
  "None / Already at your safe minimum".
- 2026-11-01: **Steps v2 phase J (pure core) done** — J6 save.ts on the server modes (feature-detects `applied`; old-server branch
  behind the per-day GET guard until V4), J7 store split (prefs in documents, day records in cache, v1 flags migrated). test:steps
  208/208, test:alarms 34/34. Next: phase B (backend) / N (native Android), first unticked step in §10.
- 2026-11-01: **Web batch 1 LIVE** — user OK'd; main fast-forwarded c3e234c → `47897ad` and pushed; Vercel production deployment
  "Deployment has completed" (05:58 UTC). Phase J review + fix resumed (`wf_743ae41a-b53`). Steps v2 Phase B (web) started on branch
  `steps-v2-backend` in `E:\aylo\orza-backend` (`wf_8fb330bb-494`, local only; the B6 privacy copy needs the user's review before any push).
- 2026-11-01: Phase J review found real bugs (reconcile with unknown "since", baseFromMarker anchoring, edited-refusal finalising a
  past day, implicit start after a source change, manual edit before the first read …); fix was cut off → WIP `8f94db7` (red), fix
  resumed. Phase B built + reviewed + fixed (`e4f70b3`, `06e7bcf`); its live check resumed. Both runs: same IDs as above.
- 2026-11-01: **Steps v2 Phase B (web) DONE locally** — branch `steps-v2-backend` head `a3e3c0e` (on top of live main 47897ad):
  B1 modes manual/auto/reconcile + edit marker (`steps_edited_at`, `steps_edited_value`), no mode = legacy plain set without marker (the
  phone build testers have); web StepsCard now sends mode "manual"; B2 marker in every tracking response; B3 mirror never raises an edited
  day, future-dated steps dropped; B4 /api/health/days steps = tracked steps (typed 0 shows 0); B6 privacy page "Phone app: steps and
  health data" (#phone-app) + settings copy — describes the v2 app → USER REVIEW before push, publish with v2; B7
  `scripts/check-steps-modes.mjs` 25/25 on the local server (`ORZA_CHECK_TOKEN` to reuse an account). localtest now runs `a3e3c0e`
  (DB backup scratchpad backend/orza-db.before-steps-b.json). Not pushed (plan V4).
- 2026-11-01: Phase J review fixes DONE (`1b47a39`, 13/13 findings real and fixed, test:steps 241/241). Plan ticks B1–B7 (`963c513`).
  Running now: `wf_bb87f5d9-a6e` = (1) phone adaptation to the LIVE web batch 1 (acted_at/snooze_until, 409 = taken, one doses-range
  read, alarms_local_until, no ringing for doses already missed + date on non-today alarms, rebalance floor tile/note), (2) steps v2
  Phase N (native Android N1–N5 + Expo patch updates, rebuild in the build copy, install the DEV build on the emulator — replaces the
  release-type test build — smoke test incl. the batch-1 changes), (3) two reviewers, (4) fix. Metro + localtest started by the
  coordinator (preview_start orza-mobile-metro-local / orza-localtest); safety gate SAFE.
- 2026-11-01: **Phone adapted to the live web batch 1** (commit "Phone: use the live web batch 1 (…)"; NOT device-tested — the
  release-type test build on the emulator doesn't carry this JS / Kotlin; next step = native rebuild + emulator test). Pure wire
  rules in `src/lib/alarms/doses.ts`. (1) Every `POST /api/meds/doses` (Today / medicine screens, alarm screen, offline queue)
  sends `acted_at` = the press and, for a snooze, `snooze_until` = press + 10 min, plus `snooze_minutes` = minutes left (≥ 5)
  for an older server. (2) 409 `dose_already_taken` = taken: Today/medicine card flips to "Taken" at once (no acted_at until the
  refetch) + calm toast "<name> — already marked as taken", alarm screen collapses it as taken; engine notes a taken log
  (`recent`), drops queued presses, withdraws the snooze re-ring (new adapter `withdraw(keys)`: iOS cancels, Android relies on
  the forced `scheduleAll`) and re-plans FORCED (an unchanged plan used to leave the re-ring on the phone); the queue drops a
  409 / pre-check-taken snooze the same way (`FlushResult.settled`); native presses / presses with filtered doses force too. (3) Alarm planning reads one `GET /api/meds/doses?from=&to=`
  (≤ 14 days; every day of the span cached, days between included); older server (400 / 404, or a 200 "due now" answer without
  from / to — an old server IGNORES the params) → per-day `/meds/today`, re-tried after 6 h. (4) `POST /api/devices` sends
  `alarms_local_until` with `alarms_local: true` = new plan field `doseCoveredUntil` (first MEDICINE alarm the cap left out; null
  when none — reminders cut by the iOS cap don't count, else Web Push would double-ring covered doses); persisted with the
  declaration (unknown → omitted). (5) Stale alarms: no ring past 60 min (web MISSED_AFTER_MIN; a snooze from its end) — Kotlin
  `RING_LATE_MS` 60 min in `fire()` (was 3 h; later → silent "Missed", ≤ 12 h), `scheduleAll` shows undelivered dose alarms
  3–12 h old as missed instead of dropping them; iOS foreground handler shows a > 60 min late alarm without sound and doesn't
  raise the screen; the alarm screen judges by ÖRZA's clock (`now` of its answer + skew — the live case was a phone clock off
  after days), and when every open dose is missed it silences the ring, says "Missed medicine(s)", no buzz, Take / Skip stay;
  dates on every non-today dose ("9:00 pm yesterday", "on Tue, 27 Oct"); offline alarm keeps a lapsed snooze "due" (web
  doseStatus). (6) Rebalance at the floor: `isAtFloor` / `isBelowFloor` / `trimTile` / `floorNote` in rebalance/types.ts (web
  RebalancePlanView wording), PRINCIPLES[0] updated. Tests: test:alarms 55/55 (new `alarm-doses.test.ts`, 21), new
  `npm run test:rebalance` 9/9, test:steps 241/241, typecheck + lint clean. Kotlin edits are uncompiled (Gradle = the check).
  Device checks for the next step: 409 on Today (snooze a dose taken on the web) → "Taken" at once + no re-ring 10 min later;
  queued offline snooze sent late → server snooze_until = press + 10; server devices doc shows alarms_local_until (null on
  Android); logcat `/meds/doses?from=` once per sync instead of per-day `/meds/today`; an alarm due > 60 min ago (Doze /
  `adb shell date` jump) → silent "Missed", alarm screen with the date; rebalance plan at the floor.
- 2026-11-01: **Steps v2 phase N (native Android) built** (commit "steps v2: native Android"; plan §10 N1–N5 ticked with
  deviations). `orza-steps`: Recording API (`StepRecording.kt`; `recordingStatus/Subscribe/Unsubscribe/Read/SubscribedAt`,
  `getStatus` + `recording`/`subscribedAt`), `HealthFeatures.kt` (`healthFeatures()`), `HealthPrivacyActivity` + manifest
  activity / `ViewPermissionUsageActivity` alias (RNHC config plugin removed), midnight sample inexact only, `shutdown`
  re-tag in `StepStore.add`; app.json P5 removals + `READ_HEALTH_DATA_IN_BACKGROUND`; Expo patch updates (expo 57.0.31,
  expo-router 57.0.29, …), expo-doctor 21/21. Build copy at the commit: prebuild + `assembleDebug` OK (the C++ "system_category"
  error came back 3× under memory pressure — what worked: `gradlew --stop`, `ninja -j3 -C android/app/.cxx/Debug/<hash>/x86_64`
  by hand, then Gradle again). Merged manifest as §4.2 (no new permission from play-services-fitness / connect-client).
  DEV build installed on the emulator (replaces the release-type test build). Emulator, offline: Health Connect's "Read
  privacy policy" for ÖRZA opens the new screen (first build crashed there — fixed), logcat clean.
  **NOT yet tested — Metro must be restarted first:** `npx expo install --fix` ran while Metro was serving, and Metro's file
  map lost the updated packages ("Unable to resolve expo-modules-core", bundle 500, safety gate NOT SAFE; touching the files
  doesn't help). After a Metro restart (`--clear`) + safety gate SAFE: the Kotlin functions from JS (Recording API status /
  subscribe / read, `healthFeatures`), app starts on Today, and the batch-1 device checks listed in the entry above.
  Lesson: stop Metro before `npm ci` / `expo install`.
- 2026-11-01 (evening): batch-1 phone adaptation DONE `62dcc92` (test:alarms 55/55, new test:rebalance 9/9); steps v2 Phase N DONE
  `c2c5ee9` (Recording API module, HealthFeatures, HealthPrivacyActivity for HC's privacy link, inexact midnight sample, app.json
  permissions, Expo patch updates; expo-doctor 21/21); DEV build of it installed on the emulator (18:16). Lessons: run
  `npx expo install --fix` only with Metro stopped (its file map broke → bundle 500 → gate NOT SAFE; fixed by restarting Metro with
  --clear); Gradle C++ "system_category" under low RAM → `gradlew --stop` + `ninja -j3` in android/app/.cxx/Debug/<hash>/x86_64, then
  Gradle again. Preview servers had been stopped (restarted); a stray agent dev server on 3102 (orza-backend, JSON DB, no env) killed.
  Reviews were cut off by a session limit; resumed with an added Device phase (run `wf_bb87f5d9-a6e`).
- 2026-11-01 (late): **Batch-1 phone + native review fixes** (`7907ff9`, `eeb57d2`; 6/6 findings real, all fixed). (1) Alarm
  screen judged "missed" only by the server, so the re-ring of a Snooze pressed on the notification with the app dead
  (the queue drops it once its 10 min are up) was silenced as "Missed medicine": alarm links now carry `fired` = the time
  the alarm rang for (Kotlin `AlarmNotifier.linkOf` on content + full-screen intents; in-app opens via `alarmOpenPath`,
  Android `onAlarmShown.at`, iOS `data.at`), and `isMissedOnAlarm` keeps that alarm's doses open until fired + 60 min on
  ÖRZA's clock (one medicine's alarm: that medicine only); the silence is decided once, when the screen opens (a later
  tick used to `silenceRinging()` whatever rang by then). Late snoozes are still dropped (sent late the server would
  start a 1-min snooze and the phone ring again). (2) Dose presses sent within `DELAYED_PRESS_MS` (30 s) carry no phone
  time (server clock decides acted_at / snooze length); queued presses keep acted_at + snooze_until. (3) Kotlin `fire()`:
  the 60-min cutoff is for dose (ring) items only; reminders / refill alerts show up to MAX_LATE_MS (3 h) again. (4–6)
  `StepRecording`: Play services is called only when `status()` is available (a disabled Play services posts Google's
  "enable" notification under ÖRZA's name — the 21.3.0 pre-check is only an APK-version compare); no permission →
  `NoPermission` + `subscribedAt` forgotten (also at module start and on permission failures); all calls on the sensor
  thread with a `generation` counter (a subscribe overtaken by an unsubscribe stores nothing, answers `Superseded`).
  Plan N1 note updated. Checks: typecheck ✓, lint ✓, test:alarms 65/65, test:steps 241/241.
  Rebuild at `7907ff9` in the build copy (prebuild cleared android/ → full build; C++ OOM again → `gradlew --stop` +
  `ninja -j3` for expo-modules-core, reanimated and app `.cxx`; `packageDebug` "Java heap space" → `--max-workers=1
  "-Dorg.gradle.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=512m"`, emulator stopped meanwhile); DEV build installed 22:23.
  Device (local server, gate SAFE before every start): alarm links with `fired` = now → "Time for your medicine", live;
  `fired` = dose time / other medicine → "Missed"; the reviewer's case for real — Amlodipine re-ring of a native Snooze
  pressed with the process killed (phone clock 55 min behind via `cmd alarm set-time` so the server says missed): server
  "missed", no snooze log, native action collected + dropped, yet the re-ring opens "Time for your medicine" and stays on
  `orza_alarms` INSISTENT; Take on a phone 55 min behind → acted_at = server time (17:24Z, phone 16:29Z); clock jumped +65
  min past a reminder + dose → reminder shown on `orza_reminders`, dose shown quietly as Missed; Recording API on the
  emulator (no step sensor → `no_sensor`): subscribe `{ok:false, error:"Unavailable no_sensor"}`, read null, unsubscribe
  false + `subscribedAt` cleared, planted `subscribedAt` forgotten at module start without Physical activity, kept with it.
  Not covered on device: the `generation` race and a disabled Play services (needs a phone with a step counter).
  Observations (not fixed): dev-client cold start from a full-screen alarm loses the `orza://alarm` link (the dev launcher
  reopens the project URL; release builds route it, D1); after the phone clock went BACK 55 min the alarm sync used
  stale meds / reminders (GET /api/meds, /api/reminders never reached the server; no HTTP cache on disk) — fine again
  once the clock was right, worth a look; Metro inspector websocket closes 1006 even with an allowed Origin (a temporary
  uncommitted route was used instead); the 2 GB emulator thrashes (kill-all helps). Local qa4 data: Glimepiride 21:00
  taken by a swipe the laggy emulator read as a tap; test medicine "Review Alarm Tab" (taken) and reminder "Review late
  reminder" deactivated; QA Wrapup Tab schedule restored; Amlodipine 22:00 left missed.
- 2026-11-02: **Device test of batch 1 + phase N** (DEV build 22:23, Metro after its `--clear` restart, gate SAFE before every
  start; local server only). Metro's inspector works over `127.0.0.1` with `origin: http://127.0.0.1:8081` (`localhost`
  closes 1006) and Hermes ignores `awaitPromise` — scratchpad `tools/cdp-eval3.mjs` stores the result on a global and polls.
  (A) From JS (`__r(<id>)` of `modules/orza-steps`, and the raw native module): `recordingStatus` "no_sensor", subscribe
  `{ok:false, subscribedAt:null, error:"Unavailable no_sensor"}`, `recordingSubscribedAt` null, read over the last hour
  null (native rejects "Unavailable no_sensor", the wrapper turns it into null), unsubscribe false, `healthFeatures`
  `{stepTracking:false, extension:17, backgroundRead:"available", backgroundGranted:false, stepsGranted:true}`, `getStatus`
  `{available:false, permission:false, recording:"no_sensor", subscribedAt:null, …}`; logcat clean. HC › App permissions ›
  ÖRZA › "Read privacy policy" online opens `ViewPermissionUsageActivity` → HealthPrivacyActivity on the LIVE
  `https://orza-nine.vercel.app/privacy#phone-app` (the page loads; `#phone-app` doesn't exist live until B6 is pushed), Back →
  HC. (B) all 8 pass: Take on Medicines → acted_at 0.9 s after the press (server clock, sent at once); Snooze on the alarm
  screen → snooze_until = acted_at + 10 min, the re-ring rang at +10; 409 on the Medicines card (Snooze) and on the alarm
  screen (Snooze after a Take via the API) → "Taken" + info toast "<name> — already marked as taken", no re-ring set
  (`dumpsys alarm`) and none rang; airplane mode, Snooze on the alarm screen (queued), 2 min 40 s later online → server
  acted_at = the queued press, snooze_until = +10 min, re-ring at that time; one `GET /api/meds/doses?from=2026-11-01&to=
  2026-11-09` per start sync (`from=to=` the dirty day after a dose event; the `/meds/today` GETs are the screens' 60 s
  refetch); devices row `alarms_local: true` without `alarms_local_until` = null (39 alarms, Android cap 200 cut none;
  stored declaration `alarmsLocalUntil: null`); stale alarm — phone clock 75 min back, a dose at 02:36 + one at 03:16
  planned, clock restored at 03:37 → 02:36 "fired 61 min late — shown as missed" on `orza_alarms_quiet` (subText Missed),
  03:16 (22 min late) rang INSISTENT on `orza_alarms` → "Time for your medicine"; the missed one opens "Missed medicine ·
  Was due at 2:36 am"; Amlodipine's link from yesterday → "Was due at 10:00 pm yesterday"; Rebalance past plans: 1690 /
  1693 → "None / Already at your safe minimum" + "Your usual 1,690 kcal already sits at your body's safe floor…", 1680 /
  1696 → "None / Already below your safe minimum" + "…already below the safe floor for your body (1,696 kcal)…".
  **Fixed (JS):** (1) the "stale data after the clock went back" seen on 1 Nov = OkHttp's disk HTTP cache (`cache/http-cache`):
  ÖRZA's JSON has no Cache-Control, and with the phone clock behind the time an answer arrived OkHttp counts its age as
  negative = fresh and answers GETs from disk without asking the server (alarms planned from a medicine list without the new
  medicine; Today from disk) — every native API request now sends `Cache-Control: no-store` (no health data stored there
  either); (2) negative ages counted as fresh in the alarm engine (day logs never re-read, no foreground sync, unchanged
  plan kept) and the device-registration throttle → `isOlderThan` (doses.ts, tests); (3) an alarm-screen press queued after
  a POST that failed late (up to the 20 s timeout) took the failure time as its press time → the press time. test:alarms
  69/69. Not fixed (native, needs a rebuild): the missed notification's title still says "💊 Time for <name>" (subText
  "Missed" only). QA medicines "QA Dev *" created for this run deleted.
- 2026-11-02: batch-1 phone + phase N review fixes (`7907ff9`, `eeb57d2`) and DEVICE checks all PASS (`19decea`: every request sends
  Cache-Control no-store — Android's HTTP cache served stale answers when the phone clock went back; clock-safe isOlderThan; queued
  press keeps the press time). Recording API on this AVD: "no_sensor" (expected); HealthFeatures extension 17; HC privacy link opens
  the new screen (loads the live /privacy#phone-app — section appears once B6 is pushed). Mobile repo pushed to origin (21 commits).
  Running: steps v2 Phase R + U (`wf_9fbaa2fe-3fe`) incl. the native missed-dose title (compiled in phase V's rebuild).
- 2026-11-02: User answers: Health Connect Toolbox download OK → downloaded `health_connect_toolbox.zip` (11.8 MB, www.gstatic.com,
  sha256 cb105834…a8d93f) to scratchpad `downloads\hc-toolbox\x\HealthConnectToolbox-2_3_5.apk` (package
  androidx.health.connect.client.devtool 2.3.5, Google's dev tool, debug-signed as shipped) — install on the EMULATOR only, in phase V1
  (E-3). Real Android phone: NOT available now → V2 (A-1…A-11) stays open; ask again before release. R1–R2 `c8b3d11`, R3–R4 `5b2f01e`
  done (test:steps 299/299); R5 onwards resumed (`wf_9fbaa2fe-3fe`).
- 2026-11-02: steps v2 **U3–U5** done (one commit "steps v2: UI"): Health screen "Count steps automatically" card (§6 subtitles,
  "both ways" line, off sheet; never agreed → switching on opens Today's own disclosure, also after "Not now"), ConnectCard with
  the 4 P5 types and Disconnect = revoke, Settings › Privacy & data switch row + the web branch's privacy wording (footer,
  data, memory, AI toggle), U5 Health Connect origin labels + the time-zone hint on Today. Today's disclosure flow now lives in
  `features/today/StepsDisclosure.tsx`. test:steps 388, test:alarms 69. Next: phase V (device checks; nothing native changed).
- 2026-11-02: **Alarms: missed-dose notification title** (Kotlin only, compiled in phase V's rebuild): a dose alarm shown as
  missed now reads "Missed: <name>" / "Missed: N medicines" + "Was due at 2:36 am on Mon, 2 Nov" (phone's zone, the doses'
  scheduled time), dose lines in the expanded text, no "Missed" subText; the showing record keeps `missed` so a partial
  refresh stays missed. Check on the V1 rebuild (stale-alarm run). Plan note: steps-v2.md §10 AT.
- 2026-11-02: Steps v2 R1–R6 + U1–U5 + missed-dose title BUILT (`c8b3d11` … `840b503`, test:steps 315+). Reviews (wiring /
  consent-UX / iOS) + fix resumed (`wf_9fbaa2fe-3fe`). INTERIM (R5): `SEND_APPLE_HEALTH_STEPS = false` — an iPhone does not send
  Apple-Health-derived step counts to the server, because the server puts tracked steps into the AI coach prompt (App Store 5.1.2(i)
  / 5.1.3 need explicit permission before health data goes to a third-party AI). BLOCKER for the iOS release (D3): build the
  app-wide AI data consent (web + phone: explain the AI provider, explicit opt-in, AI features off without it), then flip the flag.
  Ask the user (product decision) before building it. iOS background modes come out as fetch + processing (check in D3).
  (Widened by the R/U review fixes below: the flag is now `health/types.SEND_IPHONE_HEALTH_DATA` and also holds iPhone
  motion (Motion & Fitness) counts and HealthKit weight.)
- 2026-11-02: steps v2 **R/U review fixes** (9 findings, all real; plan §10 "RU"; test:steps 417, test:alarms 69; no app.json
  change). (1) A past day's reconcile only by a count that stands for this phone's own save (`DayRecord.autoBy`; Android
  `DayReading.phonePartial` when the phone counter is ON but blind for the day) — Health Connect without the phone's steps
  never lowers the phone counter's save (switch off/on after midnight, Play services gone, > 10 days), nor the phone's count a
  withdrawn store's. (2) A coverage restart on a day with a base re-bases at the restart (`merge.restartBase`): an edit's
  counted-since steps no longer drop out. (3) A waiting save job never combines across a profile-zone / day change (M8).
  (4) M9 after a sign-out: no member reads from before another member last signed out on this phone (A → B → A). (5)+(7) The
  iPhone holds Apple Health AND motion counts (5.1.3(i)) — it sends no automatic steps until the AI consent ships.
  (6) Android's steps disclosure + Health screen connect caption name the AI provider ("When you use an AI feature, like the
  coach, your step totals go with your request to our AI provider."); §9 Data safety corrected (B5 was skipped) — USER REVIEWS
  THE COPY. (8) HealthKit weight reached the AI through the coach's `goalReply` (chat history): the iPhone import leaves weight
  out while held (web follow-up: `goalReply` from `profile.weight_kg`). (9) A failed / `unknown` HealthKit StepCount status
  check no longer clears Apple Health background delivery (store stays ON, its days unread).
- 2026-11-02: R/U review fixes DONE (`29027cc`, 9/9 real; test:steps 417): reconcile only against the source that saved, restart base,
  save-job merge per tz/day, shared-phone floor from other members' sign-out times, iPhone sends NO automatic steps/weight until the AI
  consent ships (`SEND_IPHONE_HEALTH_DATA`), Android disclosures say step totals go to the AI provider with AI requests, failed
  HealthKit checks keep the earlier answer. Running: V1 emulator checks (`wf_1ed3af09-ae8`; rebuild, Toolbox, §8.1 E-1…E-9, UI pass).
- 2026-11-10 (after the weekly limit; PC rebooted): V1 so far — rebuild, missed-dose title, Toolbox install, E-1, E-2 PASS
  (`docs/notes/steps-v2-V1.md`); E-3…E-9 + UI pass were BLOCKED twice because Metro's transform workers died under the PC's low RAM
  (~850 MB available with the Claude desktop app using ~1.9 GB). Resumed (`wf_1ed3af09-ae8`) on a RELEASE-TYPE TEST BUILD (JS embedded,
  no Metro; local-only network config + bogus vercel.app pin, as D1 W11). Windows wiped the session scratchpad (tools, Toolbox zip,
  DB backups) — durable helpers now live in `scripts/e2e/` (`api.mjs`, `typepw.mjs`); the Toolbox stays installed on the emulator.
- 2026-11-10: V1 run 3 on the RELEASE-TYPE TEST BUILD of `14fe8c1` (local-only network config + bogus vercel.app pin; `scripts/e2e/check-release-apk.sh` → SAFE; new qa4 session in the local DB): **E-3 PASS** (past days = Health Connect totals, first-grant day partial / whole by S-H2, edit → "Edited by you", steps after the edit add on, a record dated before it does not) and **E-4 PASS** (a website edit lower shows on the phone at its next foreground and automatic saves never undo it; a past day reconciles down to Health Connect after Toolbox deletions, but not one edited on the website). No app bug; one ANR on the swapping 2 GB AVD (environment, as D1 N8). Details + state for E-5…: `docs/notes/steps-v2-V1.md` run 3.
- 2026-11-10: V1 run 4 (cut off by a usage limit after E-7): **E-5 PASS** (member switch: B gets no past days and nothing from before
  its consent, no reads before consent, A → B → A floor at the last sign-out; sign-out cancels all native alarms in a release build),
  **E-6 PASS** (switch off: no reads, no saves; back on counts once), **E-7 PASS with a library BUG**: `expo-background-task` 57.0.21
  cancels its own running worker when a cold process restores the task (`getWorkerInfo` took the APPEND chain's finished WorkInfo →
  REPLACE) → cold background runs read Health Connect but were frozen before saving. Fixed with `patch-package`
  (`patches/expo-background-task+57.0.21.patch`, `13d9025`, same as upstream 58.0.12; drop it on the SDK 58 upgrade). Resumed
  (`wf_1ed3af09-ae8`): rebuild with the patch + E-7 cold retest, E-6b Disconnect, E-8, E-9, then the UI / accessibility pass.
- 2026-11-10: USER APPROVED the B6 privacy copy (the `#phone-app` section + edits on `steps-v2-backend`) and OK'd pushing
  `steps-v2-backend` to the live web repo ONCE THE V1 PHONE TESTS PASS (V4: fast-forward main, Vercel deploy check, confirm
  `applied` modes in production, check the live /privacy#phone-app in the app's privacy screen, delete the legacy save branch).
- 2026-11-10: V1 run 5 (release-type test build, local-only safeguards, `check-release-apk.sh` SAFE): the `13d9025` patch was
  a NO-OP on Android — SDK 57 links `expo-background-task`'s prebuilt AAR, so the patched Kotlin was never compiled. Fixed in
  `c81bc0e` (`package.json` `expo.autolinking.android.buildFromSource: ["expo-background-task"]`, `patches/README.md`; drop
  both on SDK 58). Rebuilt (the module now compiles from source; the APK's dex has the patched `getWorkerInfo`): **E-7 retest
  PASS** (two cold background runs in a row read Health Connect and saved — "Worker is already scheduled, skipping
  cancel-and-replace", no "was cancelled"), **E-6b Disconnect PASS** (Health Connect: ÖRZA "Not allowed access" once the
  process ends; no reads after), **E-9 PASS** ("Log steps" when undetermined; "Not now" survives a force-stop), **E-8 PASS**
  (connect sheet = Steps, Sleep, Resting heart rate, Weight only; charts from `tracking.steps`). Details + state:
  `docs/notes/steps-v2-V1.md` run 5. Left in V1: the UI / accessibility pass.
- 2026-11-10: V1 run 6 — UI / accessibility pass on the new steps screens (Today card in every reachable state, the
  disclosure / Turn on / off sheets, Health screen switch card + connect caption, Settings switch) at the default size and
  on a 360 dp phone with font 1.3, TalkBack labels via `scripts/e2e/a11y.mjs`. Fixed: the native switch was 46 x 27 dp →
  48 dp target (`06fbf69`); "Keep coun…" / "Manage …" cut at large text → wrap (`06fbf69`); "Connect Health Conn…" →
  "Connect" when tight (`22ac1c5`); LIVE pill one TalkBack stop. Rebuilt twice (release-type test build, SAFE each time),
  all re-checked on the device. Shots in `docs/notes/steps-v2-V1-shots/`; details `docs/notes/steps-v2-V1.md` run 6.
  Follow-up (app-wide, not done): other native switches are 46 x 27 dp; sheet close / header icon buttons are 44 dp.
- 2026-11-10: **V1 DONE** (`41d8dca`, runs 5–6): E-7 cold background runs now save (the patch needed
  `expo.autolinking.android.buildFromSource` — SDK 57 links prebuilt AARs, `patches/README.md`), E-6b Disconnect, E-8 connect
  sheet + charts, E-9 Not now / Log steps PASS; UI + accessibility pass (default + 720×1280 @320 + font 1.3) fixed the 48 dp
  steps switch, large-text wraps and the LIVE TalkBack stop; screenshots in `docs/notes/steps-v2-V1-shots/`. Mobile pushed
  (`4109f10`). **V4 started:** web `steps-v2-backend` fast-forwarded onto main and pushed (`a3e3c0e`, user OK'd).
  Still open: J6 legacy-save cleanup (keep until a production answer shows `applied` — our own test data may not go to
  production, so check with the user's real use or skip; the branch is harmless), app-wide 48 dp switches / 44 dp icon buttons,
  "Not on yet" copy after a Health Disconnect, change the local qa4 test password (it reached an agent log once; local only).
- 2026-11-10: web steps v2 LIVE — main `a3e3c0e`, Vercel "Deployment has completed"; live /privacy shows the `#phone-app`
  section and the new lead; unauthenticated `/api/track/steps` → 401 as before. V4 left: `applied` seen in a real production
  answer → J6 legacy-save cleanup; the live privacy page in the app's privacy screen on the real phone (V2).
- 2026-11-10: USER DECISION (D3, Apple 5.1.2(i)): app-wide AI consent is asked AT FIRST AI USE — a one-time sheet naming
  OpenAI and what is sent, Allow / Not now; AI features wait until allowed, the rest of the app works without it. Then the
  iPhone may send automatic steps/weight (`SEND_IPHONE_HEALTH_DATA`). Plan + build: `docs/notes/ai-consent.md`.
