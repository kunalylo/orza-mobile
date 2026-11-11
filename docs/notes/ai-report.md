# In-app AI reports: plan and API contract

Date: 2026-11-11. Status: **contract written; server, admin page and website built on `web:` branch
`ai-report-backend`, commit `00de068`** (not pushed; its push needs the user's OK). `check-ai-report.mjs` 47/47 on a
local AI-off server (50/50 with the day limit); the website's Report on a chat reply and an AI recipe was looked at in
the browser at desktop and phone width (dialog, Send disabled until a reason, Escape and Cancel, focus back on Report).
The admin page was checked through its API only. **Phone side built** (§8: Report on every reportable output, the
sheet, `npm run test:report`); code only, its device check is §8.4.

**Why (Google Play, AI-Generated Content).** An app whose AI writes content (a chatbot as a central feature is in
scope) must let people report or flag offensive AI output **inside the app, without leaving it**, and the reports must
feed back into moderation. `ai-consent.md` §1 and §9 list this as the missing D3 item.

**Conventions**
- Paths without a prefix are relative to `E:\aylo\orza-mobile`.
- `web:` means the backend worktree `E:\aylo\orza-backend`, branch `ai-report-backend` from `main` = `159d57e`. Never
  build in `E:\aylo\orza`, the live checkout.

---

## 0. Decisions on one screen

1. **Five kinds of output can be reported** (§2): an Ask ÖRZA reply (`chat`), a recipe (`recipe`), a rebalance plan
   (`rebalance`), a Snap & Know result (`scan`) and a typed, spoken or photo meal log (`meal`). Each is a stored
   document with a stable id that the member sees as ÖRZA's own text. Prescription reads are left out (§2).
2. **One endpoint**: `POST /api/ai/reports {kind, ref_id, reason, note?}`, signed in (cookie or the app's Bearer token).
   Only the member's own item can be reported; anything else is 404, so ids never leak.
3. **No AI consent needed.** A report sends nothing to OpenAI, so it only needs a signed-in member, not `requireAiUser()`. A
   member who turned AI features off can still report an earlier reply.
4. **One report per member per item.** A second report of the same item replaces the first (reason, note, snapshot),
   and a reviewed report goes back to "To review".
5. **A snapshot, nothing else.** The report keeps a plain-text copy of what the member was shown, so moderation sees
   it even after the chat, recipe or plan is deleted. It never copies the member's message, profile or other data. The
   email is read from the account when an admin lists reports; it is not stored in the report.
6. **Rate limits**: 10 reports a minute per account (the `rate-limit.ts` counters, as for sign-in) and 30 reported items
   per rolling 24 hours per account (counted in the database, as for credit requests).
7. **Moderation**: a new admin console page, **AI reports** (`/dashboard/admin/reports`), lists reports newest first
   with the kind, reason, note, the reported text, the date, the member's email and a **Reviewed** switch. The Overview
   shows how many wait for review.
8. **The website gets the same Report action** on Ask ÖRZA replies and AI recipes (this build). The phone has it on
   all five kinds (§8).
9. **Account data**: reports are in the member's data export and are deleted with the account.

---

## 1. The store rule

| Policy | What it asks for | What this does |
|---|---|---|
| **Google Play AI-Generated Content** | Apps with generative AI (chatbots where the chatbot is central, among others) must let people report or flag offensive AI content in the app, without leaving it, and use the reports to inform content filtering and moderation. | A Report action next to the AI's text, a short in-app form (a reason and an optional note), a stored report with a snapshot, and an admin page where the team reads and ticks them off. What the team learns goes into prompts and filters (§6). |

Apple has no matching rule; the same action ships on iOS too (one product).

---

## 2. What can be reported

The six AI features and what they store (`ai-consent.md` §2):

| Feature | Stored as (web) | Reportable | `kind` / `ref_id` | Snapshot (`text`) | `ai` |
|---|---|---|---|---|---|
| **Ask ÖRZA** | `chat_messages` (role `assistant`) | **Yes** | `chat` / the message `id` | The reply as shown (`content`) | `meta.ai === true`. The built-in coach's replies look the same to the member, so they can be reported too (`ai: false`). |
| **Recipe ideas** | `recipes` | **Yes** | `recipe` / the recipe `id` | Title, description, ingredients and method | `source === "ai"`. A curated recipe (`library`) is accepted too, but the apps show Report on AI recipes only (they already label them "Created by ÖRZA AI"). |
| **Rebalance plan** | `compensation_plans` | **Yes** | `rebalance` / the plan `id` | The message, then each day's date, calories, focus, activity and meal ideas | `plan.ai`. The built-in plan is accepted too (`ai: false`). |
| **Snap & Know** | `scans` | **Yes** | `scan` / the scan `id` | Dish name, the items with kcal, the total and the AI's note | Always `true` (scans only exist with the AI). |
| **Typed / spoken meal** (and a saved Snap) | `meals` with `source` `text`, `voice` or `photo` | **Yes** | `meal` / the meal `id` | The items with kcal, the total and the note | `notes` present or `source === "photo"` (the built-in food list writes no note). Manual and chat meals are 404: manual ones are the member's own, a chat meal is reported through its reply. |
| **Prescription read** | `prescriptions` | **No** | — | — | — |

**Why prescription reads are left out**
- The result is a transcription of the member's own prescription (medicine names, strengths, doses, timings), not text
  ÖRZA writes. The member checks and edits every field on the review screen before any alarm exists, and "Type the
  medicines" is always there. A wrong reading is fixed in place.
- A snapshot would copy medicines, the doctor and the AI's `notes` (diagnosis, tests advised) into the moderation
  queue. That is health data the team doesn't need to see.
- If the read ever writes advice of its own, add `rx` here.

**Not AI output** (never reportable): the member's own chat messages, manual meals, reports, goals, Today's insight,
reminders and medicines.

---

## 3. API contract

### `POST /api/ai/reports` (cookie or `Authorization: Bearer`; JSON; body ≤ 16 KB)

Body:

| Field | Type | Rule |
|---|---|---|
| `kind` | `"chat" \| "recipe" \| "rebalance" \| "scan" \| "meal"` | Required. |
| `ref_id` | string | Required, trimmed, 1–100 characters: the item's `id` as the API returned it. |
| `reason` | `"offensive" \| "unsafe" \| "wrong" \| "other"` | Required. |
| `note` | string \| null | Optional, ≤ 500 characters after trimming (line breaks kept, runs of blank lines folded). Empty = none. |

Answers, in this order:
1. **403** `cross_site` for a cookie request from another site and **415** when not JSON (the usual guard, before
   anything else; the app's Bearer requests skip the origin part).
2. **401** `unauthorized` when signed out.
3. **429** `rate_limited` (with `Retry-After`) after 10 reports in a minute: "You've sent several reports in a row.
   Please try again in 1 minute."
4. **400** `validation` for a bad body (`kind: Choose what you're reporting`, `reason: Choose a reason`,
   `note: Keep the note under 500 characters`, …); 413 over 16 KB.
5. **404** `not_found` "We couldn't find that to report. It may have been deleted." when the item doesn't exist, isn't
   the member's, or isn't reportable (a member's own message, a manual meal).
6. **429** `rate_limited` (no `Retry-After`) "You've sent a lot of reports today. Thank you, the team will look at
   them." when the account already reported 30 other items in the last 24 hours (changing a report sent in those 24
   hours is always allowed).
7. **201** for a first report, **200** when it replaced the member's earlier report of the same item:

```json
{ "report": { "id": "…", "kind": "chat", "ref_id": "…", "reason": "offensive", "note": null,
              "created_at": "2026-11-11T10:00:00.000Z", "updated_at": "2026-11-11T10:00:00.000Z" } }
```

The member's answer never carries the snapshot, the review state or anything about staff. There is no member `GET`:
the apps show "Reported" for what they reported in this visit, and reporting again simply updates.

### Admin (`requireAdmin()`: 403 for members)
- `GET /api/admin/ai-reports?status=open|reviewed|all&limit=1–200` (default `all`, 100) →
  `{reports, open}`, newest first by `updated_at` (a changed report moves back to the top). `open` = how many wait for
  review. Each row:
  `{id, kind, ref_id, reason, note, text, ai, client: "app"|"web", made_at, created_at, updated_at, reviewed,
  reviewed_at, member: {id, name, email} | null}` (`member` is read from `users` at list time, an explicit allow-list).
- `PATCH /api/admin/ai-reports/[id] {reviewed: boolean}` → `{ok: true}` (404 when unknown). `true` records
  `reviewed_at` and `reviewed_by` (the admin's id); `false` clears them.
- `GET /api/admin/stats` gains `open_ai_reports` (additive).

---

## 4. Stored document (`ai_reports`, `AiReport` in `web:src/lib/types.ts`)

| Field | What |
|---|---|
| `id` | uuid |
| `user_id`, `kind`, `ref_id` | Who reported what. Unique together (Mongo index; a race between two first reports retries as an update). |
| `reason`, `note` | The member's latest answer (`note` null when none). |
| `text` | The snapshot (§2), ≤ 12,000 characters, refreshed from the item at each report. |
| `ai` | Whether the AI wrote it (false: the built-in coach, a curated recipe, the built-in plan, the food list). |
| `made_at` | When the item was made (its `created_at`). |
| `client` | `"app"` (Bearer app session or `X-ORZA-Client: mobile`) or `"web"`. |
| `reviewed`, `reviewed_at?`, `reviewed_by?` | The team's tick. A new report from the member sets `reviewed: false` and clears the rest. |
| `created_at`, `updated_at` | First report; latest change by the member. |

Indexes: `id` unique, `user_id + kind + ref_id` unique, `reviewed + updated_at`, `updated_at`, `user_id + updated_at`.

**Kept** until the member deletes the account (`DELETE /api/account` deletes `ai_reports` with the rest). Deleting the
reported chat, recipe or plan keeps the report: the snapshot is the point. The export (`GET /api/account/export`)
lists `ai_reports` as `{id, kind, ref_id, reason, note, text, created_at, updated_at}` (no review fields).

**Not an AI-improvement use.** A report is something the member chose to send to the team, read by people to fix that
kind of answer (prompts, filters, the guardrail). That is "To keep ÖRZA safe" in the privacy policy. Reports never go
into a dataset to train or tune a model; if that ever changes, web SPEC "AI improvement" applies (skip members who opted
out, strip steps and health data).

---

## 5. Copy (the user reviews it)

**Reasons** (`reason` → label), in this order:
- `offensive` → "Offensive or hurtful"
- `unsafe` → "Unsafe advice"
- `wrong` → "Wrong or misleading"
- `other` → "Something else"

**Trigger**: "Report" with a flag icon. Screen readers: "Report this reply", "Report this recipe", "Report this plan",
"Report this result". After a report this visit: "Reported" (screen readers: "Reported. Change your report").

**Form** (a dialog on the website, a sheet on the phone)
- Title: "Report this reply" / "Report this recipe" / "Report this plan" / "Report this result".
- Lead: "Tell the ÖRZA team what's wrong. We use reports to make ÖRZA's AI safer."
- Group label: "What's wrong?" (one choice, none picked at first; Send is disabled until one is).
- Note: label "Anything to add? (optional)", counter "0/500".
- Hint under it: "The team sees this reply with your report." (recipe / plan / result in place of reply).
- Buttons: "Send report", "Cancel".
- Sent: toast "Report sent" with "Thanks. The ÖRZA team will review it." (the phone: one toast, "Report sent. Thanks.
  The ÖRZA team will review it.").
- Errors: the server's text (404, 429), offline "We couldn't reach ÖRZA. Check your connection and try again." (the
  phone uses its API client's offline line, "Can't reach ÖRZA right now. Check your connection and try again.").
- Phone only: an older server without the endpoint, "Reporting isn’t available yet. Please try again later."; the long
  press on a reply, "Copy reply" / "Report this reply" (screen readers: "Reply options").

**Privacy page** (proposed, not edited in this build; the user reviews it): under "Information you give us", add
"**Reports:** if you report an AI answer, a copy of that answer with your reason and note, which the ÖRZA team reviews
to make ÖRZA safer." The policy date moves on the day it goes live.

---

## 6. Moderation (admin console)

- Nav item **AI reports** (`/dashboard/admin/reports`, flag icon), between Credit requests and Team; every admin.
- Filter: **To review** (default) · Reviewed · All.
- Each row: kind ("Ask ÖRZA reply", "Recipe", "Rebalance plan", "Snap & Know result", "Meal log"), the reason (a tag),
  "Built-in" when `ai` is false, the member's note, the reported text in a scrollable box, "Reported …" (and "first
  reported …" when it changed), app or website, the member's name and email (mailto), and the **Reviewed** switch.
- What the team does with a report: read it, fix the cause where it lives (the feature's system prompt,
  `WELLNESS_GUARDRAIL`, the recipe and plan vetting in `recipes-library.ts` / `compensation.ts`), reply to the member by
  email when useful, then tick Reviewed. Overview shows the count waiting.

---

## 7. Web files (`ai-report-backend`)

- `src/lib/ai-report-shared.ts` (pure): kinds, reasons, `AI_REPORT_NOTE_MAX`.
- `src/lib/ai-reports.ts`: the collection, the owned-item loader and snapshots, the views.
- `src/lib/types.ts` (`AiReport`), `src/lib/db.ts` (`ai_reports` + indexes).
- `src/app/api/ai/reports/route.ts` (POST); `src/app/api/admin/ai-reports/route.ts` (GET),
  `src/app/api/admin/ai-reports/[id]/route.ts` (PATCH); `stats` (`open_ai_reports`).
- Account: `DELETE /api/account` and the export include `ai_reports`.
- Website: `src/components/ai/report-copy.ts`, `src/components/ai/ReportAiAction.tsx` (trigger + dialog), used by the
  chat's `AssistantBubble` and by `RecipeDetail` for AI recipes.
- Admin: `src/app/dashboard/admin/reports/page.tsx`, `src/components/admin/AiReportsCard.tsx`, the nav item, an
  Overview shortcut.
- `SPEC.md`, `scripts/check-ai-report.mjs`.

**Check** (`scripts/check-ai-report.mjs`, against your own `next dev -p 3101` with the noai preload, JSON-file DB,
`ai_enabled:false` checked first, 0 AI calls): a throwaway member gets a built-in chat reply, a curated recipe, a
built-in plan and a food-list meal; then 401, 400s, 404s (unknown id, another member's reply, the member's own message,
a manual meal), 201, the second report → 200 with one document, the website cookie path and the cross-site guard,
the minute limit, a member refused by the admin APIs, and (with `ORZA_ADMIN_EMAIL` / `ORZA_ADMIN_PASSWORD` for a local
admin) the list, the snapshot, the member's email, Reviewed on and off, re-report → back to review, export and deletion.
`ORZA_CHECK_DAY_LIMIT=1` adds the 30-items-a-day limit (about 3 more minutes, paced by the minute limit). Not covered:
a Snap result (scans need the AI); its loader is read in review.

---

## 8. Phone (built 2026-11-11)

No AI consent gate (§0.3): `/ai/reports` is not one of the backstop's AI paths, so a member who turned AI features
off can still report. Nothing is queued offline. Play Console: mention the in-app reporting in the app content answers
(D3).

### 8.1 Where Report shows

| Output | Where | `kind` / `ref_id` | Shown when |
|---|---|---|---|
| Ask ÖRZA reply | Under every ÖRZA bubble (a small flag + "Report", 36 dp, 48 with its slop), and a **long press** on the bubble: an options sheet with Copy reply / Report this reply. TalkBack and VoiceOver also get Copy reply and Report this reply as actions on the bubble. | `chat` / the message `id` | Every stored reply, the built-in coach's too (`canReportChat`; never a `tmp-` or sending one) |
| Recipe | The new recipe card on Recipes (under its buttons) and the recipe screen (on the "Created by ÖRZA AI" line) | `recipe` / `id` | `source === "ai"` |
| Rebalance plan | The new plan's action row and an expanded past plan (ghost "Report" button) | `rebalance` / `id` | `plan.ai` |
| Snap & Know | The result card before Log, on the "ÖRZA analysis" line | `scan` / `scan.id` | Always (scans need the AI) |
| Typed / spoken meal | The "Logged to …" card's action row (beside Adjust portions and Undo) | `meal` / `meal.id` | The card says "AI estimate" and the source is `text` or `voice` (`canReportMeal`) |

The meal screen and the chat's "Logged" meal card have no Report: the first shows the member's own meal, the second
is reported through its reply.

On the Snap result and the recipe screen, Report's slop reaches over the heading under it (the dish name 8 dp below,
the title right under the line). A text laid out later wins those touches, so Report's line is `zIndex: 1` and comes
first in the touch search: 48 dp there too, not 38 / 40. The heading still takes TalkBack's explore by touch (a
`pointerEvents="none"` wrapper would stop it).

### 8.2 The sheet and the answers

- One sheet for the whole app (`AiReportHost`, mounted in the member layout beside `AiConsentHost`); every trigger
  calls `openAiReport(kind, refId)`. The reply's long-press sheet opens it once it has gone (300 ms later on iOS, one
  modal at a time). Another member or a sign-out closes it and drops an answer still on its way.
- Contents (§5): title, lead, "What’s wrong?" with the four reasons as radio cards (56 dp, none picked), the note
  (multiline, 500 characters, hint and counter under it), then Send report (disabled until a reason) and Cancel.
  While sending nothing dismisses it and the fields are locked.
- Sent (201 or 200 with `{report: {id}}`): the sheet closes, toast "Report sent. Thanks. The ÖRZA team will review
  it." (one line: the app's toasts have no second line), and the trigger says "Reported" with a filled flag for the
  rest of the visit (screen readers: "Reported. Change your report"). It still opens the sheet: reporting again
  replaces the report.
- Failed: the sheet stays open with the reason and note, and a line above the buttons: offline or slow, the API
  client's own words ("Can't reach ÖRZA right now. Check your connection and try again."); 404 `not_found`, both 429s
  and 400s, the server's text; **an older server without the endpoint** (a 404 without the route's `not_found` code,
  which is the framework's page, or a 405 / 501): "Reporting isn’t available yet. Please try again later." A 401 signs
  the app out as everywhere else.

### 8.3 Files and checks

- `src/lib/aiReport.ts` (pure): kinds, reasons, the copy, `canReport*`, `reportBody` (trimmed note, left out when
  empty, at most 500 characters, never half an emoji), `isReportAnswer`, `isReportUnavailable`, the reported-this-visit
  set.
- `src/features/ai/report.ts` (store, `POST /ai/reports`), `AiReportSheet.tsx` (`AiReportHost`), `ReportAiButton.tsx`
  (`look` quiet or button); `features/settings/parts.tsx` `ChoiceList` gained `disabled`.
- Triggers: `features/chat/MessageBubble.tsx` (+ `ReplyOptionsSheet`) and `app/(app)/ask.tsx`,
  `features/recipes/RecipeResult.tsx` and `RecipeDetail.tsx`, `app/(app)/rebalance.tsx` and
  `features/rebalance/PlanHistory.tsx`, `features/snap/ScanReview.tsx`, `features/meals/LoggedResult.tsx`.
- `npm run test:report` (`scripts/tests/ai-report.test.ts`, 20): the server's lists, no consent for the path, the
  body, the answer, the older-server check, where Report shows, the reported set, the copy.

### 8.4 Device check (later, with the backend branch on a local server, 0 AI calls)

1. Each of the five places shows Report as in §8.1, and not on a curated recipe, a built-in plan or a food-list meal.
2. Long press on a reply: the options sheet, then Report opens the Report sheet (iPhone: no stuck modal); Copy reply
   still copies.
3. Send stays disabled until a reason; a send → 201, the toast, "Reported"; again → 200, one document.
4. Offline: the network line, nothing sent later. A server on `main` (no endpoint): the "isn’t available yet" line.
5. TalkBack: the bubble's actions, the trigger's names, the radio cards (checked state), the counter; focus after
   the sheet closes (not handled in code: check where it lands). 360 dp with font 1.3: nothing cut in the sheet, the
   flag rows and the action rows.
6. Targets (`a11y.mjs` bounds): each flag 48 dp with its slop; a tap 6 dp into the dish name (Snap) or the title (recipe
   screen) under Report opens the sheet.

## 9. Open questions for the user

1. The §5 copy (with the phone's lines) and the proposed privacy-page line.
2. Pushing `ai-report-backend` live (adds the endpoint, the admin page and the website's Report action).
