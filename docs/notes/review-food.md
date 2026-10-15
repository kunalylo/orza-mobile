# Review fixes: food area (Today, Meals, Snap, meal edit, voice)

Checklist of confirmed review findings. Tick each one when its fix lands, so an interrupted run can resume from the unticked items.

- [x] food-1: saving an edited meal sends `confidence: null` (stored by Mongo for undefined), and PATCH /api/meals/[id] rejects it with 400
- [x] food-2: a quantity typed into the Stepper is dropped if Save / Log / Add is tapped while the field still has focus
- [x] food-3: text-log client timeout equals the server's AI timeout, so the server still logs after the app reports a timeout and a retry duplicates
- [x] food-4: a temporary 503 `ai_busy` is treated as "AI switched off", disabling Analyse for the current photo
- [x] food-5: Today's "Type or speak" / "Log" (and Snap/Meals cross-links) can log to an old day another tab was left on
- [x] food-6: when another screen takes over the microphone, the first screen is never told and stays stuck "listening"

## Notes

- food-1: `MealItem` (read shape) now types `grams` / `confidence` as `number | null | undefined`; request bodies use the
  new `MealItemInput` (no nulls) — `AddFoodInput.items`, `useUpdateMeal` items, snap `ConfirmInput.items`. `toDraft`
  normalises null → undefined; `fromDraft` returns `MealItemInput` and only includes grams / confidence when finite
  (confidence clamped to 0..1). The web's null-tolerant `optional()` schema is committed at web HEAD 3aac35a; the mobile
  side no longer depends on it being deployed.
- food-2: `Stepper` reports every keystroke that parses to a number > 0 (clamped), setting `shown` alongside so the
  render-time sync never rewrites the text being typed. Blur / submit only tidies the text; an empty / invalid field on
  blur goes back to the value from before the typing (focus, or the last −/+). Affects ItemEditor rows (edit meal, scan
  review, custom items) and the food picker's Servings — the dirty check, kcal preview and "Add N ×" label are live.
- food-3: text-log client timeout 45 s → 75 s (server: 45 s AI + parser fallback + DB). On a timeout / network ApiError
  `useLogMealText` refetches the day + summaries, the AI status and the user's credits; the composer shows "it may still
  have logged this meal — check your list below before trying again" and keeps the text.
- food-4: `scanProblem` maps only `code === 'ai_disabled'` to the AI-off panel; 503 `ai_busy` / gateway 503 fall through
  to the retryable `ScanErrorPanel` (server message, Try again on the same photo, credits-refunded note).
- food-5: Today (`openSnap` / `openCompose` / `openLog`), Snap (`openMeals`) and Meals (`openSnap`) always pass `date`.
  Known narrow edge (not changed): if Meals' own `today` state is stale across midnight while unfocused, an incoming
  `date` equal to the new today is ignored by the render-time `qDate <= today` check until its focus sync runs.
- food-6: `voice.ts` — `Owner.onAbandon` is called only on takeover in `start()` (after `abortActive`), and wraps up the
  previous screen's session keeping what it heard (`finish(session, true)`). `Session.done` makes `finish` idempotent, and
  `finish` only resets the hook's refs / listening UI when the session is still the current one.
- Checks: `npm run typecheck` and `npx expo lint` both clean (exit 0) with the other areas' in-progress edits present.
- Outside this area (shared request, applied at integration): `src/features/reports/DailyReportView.tsx` now passes the
  report's `date` to `/meals` (Meal log + "Log a meal"), same stale-day bug as food-5.
