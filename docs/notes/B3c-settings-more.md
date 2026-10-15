# B3c-settings-more — Settings hub + account/* sub-pages + More tab

Resume: read this file, `git -C E:\aylo\orza-mobile status --short`, open the files already written, continue from the
unchecked items. Research below is final — don't redo it.

## Endpoints (web: E:\aylo\orza\src\app\api\…)

All errors: `{error, code}`; zod validation → 400 `{error: "<path>: <message>", code: "validation"}` (no `field` —
`splitFieldError()` in features/settings/api.ts parses the `path:` prefix, e.g. `profile.age: …`, `new_password: …`).

| Call | Body | Response | Notes |
|---|---|---|---|
| GET /api/profile | — | `{user: PublicUser}` | used to sync user (snapshot has `memory: []`) |
| PUT /api/profile | `{name?, profile?: {age, sex, height_cm, weight_kg, target_weight_kg, activity_level, goal, diet, allergies[], conditions[], region, language, household_mode, lifestyle, timezone}, recompute_targets?}` (null/"" clears) | `{user, targets_recomputed}` | only changed fields; driver change (age/sex/height/weight/activity/goal) recomputes targets; `{recompute_targets:true}` = "Reset to recommended"; new weight logs today's weigh-in |
| PUT /api/settings/targets | `{calories?, protein_g?, carbs_g?, fat_g?, fiber_g?, water_glasses?, steps?}` ints | `{user}` | ranges in TARGET_FIELDS |
| PUT /api/settings/preferences | `{units?, reminders?, weekly_report?, tone?, ai_training_opt_out?}` | `{user}` | one key per save (optimistic, revert on error) |
| PUT /api/settings/memory | `{memory: string[]}` (≤30, each ≤200) | `{user}` | replaces whole list |
| POST /api/account/password | `{current_password, new_password}` (8–128, must differ) | `{ok:true}` | 401 code `wrong_password`; 401 `unauthorized` = expired; 429 `rate_limited` after 5 wrong / 15 min. Other sessions revoked, this one stays. |
| GET /api/account/export | — | JSON document (attachment `orza-data-YYYY-MM-DD.json`) | may be large → 60 s timeout |
| DELETE /api/account | `{confirm:"DELETE"}` | `{ok:true}` | revokes every session; then local `signOut()` (its logout 401s quietly; handler + signOut net to no "session ended" notice) |
| logout | via `useAuth().signOut({everywhere})` | | everywhere throws offline → stay signed in, show error |

Limits/options copied from web `src/components/account/options.ts` into `src/features/settings/options.ts`
(SEX/ACTIVITY/DIET/LANGUAGE/HOUSEHOLD options, ALLERGY_SUGGESTIONS, LIFESTYLE_SUGGESTIONS, PROFILE_LIMITS,
TARGET_FIELDS, DEFAULT_TARGETS, MEMORY_MAX_ITEMS=30 / LENGTH=200, INDIAN_REGIONS + FEATURED + "Outside India").
Profile draft/patch logic ported from web `settings/profile-draft.ts` (units-aware, lb/ft-in conversion, same messages).

## Library APIs
- expo-file-system 57 (new API): `new File(Paths.cache, name)`, `file.create({overwrite:true})`, `file.write(text)`, `file.uri`.
- expo-sharing: `isAvailableAsync()`, `shareAsync(uri, {mimeType:'application/json', UTI:'public.json', dialogTitle})`.
- expo-web-browser `openBrowserAsync(url)` for Privacy policy / Trust pages (`WEB_URL` from @/lib/config).
- `usePreventRemove` from `expo-router/react-navigation` + `useNavigation()` for unsaved-changes guard (same as med/edit.tsx).
- RN `Switch` (tinted), `RefreshControl` tinted coral.

## Decisions
- Single source of truth = `useSignedInUser()`. `useAccountSync()` (React Query `['account','profile']`, GET /profile)
  pushes the fresh user into `setUser`; every mutation `setUser(res.user)`.
- Password change: `src/lib/api.ts` now exempts a `wrong_password` 401 from the global sign-out (Phase B verifier), so the
  request goes through the normal authenticated client. Expired-session 401 (`code !== 'wrong_password'`) signs out as usual
  and the screen also shows the "session ended" message.
- Toast has no action → memory "Undo" is an inline animated pill (6 s).
- Routes: `settings.tsx` hub; `account/profile`, `account/targets`, `account/preferences`, `account/memory`,
  `account/password`, `account/data` (export + delete + links). All normal pushes.

## Checklist
- [x] src/features/settings/options.ts
- [x] src/features/settings/profileDraft.ts
- [x] src/features/settings/api.ts (types, hooks, export/share, field-error parsing)
- [x] src/features/settings/parts.tsx (SettingsGroup, SettingsRow, FieldGroup, SaveBar, ToggleRow, Avatar)
- [x] src/features/more/* (menu.ts, AccountCard.tsx; MenuSection rendered with SettingsGroup+SettingsRow)
- [x] src/app/(app)/(tabs)/more.tsx
- [x] src/app/(app)/settings.tsx (hub; Delete row pushes /account/data?confirm=delete)
- [x] src/app/(app)/account/profile.tsx (+ features/settings/RegionSheet.tsx, TargetsCallout.tsx)
- [x] src/app/(app)/account/targets.tsx
- [x] src/app/(app)/account/preferences.tsx
- [x] src/app/(app)/account/memory.tsx
- [x] src/app/(app)/account/password.tsx
- [x] src/app/(app)/account/data.tsx
- [x] npm run routes / typecheck / lint (all clean)
