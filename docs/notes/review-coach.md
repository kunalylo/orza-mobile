# Review fixes: coach area (chat, recipes, rebalance, goals, reports, credits)

Checklist of confirmed review findings. Tick each one when its fix lands, so an interrupted run can resume from the unticked items.

- [x] chat-1: send() always clears the composer, so Retry, quick actions and starter questions delete the typed draft
- [x] contract-1: field-level 400 routing relies on an ApiError.field the server never sends for chat, recipes or rebalance
- [x] recipes-1: deleting the just-generated recipe leaves a stale result card
- [x] credits-1: chat credit spends get the grant icon (reason "Ask ÖRZA" not recognised, tx.action ignored)

## Notes
- chat-1: `send(text, { fromComposer })` now empties the composer (and clears its error) only for the composer's own
  text. The hook exposes `sendInput()` for the composer, which `ask.tsx` passes as `onSend`. Retry, quick actions and
  starters call `send(text)` and leave the draft alone.
- contract-1: `aiErrorInfo` (features/chat/ai.ts) now reads the field from the server's real 400 shape,
  `{error: "<path>: <message>", code: "validation"}`. It falls back to `ApiError.field`, and its `message` drops the
  `path: ` prefix and is capitalised. The B3a note is corrected. At integration the parser moved to `@/lib/api`
  (`validationField(e)` → `{field, path, message}`); chat, goals, meds, reminders, rx, settings (`splitFieldError` uses
  `path`), the meal text composer (`text`) and Snap (`note`) all use it — the last two checked an `e.field` the meals
  routes never send.
- recipes-1: `useDeleteRecipe` has `mutationKey ['recipes','delete']`. `onRecipeDeleted(qc, cb)` subscribes to the
  mutation cache, and Recipes uses it to close the result card when that recipe is deleted. It avoids the list-refetch
  race of hiding the card based on list membership, and the mutation-GC problem of `useMutationState`. A save
  that returns 404 (deleted on another device) also drops the recipe from the list and closes the card.
- credits-1: `transactionAction(tx)` prefers the server's `tx.action`, checked with an own-key Set rather than `in`,
  and maps "Ask ÖRZA…" reasons to chat for older rows. `transactionLabel` uses the same own-key check.
- Checks: `npm run typecheck` and `npx expo lint` both pass on the full tree, including other areas' in-progress files.
