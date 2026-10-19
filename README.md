# ÖRZA — iOS & Android app

React Native app for [ÖRZA](https://orza-nine.vercel.app), built with Expo SDK 57 (RN 0.86, Expo Router, TypeScript strict,
New Architecture, React Compiler). It talks to the same JSON API as the website (`E:\aylo\orza`, contract in its `SPEC.md`)
using a Bearer session token. Build plan and status: [`docs/PROGRESS.md`](docs/PROGRESS.md). Agent rules: [`AGENTS.md`](AGENTS.md).

## Run

```bash
npm install
npx expo start              # dev server (the app needs a development build: eas build --profile development)
npx tsc --noEmit            # typecheck
npx expo lint               # lint
npx expo-doctor             # dependency / config checks
npx expo export --platform android   # prove the JS bundle builds
npm run test:alarms         # alarm planner + schedule tests (Node, no device)
npm run icons               # regenerate icon / splash PNGs (scripts/generate-icons.mjs)
```

`EXPO_PUBLIC_API_URL` (see `.env.example`) points the app at an API origin. Release builds default to
`https://orza-nine.vercel.app` (eas.json also sets it per profile). **Development builds never fall back to the live
site**: without a valid URL they show a blocking "API URL not configured" screen. Emulator testing against the local
web test server (`E:\aylo\orza-localtest`, port 3100): create `.env.local` with `EXPO_PUBLIC_API_URL=http://10.0.2.2:3100`
(Android emulator; iOS simulator: `http://localhost:3100`), start Metro with `npx expo start --dev-client --clear`, and
check the bundle carries the local origin before signing in. Android dev builds set `expo-build-properties`
`android.networkInspector: false` (the dev-client network inspector corrupted Metro's chunked bundle → blank screen).

EAS: project `@kunal_ylo/orza`. Profiles in `eas.json`: `development` (dev client, internal APK), `development-simulator`,
`preview` (internal APK), `production` (store; AAB on Android). `npx eas-cli@latest build --profile <name> --platform android|ios`.

## Layout

```
index.ts                    app entry: defines the alarm background task, then `expo-router/entry` (keep that last)
modules/orza-alarms/        local Expo module (Android): exact alarms, full-screen alarm with photos, Take / Snooze /
                            Skip receivers, boot re-schedule — no-op on iOS / web / Expo Go
src/
  app/                      Expo Router routes (screens only)
    _layout.tsx             fonts + splash, providers, route guards (Stack.Protected)
    (auth)/                 welcome (dark hero + orb), sign-in, sign-up
    onboarding.tsx          chat-style onboarding (GET /api/onboarding, POST /api/onboarding/step)
    admin.tsx               staff accounts → "use the web console"
    (app)/(tabs)/           Today · Meals · Snap (raised centre) · Medicines · More
    (app)/*.tsx             feature screens (ask, goals, recipes, rebalance, reports, health, calendar,
                            reminders, credits, settings) + alarm (full-screen modal)
    (app)/meal|med|rx|recipe|account/   pushed detail screens (med/edit is a full-screen modal)
  components/               app-specific pieces (TabBar, onboarding/*, auth/*)
  features/<area>/          per-feature API hooks, types, helpers and components (meals, snap, today, meds, rx,
                            alarm (screen), alarms ("Alarms on this phone" card + first-run prompt), chat, recipes,
                            rebalance, goals, reports, credits, settings, more, health, calendar, reminders)
  ui/                       design-system kit — import from "@/ui"
  theme/                    tokens: colours, gradients, spacing, radii, typography, shadows, motion
  lib/                      api client, auth (+ React Query), secure storage, device registration, haptics, fonts,
                            image (photos), voice (speech), health (HealthKit / Health Connect bridge + sync),
                            notifications (foreground handler + taps), alarms (on-phone alarm engine: planner, photo
                            cache, action queue, sync, platform adapters, background task, test alarm)
```

### Conventions
- **API**: `api.get/post/patch/put/del` from `@/lib/api` (JSON, Bearer token, timeouts, `ApiError {status, code, field}`,
  friendly offline/timeout messages; an authenticated 401 signs out, except `code: "wrong_password"`). Photos:
  `mediaSource(url)` for `expo-image`. Errors on screen: `errorMessage(e)`; a 400 that belongs next to a form field:
  `validationField(e)` → `{field, path, message}` (parses the server's `"<path>: <message>"` zod errors).
- **Sheets**: `Sheet` from `@/ui`; `dismissible={false}` blocks closing (while saving), and `onBlockedDismiss` lets a
  form with unsaved changes ask "Discard changes?" from the backdrop, close button and Android back.
- **Data**: React Query (`useQuery` / `useMutation`) — the client is provided by `AuthProvider`.
- **User**: `useAuth()` (`signIn/signUp/signOut/refresh/setUser`), `useSignedInUser()` inside member screens.
- **UI**: `Screen` (safe area, cream canvas / `orb` / `hero` backdrop, keyboard, `tabBar` spacing), `ScreenHeader`, `Text`
  variants, `GlassCard`, `Button` (primary / energy / secondary / ghost / hero), `IconButton`, `Chip`, `Tag`, `TextField`,
  `Segmented`, `EnergyRing`, `Orb`, `ProgressBar`, `Skeleton`, `EmptyState`, `SectionHeader`, `toast.success/error/info`.
- **Icons**: `Icon name="camera"` (Feather) or `"mci:pill"` (MaterialCommunityIcons).
- **Motion**: Reanimated shared values use `.get()` / `.set()` (React Compiler safe); respect `useReducedMotion()`.
- **Haptics**: `haptics.tap/soft/firm/select/success/warning/error` from `@/lib/haptics`.
- **Photos**: `pickPhotos(source)` + `toUploadDataUrl(uri, {maxSide, quality, maxBytes})` from `@/lib/image` (JSON data
  URLs; the server rejects multipart; default cap 1.4 MB, meal scans pass 2.5 MB).
- **Voice**: `useVoiceInput({ onFinal })` from `@/lib/voice` (en-IN / hi-IN, live partial transcript, `available` false → hide the mic);
  `loadVoiceLang()` / `saveVoiceLang()` share the member's last voice language between composers.
- **Meal changes**: `invalidateDaySummaries(qc, date)` / `upsertMealInCache` from `@/features/meals/api` (refreshes the day's
  log plus every query rooted at `today` / `dashboard` / `summary` / `reports` / `insights`).
- **Dose events**: `emitDoseEvent` / `onDoseEvent` from `@/features/meds/events` after any dose or medicine change.
- **Alarms**: the phone schedules every medicine alarm and reminder itself (`@/lib/alarms`, mounted by `useAlarmSync()` in
  `(app)/_layout`). Call `emitAlarmDataChanged()` from `@/lib/alarms/events` after reminder / quiet-hours / preference /
  notification-permission changes; dose and medicine changes already flow through `emitDoseEvent`. A screen that
  records a dose press itself calls `alarmSnoozePressed(doses, until)` BEFORE the snooze request (the phone re-rings
  even if the app is suspended) and `alarmDoseSaved(log, pressedAt)` with the `POST /meds/doses` answer (from
  `@/lib/alarms/bridge`). Screens read
  `useAlarmSyncState()` (scheduled, `next`, `quietDoses`, `offline`) or `usePhoneAlarmStatus()` from
  `@/features/alarms/status` (permissions + fixes); `promptAlarmPermission(reason)` asks for missing permissions after a
  medicine / prescription adds alarms. Android-only native calls (`silenceRinging`, `releaseLockScreen`, `requestUnlock`,
  `scheduleOne`, `openBatterySettings`) come from `modules/orza-alarms` and are no-ops elsewhere. `npm run test:alarms`
  after planner changes.
- **Route types**: after adding/removing a route file run `npm run routes` (regenerates `.expo/types/router.d.ts` without a
  dev server); `npm run typecheck` does that and then `tsc --noEmit`.
- Never edit `android/` or `ios/` — configure native behaviour in `app.json` / config plugins.
