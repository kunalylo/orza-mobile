# B1a — Meals tab + voice input (notes / resume file)

Owner files: `src/lib/voice.ts`, `src/app/(app)/(tabs)/meals.tsx`, `src/app/(app)/meal/**`, `src/features/meals/**`.

## Endpoints (web repo `E:\aylo\orza\src\app\api\...`, paths relative to `/api`)
- `GET /meals?date=YYYY-MM-DD` → `{date, meals: Meal[], totals: Nutrients}` (date defaults to user's today; future → 400).
- `POST /meals/text {text (2..500, trimmed), date?, meal_type?: breakfast|lunch|dinner|snack|null, source?: "text"|"voice"}`
  → `{meal, ai: boolean, unmatched: string[], credits?: number, notice?: string}`.
  Errors: 422 `no_items` ("Couldn't recognise any foods — try e.g. '2 roti and 1 katori dal'." + maybe credit note → refresh user),
  400 field=`text` validation, 402 `no_credits` / 503 `ai_disabled` / 429 `rate_limited` (server mostly falls back to the free parser with a `notice`,
  but handle them anyway). `credits` present → setUser({...user, credits}).
- `POST /meals/manual {date?, meal_type?, food_key, quantity (0<q≤20, ≤ maxServingsFor), restaurant?: boolean}` or `{date?, meal_type?, items: MealItem[] (1..20)}` → `{meal}`.
  404 food not found; 400 too many servings.
- `PATCH /meals/[id] {meal_type?, items?}` → `{meal}` (totals recomputed server-side); 404.
- `DELETE /meals/[id]` → `{ok: true}`; 404.
- `GET /foods/search?q=` (1..60 chars) → `{foods: [{key, name, serving:{unit, grams, label}, per_serving: Nutrients, diet: veg|vegan|egg|nonveg, category, restaurant_multiplier?}]}` (top 10).
- `GET /credits/balance` → `{credits, costs: {meal_text: 1, scan: 2, …}, ai_enabled, spent_30d}` (cost hint under the composer).
- Item limits (ITEM_LIMITS): quantity ≤ 100, grams ≤ 5000, kcal ≤ 5000, protein ≤ 500, carbs ≤ 1000, fat ≤ 500, fibre ≤ 200; MAX_SERVINGS 20;
  `maxServingsFor(food, restaurant)` mirrored client-side for the stepper cap; restaurant estimate: extra = kcal×(m−1) added to kcal, extra/9 to fat.

## Library APIs
- expo-speech-recognition 57.1.1: native module loaded with `requireOptionalNativeModule('ExpoSpeechRecognition')` from `expo`
  (the package's JS entry throws at import when the native module is missing — e.g. Expo Go — so we never import its runtime, only types).
  Methods: `start({lang, interimResults, continuous:false, maxAlternatives, contextualStrings})`, `stop()`, `abort()`, `getPermissionsAsync()`,
  `requestPermissionsAsync()` (→ `{granted, canAskAgain, status, restricted?}`), `isRecognitionAvailable()` (Android: a RecognitionService exists),
  `addListener(event, fn)` → `{remove()}`. Events: start, end (always last), result `{isFinal, results:[{transcript}]}`, nomatch, error `{error, message}`.
  Error codes: aborted, audio-capture, interrupted, language-not-supported, network, no-speech, not-allowed, service-not-allowed, busy, client, speech-timeout, unknown.
- react-native-gesture-handler `ReanimatedSwipeable` (swipe-to-delete), Reanimated entering/layout animations, `useReducedMotion`.
- `Linking.openSettings()` for blocked mic permission.

## Decisions
- voice.ts: one session app-wide (module-level owner token). Starting while another hook owns a session aborts it, waits for its `end` (≤1.2 s), then starts.
  Final text delivered on `end` (final result, or the last partial when the platform ended without a final and the user didn't cancel).
  iOS `available` = native module present (SFSpeechRecognizer availability flips offline → we show a network error instead of hiding the mic);
  Android `available` = `isRecognitionAvailable()` (re-checked when the app returns to the foreground). Permission re-checked on foreground to clear `blocked`.
- Meals data: React Query keys `['meals','day',date]`, `['meals','ai-status']`, `['meals','foods',q]`; mutations upsert/remove in the cache, then invalidate the day + any query whose key starts with today|dashboard|summary|reports|insights.
- Date: user's timezone (profile.timezone, default Asia/Kolkata) via Intl; date navigator never goes past today; calendar sheet (own month grid).
- Route params on the Meals tab: `compose=1` focuses the composer, `voice=1` starts listening (if available), `date=YYYY-MM-DD`, `meal_type=`; params are consumed
  once (router.setParams to clear) so revisiting the tab doesn't refocus.
- Edit screen `/meal/[id]?date=` reads the meal from the `['meals', date]` cache (fetches the day if missing).

## Checklist
- [x] src/lib/voice.ts
- [x] src/features/meals/types.ts
- [x] src/features/meals/utils.ts (labels, dates, fmtQty, nutrient maths, quick picks)
- [x] src/features/meals/api.ts (queries + mutations)
- [x] src/features/meals/DateNavigator.tsx (+ calendar sheet)
- [x] src/features/meals/MealComposer.tsx
- [x] src/features/meals/LoggedResult.tsx (+ MealItemRow.tsx)
- [x] src/features/meals/DailySummary.tsx
- [x] src/features/meals/MealGroups.tsx (cards, swipe-to-delete, delete button)
- [x] src/features/meals/ItemEditor.tsx (+ Stepper.tsx) (draft rows for edit + custom items)
- [x] src/features/meals/FoodPickerSheet.tsx
- [x] src/app/(app)/(tabs)/meals.tsx
- [x] src/app/(app)/meal/[id].tsx
- [x] npm run routes, typecheck, lint (all clean 2026-10-14)

## Status
All items built; `npm run routes`, `npx tsc --noEmit` and `npx expo lint` clean. No dev server / device run (not allowed in this step) —
needs on-device QA: mic permission flow (deny → blocked → Settings), Hindi recognition, swipe-to-delete inside the ScrollView,
compose=1 / voice=1 params from Today, edit screen discard-changes prompt.
