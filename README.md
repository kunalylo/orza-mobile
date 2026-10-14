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
npm run icons               # regenerate icon / splash PNGs (scripts/generate-icons.mjs)
```

`EXPO_PUBLIC_API_URL` (see `.env.example`) points the app at an API origin; default `https://orza-nine.vercel.app`.

EAS: project `@kunal_ylo/orza`. Profiles in `eas.json`: `development` (dev client, internal APK), `development-simulator`,
`preview` (internal APK), `production` (store; AAB on Android). `npx eas-cli@latest build --profile <name> --platform android|ios`.

## Layout

```
src/
  app/                      Expo Router routes (screens only)
    _layout.tsx             fonts + splash, providers, route guards (Stack.Protected)
    (auth)/                 welcome (dark hero + orb), sign-in, sign-up
    onboarding.tsx          chat-style onboarding (GET /api/onboarding, POST /api/onboarding/step)
    admin.tsx               staff accounts → "use the web console"
    (app)/(tabs)/           Today · Meals · Snap (raised centre) · Medicines · More
    (app)/*.tsx             feature screens (ask, goals, recipes, rebalance, reports, health, calendar,
                            reminders, credits, settings) + alarm (full-screen modal)
  components/               app-specific pieces (TabBar, FeaturePlaceholder, onboarding/*, auth/*)
  ui/                       design-system kit — import from "@/ui"
  theme/                    tokens: colours, gradients, spacing, radii, typography, shadows, motion
  lib/                      api client, auth (+ React Query), secure storage, device registration, haptics, fonts
```

### Conventions
- **API**: `api.get/post/patch/put/del` from `@/lib/api` (JSON, Bearer token, timeouts, `ApiError {status, code, field}`,
  friendly offline/timeout messages; an authenticated 401 signs out). Photos: `mediaSource(url)` for `expo-image`.
- **Data**: React Query (`useQuery` / `useMutation`) — the client is provided by `AuthProvider`.
- **User**: `useAuth()` (`signIn/signUp/signOut/refresh/setUser`), `useSignedInUser()` inside member screens.
- **UI**: `Screen` (safe area, cream canvas / `orb` / `hero` backdrop, keyboard, `tabBar` spacing), `ScreenHeader`, `Text`
  variants, `GlassCard`, `Button` (primary / energy / secondary / ghost / hero), `IconButton`, `Chip`, `Tag`, `TextField`,
  `Segmented`, `EnergyRing`, `Orb`, `ProgressBar`, `Skeleton`, `EmptyState`, `SectionHeader`, `toast.success/error/info`.
- **Icons**: `Icon name="camera"` (Feather) or `"mci:pill"` (MaterialCommunityIcons).
- **Motion**: Reanimated shared values use `.get()` / `.set()` (React Compiler safe); respect `useReducedMotion()`.
- **Haptics**: `haptics.tap/soft/firm/select/success/warning/error` from `@/lib/haptics`.
- Never edit `android/` or `ios/` — configure native behaviour in `app.json` / config plugins.
