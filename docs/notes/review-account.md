# Review fixes: account area (Profile, Targets, Preferences, More, auth core)

Checklist of confirmed review findings. Tick each one when its fix lands, so an interrupted run can resume from the unticked items.

- [x] account-1: saving two preferences quickly leaves the first control stuck "pending" and never rolls it back (one `useMutation`, per-call callbacks dropped)
- [x] account-2: Profile / Targets with unsaved edits are diffed against a refreshed baseline, so Save puts back stale values for untouched fields (e.g. weight)
- [x] account-3: edits made while a Profile / Targets save is in flight are overwritten when it succeeds
- [x] account-4: More tab's "Couldn't refresh" toast never shows because `refresh()` never throws
- [x] account-5: a `/auth/me` refresh (or a user-returning mutation) that lands after sign-out restores the user and rewrites the Keychain snapshot

## Notes

- account-1: Preferences shows `{...server, ...unsaved}`, where `unsaved` holds the values waiting for / in their save
  (a key in it = that control is pending). Saves go through a small promise queue (`useRef<Promise>`) and use
  `mutateAsync` in try/catch/finally, so every save gets its own success haptic / error toast and always clears its
  pending state; on failure, dropping the key shows the server value again (the rollback). Serialising also means an
  older PUT answer (whole user) can never land after a newer one. Error text now goes through `errorMessage`.
- account-2: new pure `rebaseDraft(draft, from, to)` in `features/settings/profileDraft.ts` — every field still equal to
  `from` takes `to`'s value, edited fields stay; height (cm / ft / in) moves as one field. Profile keeps `base` (the
  server copy the draft is edited from, always in the draft's units) next to `seenBase`; when the user copy changes, the
  draft is rebased from `base` onto the fresh copy (a draft with no edits left adopts the new baseline, incl. a units
  switch). `dirty`, `usePreventRemove` and `buildPatch` all compare against `base`, so Save only sends real edits and
  the screen shows the fresh values. Targets does the same with a local `rebase` and a `base` state (replaces `seenBase`).
- account-3: Save remembers the draft it sent; on success the draft is rebased from that sent copy onto the saved copy
  (`setDraft(d => rebase(d, sent, saved))`, `setBase(saved)`), so server-tidied values replace what was sent while
  anything edited during the request stays (and keeps the form dirty). Works whichever runs first — the hook's
  `setUser` render-time sync or the per-call `onSuccess`. Profile skips it if the draft already adopted other units
  (it then had no edits left). Inputs stay editable during a save. Reset-to-recommended still replaces the whole
  targets draft (that is what Reset means).
- account-4: More's pull-to-refresh checks `refresh()`'s result (it never throws) and shows "Couldn't refresh — check
  your connection." only when it returned null and a session token still exists — an ended session (401) has already
  cleared the token synchronously in the unauthorized handler, so no connection toast on top of the sign-out.
- account-5: `lib/auth.tsx` — `refresh()` captures the session token before `/auth/me` and drops the answer (returns
  null, no state, no Keychain write) if the token changed meanwhile; returns null straight away with no session. The
  boot `/auth/me` gets the same check. The `setUser` handed to screens and mutations is now guarded: ignored with no
  session token, or when the copy's `id` isn't the signed-in user's (a `userId` ref kept in step by `applyUser`, the
  boot snapshot and `clearLocal`) — covers late mutation answers (save preference / profile / targets / memory, weigh-in,
  onboarding…) after sign-out or after signing into another account. Internal paths (`finishAuth`, boot, `refresh`)
  still call the unguarded `applyUser` after their own checks.
- Checks: `npm run typecheck` exit 0 (a first run showed transient errors in `src/features/calendar/api.ts` /
  `deviceCalendar.ts` — another area's in-progress edits — gone on the re-run) and `npx expo lint` exit 0.
