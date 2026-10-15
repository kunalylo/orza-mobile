# B3b — Goals, Reports, Credits (working notes)

Ownership: `src/app/(app)/goals.tsx`, `reports.tsx`, `credits.tsx`, `src/features/goals/**`, `src/features/reports/**`,
`src/features/credits/**`. No new routes (the three screens already exist as placeholders) → no `npm run routes` needed.

## Endpoints (web repo is the contract)

### Goals
- `GET /api/goals/active` → `{goal: Goal|null, weights: [{date, weight_kg}] (asc, last 120 days), targets, profile, today}`.
- `POST /api/goals/calculate` body `{goal: 'lose'|'maintain'|'gain', current_weight_kg (25–350), target_weight_kg? (25–350; required
  unless maintain), weekly_rate_kg? (-1..0.5, signed), height_cm? (100–250), age? (int 13–100), sex?, activity_level?}`
  → `{goal, user: PublicUser, notice?}`. Errors: 400 `bad_request` (friendly message from goalInputError / planGoal blocker /
  "Add your height and age…"), 400 `validation` with message `"<field>: <msg>"` (no `field` prop — parse the prefix).
- `POST /api/track/weight {weight_kg (20–400, 1dp), date?}` → `{tracking: TrackingDay, user?: PublicUser}` (user only when the
  profile weight changed). 400 validation `"weight_kg: must be between 20 and 400"`.
- Goal = `{id, user_id, active, goal, current_weight_kg, target_weight_kg, weekly_rate_kg (signed), target_date?, bmr, tdee, targets, created_at}`.
- Maths: port of `src/components/goals/goal-math.ts` + `computeTargets` (`src/lib/domain/targets.ts`) — identical numbers.

### Reports
- `GET /api/reports/daily?date=YYYY-MM-DD` → `{date, is_today, totals, targets, meals: Meal[], tracking: {water_glasses, steps, weight_kg?},
  score, score_parts: [{key, label, points, max, value, target, unit}], highlights[], suggestions[]}`. 400 on bad date.
- `GET /api/reports/weekly?end=YYYY-MM-DD` → `{start, end, days: [{date, calories, protein_g, carbs_g, fat_g, fiber_g, water_glasses, steps,
  weight_kg?, meals_count, score}], averages, adherence, logged_days, best_day|null, weight|null {first,last,change,entries}, targets, summary}`.
- CSV = web `weeklyCsv()` (BOM + CRLF, same columns/footer rows), file `orza-weekly-<start>-to-<end>.csv`.

### Credits
- `GET /api/credits/balance` → `{credits, costs: {scan, meal_text, chat, recipe, compensation, report_insight}, ai_enabled, spent_30d}`.
- `GET /api/credits/transactions` → `{transactions: [{id, amount (+grant/−spend), reason, action?, balance_after, created_at}]}` (newest 100).
- `GET /api/credits/request` → `{requests: [{id, message, balance, status: 'open'|'done', created_at, handled_at}], pending|null}`.
- `POST /api/credits/request {message?}` (≤ 800 chars) → 201 `{request}`; 429 `rate_limited` ("You've already sent a few requests today…"),
  400 validation. Web states: button "Request more credits" → sheet → "Send request" → toast "Request sent / Thanks! We'll reply to <email> soon."
  → hero button becomes disabled "Request sent" (also when `pending` on load).
- No AI endpoints in this step (402/503 not applicable); credits balance syncs the header via `setUser({...user, credits})`.

## Library APIs
- `expo-file-system` 57: `new File(Paths.cache, name)`, `file.create({ overwrite: true })`, `file.write(text)` (UTF-8 default), `file.uri`.
- `expo-sharing` 57: `isAvailableAsync()`, `shareAsync(uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle })`.
- `react-native-svg` (Path/Defs/LinearGradient/Line/Rect/Circle/Text), Reanimated 4 (`.get()/.set()`, `useReducedMotion`, entering animations),
  `react-native-gesture-handler` Pan/Tap for chart scrubbing, React Query.

## Decisions
- No "Plans preview" (prices) on the phone: App Store 3.1.1 — no external pricing / purchase flows; members request credits instead.
- No "Export for your doctor" print on the phone (web-only `window.print`); CSV share covers export. Mentioned in report as open issue.
- Date picker: own month-calendar Sheet (dependable, no native module risk), plus prev/next stepper.
- Weight chart: Catmull-Rom → cubic Bézier smooth line, energy-gradient stroke + area wash, dashed cyan target line, tap/drag scrub readout.
- Weekly charts: svg bars with energy gradient, dashed target line, ±10% band (calories), today highlighted, best day dot.
- Goals/reports queries use staleTime 0 (weigh-ins, meals, water, steps are logged on other screens). Goal save + weight log
  also invalidate `['dashboard']` (Today). Credits header sync only from a fresh balance fetch (never the cached copy).
- Query keys: `['goals','active']`, `['reports','daily',date]`, `['reports','weekly',end]`, `['credits','balance'|'transactions'|'requests']`.
  Weight log/goal save invalidate `['goals']` and `['reports']`.

## Checklist
- [x] notes
- [x] features/goals/types.ts, math.ts, api.ts
- [x] features/goals/WeightChart.tsx, WeightTrendCard.tsx, LogWeightSheet.tsx
- [x] features/goals/GoalOverview.tsx, TargetsGrid.tsx, GoalCalculator.tsx, PlanPreview.tsx
- [x] app/(app)/goals.tsx (typecheck + lint clean)
- [x] features/reports/types.ts, format.ts, api.ts, share.ts
- [x] features/reports/DateStepper.tsx, CalendarSheet.tsx
- [x] features/reports/ScoreCard.tsx, DailyReportView.tsx
- [x] features/reports/WeeklyCharts.tsx, WeeklyReportView.tsx
- [x] app/(app)/reports.tsx
- [x] features/credits/types.ts, options.ts, api.ts
- [x] features/credits/BalanceHero.tsx, CostsCard.tsx, TransactionHistory.tsx, RequestCreditsSheet.tsx
- [x] app/(app)/credits.tsx
- [x] npm run typecheck + npx expo lint clean (whole project, 2026-10-15)
