# In-app AI reports: plan and API contract

Date: 2026-11-11. Status: **contract written; server, admin page and website built on `web:` branch
`ai-report-backend`** (not pushed; its push needs the user's OK). The phone's Report action is the next step (§8).

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
3. **No AI consent needed.** A report sends nothing to OpenAI, so it uses `requireUser()`, not `requireAiUser()`. A
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
8. **The website gets the same Report action** on Ask ÖRZA replies and AI recipes (this build). The phone adds it next
   (§8).
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
1. **401** `unauthorized` when signed out.
2. **429** `rate_limited` (with `Retry-After`) after 10 reports in a minute: "You've sent several reports in a row.
   Please try again in 1 minute."
3. **400** `validation` for a bad body (`kind: Choose what you're reporting`, `reason: Choose a reason`,
   `note: Keep the note under 500 characters`, …); 413 over 16 KB; 415 when not JSON; 403 `cross_site` for a cookie
   request from another site (the usual guard).
4. **404** `not_found` "We couldn't find that to report. It may have been deleted." when the item doesn't exist, isn't
   the member's, or isn't reportable (a member's own message, a manual meal).
5. **429** `rate_limited` "You've sent a lot of reports today. Thank you, the team will look at them." when the
   account already reported 30 other items in the last 24 hours (changing a report already counted is always allowed).
6. **201** for a first report, **200** when it replaced the member's earlier report of the same item:

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
- Sent: toast "Report sent" with "Thanks. The ÖRZA team will review it."
- Errors: the server's text (404, 429), offline "We couldn't reach ÖRZA. Check your connection and try again."

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

---

## 8. Phone follow-up (next step)

- A `features/ai/report.ts` client (`POST /ai/reports`, the body above), a shared Report sheet with the §5 copy, and
  "Report" next to:
  1. every ÖRZA reply in Ask ÖRZA (`kind: "chat"`, the message id) — **required for the Play release**;
  2. an AI recipe (`source === "ai"`) — **required**;
  3. an AI rebalance plan (`plan.ai`), the Snap result before Save (`scan`, `scan.id`) and a typed or spoken meal's
     result card when it shows the AI's note (`meal`) — where the screen shows the AI's text.
- No consent gate (§0.3). Offline: the usual network line, nothing queued.
- Play Console: mention the in-app reporting in the app content answers (D3).

---

## 9. Open questions for the user

1. The §5 copy and the proposed privacy-page line.
2. Pushing `ai-report-backend` live (adds the endpoint, the admin page and the website's Report action).
