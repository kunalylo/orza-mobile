# B1b — Snap & Know + Today (notes / resume file)

Owner files: `src/app/(app)/(tabs)/snap.tsx`, `src/app/(app)/(tabs)/index.tsx`, `src/features/snap/**`, `src/features/today/**`.
Imports (read-only): `src/features/meals/**` (ItemEditor drafts, DateNavigator, utils, mealKeys/upsertMealInCache),
`src/features/meds/**` (useTodayDoses, useDoseActions, MedPhoto, shared helpers, events).

## Endpoints (web repo `E:\aylo\orza\src\app\api\...`, paths relative to `/api`)
- `POST /meals/scan {image: "data:image/(jpeg|png|webp);base64,…" (200..8.5M chars ≈ 6 MB), note?: string ≤200}` → `{scan: Scan, credits: number}`.
  Scan = `{id, user_id, items: MealItem[], totals, dish_name, notes?, confidence 0..1, confirmed, meal_id?, created_at}`.
  Errors: 503 `ai_disabled`, 402 `no_credits`, 429 `rate_limited`, 422 `no_food` (message incl. credit refund note → refresh user),
  400 validation with field `image` / `note`. Costs 2 credits (refunded on AI failure). Can take 5–20 s → 90 s timeout.
- `POST /meals/scan/[id]/confirm {meal_type?: MealType|null, date?: YYYY-MM-DD, items?: MealItem[] (1..20)}` → `{meal: Meal}` (source "photo").
  Errors: 404 (scan gone → "scan the photo again"), 409 `already_confirmed`, 400 `bad_request` (no items) / validation.
- `GET /dashboard/today?date=` → `{date, today, targets: Targets, totals: Nutrients, meals: Meal[], tracking: TrackingDay,
  remaining: {calories, protein_g}, streak: number, insight: string, goal: Goal|null, week: {date, calories, meals}[7],
  last_weight: {weight_kg, date}|null}`. Future date → clamped to today; bad date → 400.
- `POST /track/water {glasses 0..40, date?}` → `{tracking}` (absolute count, not a delta).
- `POST /track/steps {steps 0..100000, date?}` → `{tracking}`.
- `POST /track/weight {weight_kg 20..400 (1 dp), date?}` → `{tracking, user?: PublicUser}` (user when profile weight changed → setUser).
  Track errors: 400 "date…"/"You can't log for a day that hasn't happened yet"/field validation.
- `GET /meds/today?date=` → `{date, now, doses: DoseItem[]}` — via `useTodayDoses(date)` from `@/features/meds/api` (key `['meds','today',date]`).

## Library APIs
- `pickPhotos('camera'|'library')` → `PickedPhoto[]` ([] = cancel), throws `PhotoPermissionError {status:'denied'|'blocked', source}`;
  `toUploadDataUrl(uri, {maxSide: 1600, quality: 0.82})` → `{dataUrl, bytes}` (helper caps at 1.4 MB — well under the scan's 6 MB; throws `PhotoError`).
- `Linking.openSettings()` (react-native) for blocked camera/photos.
- Reanimated: `useSharedValue/withRepeat/withTiming/withSequence`, entering `FadeInDown.springify()`, `LinearTransition`, `useReducedMotion`.
- `expo-image` `Image` for the picked photo; `react-native-svg` for the plate illustration + brackets; `expo-linear-gradient`.
- React Query: `useQuery({placeholderData: keepPreviousData})` for date browsing; `qc.setQueryData` to merge tracking; `cancelQueries`.

## Decisions
- Today query key `['dashboard','today',date]` — meals mutations already invalidate keys starting with `dashboard`/`today`.
- Water: optimistic `pending` state; one request in flight, taps meanwhile collapse into one follow-up write of the latest value;
  confirmed value merged into the cache when the chain ends; failure → revert to last confirmed + toast + refetch.
  Each commit cancels an in-flight dashboard fetch; a soft refetch (insight/streak) runs 900 ms after a tracking write.
- Steps + weight: tap the tile → Sheet with a numeric field (keyboard-safe), Save → merge tracking (+ setUser for weight).
  Weight uses `preferences.units` (imperial → lb, converted like the web).
- Medicines card only on today's view (doses are always the real today); quick "Take" via `useDoseActions`; rows → Medicines tab;
  `onDoseEvent` → invalidate `['meds','today']`.
- Snap: phases idle → ready (photo prepared) → scanning → result → logged; problem panels (ai_disabled / no_credits / error / permission).
  Route params `date` + `meal_type` (from Meals / Today) applied once then cleared. Logged → "View meal log" → Meals tab (with date if not today).
  Confirm success upserts the meal into `mealKeys.day(date)` and invalidates day summaries.
- No new routes (no `npm run routes` needed).

## Checklist
- [x] src/features/snap/types.ts
- [x] src/features/snap/utils.ts (confidence tone, estimate range, steps, tips)
- [x] src/features/snap/api.ts (useScanMeal, useConfirmScan, scanProblem)
- [x] src/features/snap/Viewfinder.tsx (brackets, plate art, scan line, step caption, result chips)
- [x] src/features/snap/Panels.tsx (tips, ai-off, no-credits, error, permission, analysing, logged)
- [x] src/features/snap/ScanReview.tsx (dish, confidence, totals, range, ItemEditor, meal type, log)
- [x] src/app/(app)/(tabs)/snap.tsx
- [x] src/features/today/types.ts
- [x] src/features/today/format.ts
- [x] src/features/today/api.ts (useTodayDashboard, mergeTracking, useWaterWriter, useLogSteps, useLogWeight)
- [x] src/features/today/TodayHeader.tsx (+ WeekStrip)
- [x] src/features/today/EnergyCard.tsx
- [x] src/features/today/InsightCard.tsx
- [x] src/features/today/QuickActions.tsx
- [x] src/features/today/WaterCard.tsx (+ TrackerHead.tsx)
- [x] src/features/today/BodyCards.tsx (steps + weight tiles + sheets)
- [x] src/features/today/MealsSection.tsx
- [x] src/features/today/MedsCard.tsx
- [x] src/features/today/TodaySkeleton.tsx
- [x] src/app/(app)/(tabs)/index.tsx
- [x] typecheck + lint clean

## Status
All items built; `npm run typecheck` and `npx expo lint` clean for these files. No dev server / device run (not allowed in this step).
Needs on-device QA: camera / photo permission flows (deny → blocked → Settings), scan line + glass pop animations
(and Reduce Motion), Steps / Weight sheets with the keyboard on 360x640, Android back while reviewing a scan (discard prompt),
water taps under a slow network (one write in flight, latest wins).
