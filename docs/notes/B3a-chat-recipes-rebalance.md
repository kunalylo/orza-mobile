# B3a — Ask ÖRZA chat, Recipes, Rebalance (working notes)

Ownership: `src/app/(app)/ask.tsx`, `src/app/(app)/chat/**`, `src/app/(app)/recipes.tsx`, `src/app/(app)/recipe/**`,
`src/app/(app)/rebalance.tsx`, `src/features/chat/**`, `src/features/recipes/**`, `src/features/rebalance/**`.

## Endpoints (from E:\aylo\orza\src\app\api\**)

All JSON, Bearer. AI calls: server AI timeout 45 s → client `timeoutMs: 65_000` for send / generate / plan.

### Chat (non-streaming JSON)
- `GET /chat/sessions` → `{ sessions: ChatSession[] }` (updated_at desc, max 50). ChatSession `{id,user_id,title,created_at,updated_at}`.
- `POST /chat/sessions {title?}` → 201 `{ session }` (not needed: send creates the session).
- `DELETE /chat/sessions/:id` → `{ ok: true }`; 404 "Conversation not found". Meals it logged stay.
- `GET /chat/history?session_id=` → `{ session, messages: ChatMessage[] (oldest first, latest 200), logged_meals: Record<mealId, Meal> }`; 404.
- `POST /chat/send { message (1..2000, trimmed), session_id? }` →
  `{ session_id, session, user_message, message, logged_meal?, credits?, memory?, remembered?, allergies?, notice? }`.
  Errors: 400 `validation` "message: Type a message for ÖRZA" / "message: Please keep messages under 2,000 characters", 402 `no_credits`,
  404 (session deleted), 429 `rate_limited`, network/timeout. AI outages fall back to the free coach (200 + `notice`).
  ChatMessage `{id,session_id,user_id,role,content,meta?:{logged_meal_id?,ai?,remembered?},created_at}`.

### Recipes
- `GET /recipes` → `{ recipes: Recipe[] (newest first, + all saved), ai_enabled, cost, kitchen: {diets: Diet[], avoid: string[]} }`.
- `GET /recipes/:id` → `{ recipe }`; 404 "That recipe doesn't exist anymore."
- `DELETE /recipes/:id` → `{ ok }`.
- `POST /recipes/:id/save { saved: boolean }` → `{ recipe }`.
- `POST /recipes/generate { prompt? ≤300, max_calories? int 150..1500, cuisine? ≤40, diet? }` → `{ recipe, ai, credits?, notice? }`.
  Errors: 400 `validation` "<field>: <message>" (prompt/max_calories/cuisine/diet), 422 `no_match`, 429. 402 never escapes (falls back to library + notice).
  Recipe `{id,title,cuisine,description,prep_minutes,servings,ingredients[],steps[],nutrition{calories,protein_g,carbs_g,fat_g,fiber_g},tags[],saved,created_at,source?,prompt?}`.
- Log a serving (web "Log 1 serving"): `POST /meals/manual { items: [{name ≤80, quantity:1, unit:"serving", calories, protein_g, carbs_g, fat_g, fiber_g}] }` → `{ meal }`.

### Rebalance (compensation)
- `GET /compensation` → `{ plans: Plan[] (newest, max 20), ai_enabled, cost }`.
- `POST /compensation/plan { occasion 2..80, description? ≤500, extra_calories? int 100..5000, days? 2..5 }` →
  `{ plan, credits?, estimate?: {calories, matched[], source}, notice? }`. 400 `validation` "<field>: <message>". 402 never escapes (notice).
- `DELETE /compensation/:id` → `{ ok }`; 404 "Plan not found".
  Plan `{id,occasion,description?,extra_calories,days:[{date,calorie_target,adjustment,focus,activity,meals[]}],message,summary?:{usual_calories,floor_calories,food_kcal,activity_kcal,released_kcal,avg_daily_trim,walk_minutes_per_day,extra_steps_per_day,back_to_usual},ai?,estimated?,created_at}`.

## Library APIs
- `api.get/post/del` + `ApiError {status, code, field}` + `errorMessage` (@/lib/api); `useAuth().setUser/refresh/user`.
- 400s from these routes carry no `field`: zod failures arrive as `{error: "<path>: <message>", code: "validation"}`
  (web `src/lib/http.ts` `route()`). `aiErrorInfo` (features/chat/ai.ts) splits that into `field` + a capitalised message.
- React Query v5: `useQuery`, `useMutation`, `useQueryClient().setQueryData/invalidateQueries`.
- `useVoiceInput({onFinal})` (@/lib/voice) → hide mic when `!available`; `start('en-IN'|'hi-IN')`, `stop`, `partial`, `error`, `blocked`.
- Reanimated 4: `FadeIn/FadeInDown/FadeInUp/LinearTransition`, `useReducedMotion`; shared values `.get()/.set()`.
- `Linking.openSettings()` for a blocked mic; `expo-web-browser` `openBrowserAsync` for https links in replies.

## Decisions
- Chat: server state in React Query (`['chat','sessions']`, `['chat','history',id]`); local state only for in-flight / failed
  messages of the current view, per-message notices and "fresh" ids (animate). On send success the history cache gets the
  user message + reply (+ logged meal) via `setQueryData`, so switching chats back and forth is instant.
- Conversation = inverted FlatList (keyboard-friendly, newest at the bottom); typing indicator = ListHeaderComponent.
  Entering animation uses `FadeInUp` because cells are flipped in an inverted list (visually rises from below).
- Opens `?session=` or today's latest conversation (web behaviour); `?q=` pre-fills the composer.
- No `chat/` routes needed (sessions live in a Sheet).
- Starter prompts: questions send, meal statements only pre-fill (never log a meal by accident) — as on web.
- 404 on history → handled from the history queryFn (`onNotFound`), not an effect (React Compiler lint: no setState in effects).
- Shared AI error helper `src/features/chat/ai.ts` (`aiErrorInfo`) used by all three features.
- After logging a meal (chat or recipe) invalidate `['meals','day',…]` (src/features/meals/api.ts keys) + today/dashboard/summary/reports/insights roots.
- Recipes: generator + result card on `/recipes`; full recipe on `/recipe/[id]` (initialData from the list cache).
- Rebalance: form + plan view + history (expandable rows, delete with native confirm).

## Checklist
- [x] docs/notes file (this)
- [x] src/features/chat/ai.ts (AI error helper + meal invalidation helper)
- [x] src/features/chat/types.ts
- [x] src/features/chat/api.ts
- [x] src/features/chat/format.ts
- [x] src/features/chat/prompts.ts
- [x] src/features/chat/RichText.tsx
- [x] src/features/chat/MessageBubble.tsx (user/assistant bubbles, logged meal card, typing, day separator)
- [x] src/features/chat/Composer.tsx (voice, autosize, send)
- [x] src/features/chat/ChatWelcome.tsx
- [x] src/features/chat/SessionsSheet.tsx
- [x] src/features/chat/useConversation.ts
- [x] src/app/(app)/ask.tsx
- [x] src/features/recipes/types.ts
- [x] src/features/recipes/api.ts
- [x] src/features/recipes/components (RecipeGenerator incl. cuisine Sheet, RecipeResult [GeneratingCard + RecipeResultCard], RecipeTile, NutritionRow, KitchenCard, DarkPanel, RecipeDetail)
- [x] src/app/(app)/recipes.tsx
- [x] src/app/(app)/recipe/[id].tsx
- [x] src/features/rebalance/types.ts
- [x] src/features/rebalance/api.ts
- [x] src/features/rebalance/components (RebalanceForm, PlanView [Stat, DayCard w/ EnergyRing, OrzaSays, HowItWorks], PlanHistory)
- [x] src/app/(app)/rebalance.tsx
- [x] npm run routes / typecheck / lint clean

## Status
All items built; `npm run typecheck` and `npx expo lint` clean for B3a files (2026-10-14).
Open: verify on a device that the chat composer stays above the Android keyboard (Screen's KeyboardAvoidingView relies on
adjustResize there); voice appears once B1a ships `useVoiceInput`.
