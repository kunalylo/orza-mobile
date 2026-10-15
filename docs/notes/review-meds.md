# Review fixes: meds area (medicines, med edit, prescriptions, alarm)

Checklist of confirmed review findings. Tick each one when its fix lands, so an interrupted run can resume from the unticked items.

- [x] meds-1: saving the edit form always re-sends the stock count from when the form opened, undoing Takes recorded meanwhile
- [x] meds-2: a today refetch started during the dose POST can overwrite the confirmed Take/Skip; stale doses never refetched on 404/400
- [x] meds-3: any 503 (including temporary `ai_busy`) shown as "Scanning isn't available" with no Try again
- [x] meds-4: SOS mode hides the Repeat controls but still validates them, blocking Save with an invisible error
- [x] meds-5: closing the rx row editor sheet silently discards everything typed
- [x] meds-6: prescriptions without a written date show the UTC day of the scan (one day early 00:00-05:29 IST)

## Notes
- meds-1 (`med/edit.tsx`): the form keeps a `seed` draft (the unsaved-changes baseline). While "Left now" is untouched it
  follows the cached `stock.count` (render-time sync, so Takes landing after the form opened show up). `stockPatch()`
  leaves `stock` out of the PATCH when no stock field changed, sends `null` only when tracking was switched off, and
  when only the unit / refill alert changed sends the latest cached count instead of the one the form opened with.
- meds-2 (`features/meds/api.ts`): `useDoseActions` counts dose writes in flight per date (module-level, across screens)
  and, once the last one settles after a success or a stale-dose error, invalidates `today(date)` with the default
  `cancelRefetch: true` so a GET that started mid-write is replaced. Stale-dose errors (404 / 400 "…schedule") roll back,
  refresh list + detail, emit `meds-changed` and show an info toast instead of an error. `isStaleDoseError` now lives in
  meds/api.ts and the alarm uses it; the alarm's today invalidation also cancels an in-flight GET (same root cause).
- meds-3 (`features/rx/problem.ts`, `ProblemPanel.tsx`): only `code: 'ai_disabled'` maps to "Scanning isn't available";
  new retryable `ai_busy` kind (timer icon, Try again); other 503s fall through to the retryable `error` kind.
- meds-4 (`features/meds/schedule.ts`): `scheduleFromDraft` ignores Repeat (days / interval) for SOS drafts and sends
  `days: []`, no `every_n_days`. The draft keeps them, so "Set alarm times instead" restores them.
- meds-5 (`features/rx/RowEditorSheet.tsx`): dirty = draft differs from what the sheet opened with (`savedTimes` ignored,
  times as a set). While dirty the sheet is `dismissible={false}` (no swipe) with `onBlockedDismiss={cancel}` — added
  to `Sheet` at integration — so the backdrop, the header X and Android back ask "Discard changes?" just like the
  footer's Cancel (next to Save).
- meds-6 (`features/rx/HistoryList.tsx`, `features/meds/shared.ts`, `rx/index.tsx`): new `dateIn(tz, at)` (todayIn now
  uses it); prescriptions without `issued_on` are dated by `created_at` in the member's timezone; `tz` passed from
  `useMedsTimezone()`.
- Checks: `npm run typecheck` and `npx expo lint` clean.
