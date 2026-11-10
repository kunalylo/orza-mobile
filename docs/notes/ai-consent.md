# App-wide AI consent: plan

Date: 2026-11-10. Status: **mobile and backend built and reviewed** (AM1–AM6 `ba22911`, `830283c`, `96a58c1`;
AB1–AB4 `web: c2604c4`; AR fixes `web: 5e0e097` and the mobile AR commit, §10.3; nothing pushed). Next: AV (§8) and the
user's answers (§11). Tick items in §10 as they are built; §10.1 is the entry-point check.

**User decision (2026-11-10, D3, App Store 5.1.2(i))**
- The phone app asks for AI consent **at first AI use**. The first time a member starts any AI feature, a one-time
  sheet names OpenAI and says what is sent. It has two buttons: Allow and Not now.
- AI features wait until the member allows them. The rest of the app works without consent: logging by hand,
  medicines, alarms, steps, water and weight.
- Once AI requests are gated, the iPhone may send automatic steps and weight (`SEND_IPHONE_HEALTH_DATA`).
- Android gets the same consent. It is one product, and Google Play's health and AI policies apply too.

**Conventions**
- Paths without a prefix are relative to `E:\aylo\orza-mobile`.
- `web:` means the backend worktree `E:\aylo\orza-backend`. Build there, on a new branch `ai-consent-backend` from
  `main` = `a3e3c0e`. Never build in `E:\aylo\orza`, the live checkout. Nothing is pushed.
- The server's AI client is `web:src/lib/ai.ts`. It calls `https://api.openai.com/v1/chat/completions` with the
  key from the env.
- **On resume:** read §0, then go to the first unchecked step in §10.

---

## 0. Decisions on one screen

1. **One consent per account, stored on the server.**
   - The record is `users.ai_consent = {version, at}`. A member is asked once across phones, and the web can read it
     later.
   - Every `{user}` answer carries `ai_consent`: the object, or `null` when there is no consent. The field being
     there tells the app that the server knows about consent.
   - Consent is set with `PUT /api/settings/ai-consent {version}` and withdrawn with `DELETE` (§5).
   - `AI_CONSENT_VERSION = 1` in both repos. A material change to what is sent (a new data type, provider or
     purpose) bumps the version in both repos, and every member is asked again.
2. **The server enforces it for the phone app (R1).**
   - This covers six routes: `chat/send`, `meals/text`, `meals/scan`, `recipes/generate`, `compensation/plan` and
     `prescriptions/scan`.
   - An app request comes from a Bearer app session (`kind: "mobile"`) or carries `X-ORZA-Client: mobile`.
   - When the account has no consent, these routes answer `403 {error, code: "ai_consent_required"}`.
   - The check runs first: before the body is read, before credits and rate limits, before `aiEnabled()`, and
     before a photo is stored.
   - The task text said `{error: 'ai_consent_required'}`. Every ÖRZA error puts the human message in `error` and the
     machine code in `code` (the phone's `ApiError.code`), so the code goes in `code` here too.
3. **No consent means no phone health data in any AI prompt (R2).** This applies to any client, so it covers the
   website, which doesn't ask yet.
   - For an account without consent, the coach's AI prompt leaves out the tracked step count.
   - Its chat history also leaves out the built-in coach's replies, which can quote tracked steps and weight.
   - It also leaves out AI replies that were made with health data in their prompt.
   - Only the chat route puts tracked data into a prompt (§2), so only the chat route changes. The web UI is
     unchanged.
4. **The phone has one gate, `ensureAiConsent(feature)`, which every AI entry point awaits before its request.**
   - Snap & Know awaits it before the camera or gallery opens, because that photo is only for AI.
   - If the cached user has no consent, the gate re-reads `/auth/me` first. A consent given on another phone or on
     the web is then used without asking again.
   - **Allow** records the consent and the action carries on: the message sends, or the camera opens.
   - **Not now**, closing the sheet, or Android back each mean "no". The action doesn't run, a short line says why,
     and the screen stays usable.
   - As a backstop, `lib/api.ts` refuses the six AI paths locally, with the same error, while the member has no
     recorded consent. A screen that forgets the gate still sends nothing.
5. **The server's 403 is handled like the local refusal.**
   - The app clears its copy of the consent and shows the sheet.
   - After Allow, the action re-runs once.
   - `409 ai_consent_outdated` on the PUT means this app's sheet is older than the server's version. The app says
     "update the app".
6. **Never an AI request without a recorded consent.**
   - **Offline:** the sheet can open, but Allow fails with the usual offline message and nothing is sent.
   - **Old server** (no `ai_consent` field): the app never asks and never sends. A line says the AI features aren't
     available yet.
   - Nothing is stored only on the phone.
7. **Settings › Privacy & data › "AI features"** shows the state and lets the member allow or turn off.
   - Turning off makes the server refuse the phone's AI requests, and R2 applies again.
   - Nothing else changes: steps, logs, chats and plans stay.
8. **`SEND_IPHONE_HEALTH_DATA` flips to `true`, with one runtime condition.** The iPhone sends automatic
   steps and weight only to a server whose `{user}` answers carry `ai_consent`. §3.7 explains why this is safe.
   - The steps disclosure gets an AI line that names OpenAI on every path, iPhone included.
   - So does the Health screen's connect caption, on both platforms.
9. **Copy lives in a pure module** (`src/lib/aiConsent.ts`), and Node tests pin it, as `lib/steps/todayCard.ts`
   does. The user reviews all new copy and the privacy-policy lines before anything goes live (§11).

---

## 1. Store rules (checked 2026-11-10; sources at the end)

### App Store
| Guideline | What it asks for | What this plan does |
|---|---|---|
| **5.1.2(i)** | Get permission before using or sharing personal data. Clearly say where it goes to third parties ("including with third-party AI") and get **explicit** permission first. | A sheet that names OpenAI and lists what is sent. Nothing goes to OpenAI before the member taps Allow. The server enforces this (R1). |
| **5.1.1(i)** | The privacy policy names the data, its uses, the third parties, and how to revoke consent. | Proposed policy lines (§11, Q2). |
| **5.1.1(ii)** | Consent for collection, and an easy way to withdraw it. Paid functionality can't depend on giving extra data. | Settings › Privacy & data › AI features. AI credits are requested, not bought, and each feature sends only what its own answer needs. |
| **5.1.1(iii)/(iv)** | Minimise data, and offer alternatives when consent is refused. | Not now leaves the food list, manual prescription entry, and saved recipes and plans. |
| **5.1.2(vi), 5.1.3(i)** | HealthKit and Motion & Fitness data: no ads, marketing or data mining. It goes to third parties only to improve health management, only with permission. Disclose the specific health data. | The coach's advice is health management. The sheet names "steps from Apple Health or your iPhone's motion sensor, and weight from Apple Health". R1 and R2 keep this data away from OpenAI without consent. Never for ads. |

### Google Play
| Policy | What it asks for | What this plan does |
|---|---|---|
| **User Data**: prominent disclosure and consent | An in-app disclosure of the data and how it is used or shared, shown before collection. Consent needs an affirmative action. Navigating away (back, home, tapping outside) is not consent. The rule also applies to third-party AI integrations. | One sheet, shown before the first AI request. Allow is the only consent. Not now, close and back all count as "no". |
| **Health Connect**: health permissions guidance | Health data may go to a third party only with explicit, informed consent. Never for ads or sale. The privacy policy discloses sharing. | The sheet names "steps from Health Connect or this phone, and weight from Health Connect". R1 and R2 keep Health Connect totals away from OpenAI without consent. The steps disclosure's AI line now names OpenAI. |
| **Data safety** | A service provider processing data for the developer is not "sharing". | OpenAI is our service provider. Answer "collected", not "shared", and disclose OpenAI in the privacy policy (D3, §9). |
| **AI-Generated Content** | Chatbots where the chatbot is a central feature are in scope. They must let users report or flag offensive AI output inside the app. | **Not part of this build.** Ask ÖRZA has no "Report" action yet. This is a D3 follow-up (§9). |

---

## 2. Inventory: every AI entry point and what reaches OpenAI

The server has exactly six callers of `aiJSON`, the only OpenAI path (`web:src/lib/ai.ts`; `grep aiText|aiJSON`).

| Feature | Phone call site | API route (web) | Sent to OpenAI |
|---|---|---|---|
| **Ask ÖRZA** (chat) | `features/chat/api.ts` `sendChat` ← `useConversation.ts` `send()` (composer, suggestion chips, retry, `?send=` from other screens) ← `app/(app)/ask.tsx` | `POST /api/chat/send` (`lib/coach.ts` `buildContext` → `contextForPrompt`, `coachSystemPrompt`) | The message (≤ 2,000 chars). The last 12 messages of the conversation, both sides, each ≤ 800 chars; this includes built-in coach replies, which can quote **tracked steps** (`activityReply`) and **tracked weight** (`goalReply`, from Apple Health or Health Connect). The **first name**. The **profile summary**: age, sex, height, weight, goal and target weight, activity level, diet, allergies and avoids, **health notes** (`conditions`), region, language, household mode, lifestyle. Daily targets (kcal, protein, carbs, fat, fibre, water, step goal), and today's totals and what remains. **Today's meals** (type, items, kcal, protein), water glasses, and **today's tracked steps** (`tracking.steps`). **Remembered facts** (`memory`), the avoid list and tone. Local date, hour and time zone. |
| **Typed / spoken meal** | `features/meals/api.ts` `useLogMealText` ← `MealComposer.tsx` (`logText.mutate`) ← `(tabs)/meals.tsx` | `POST /api/meals/text` (`lib/meal-ai.ts` `aiParseMealText`) | The text (≤ 500 chars, typed, or spoken and turned into text by the phone's own speech recogniser). Profile hints: diet, region, language. |
| **Snap & Know** | `features/snap/api.ts` `useScanMeal` ← `(tabs)/snap.tsx` `analyse()` (photo from `pick()` or a recovered photo) | `POST /api/meals/scan` (`aiScanImage`, vision) | The **meal photo** (data URL ≤ ~6 MB; ÖRZA doesn't store it), the optional note (≤ 200), diet, region, language. |
| **Recipe ideas** | `features/recipes/api.ts` `useGenerateRecipe` ← `app/(app)/recipes.tsx` (`generate.mutateAsync`) | `POST /api/recipes/generate` (`requestAiRecipe`) | The request (≤ 300 chars), cuisine and calorie cap. Diets: from the profile, learned in chat, and from the request. Allergies and avoids: profile, memory, request. Region, goal, daily targets (kcal, protein, fibre), household mode, and the titles of the last 12 recipes. |
| **Rebalance plan** | `features/rebalance/api.ts` `useCreatePlan` ← `RebalanceForm.tsx` (`create.mutateAsync`) ← `rebalance.tsx` | `POST /api/compensation/plan` (`requestRewrite`) | First name, diet, allergies and avoids, region, language, tone, goal. The occasion (≤ 80) and what they ate (≤ 500). The built-in plan: extra kcal, and per day the calorie target, adjustment, focus, activity (walk minutes and extra steps from the step **goal**, not tracked steps), meal ideas and draft message. |
| **Prescription scan** | `features/rx/api.ts` `rxApi.scan` / `useScanPrescription` ← `app/(app)/rx/index.tsx` `read()` | `POST /api/prescriptions/scan` (`lib/care/prescription-ai.ts` `aiScanPrescription`, vision) | The **prescription photo** and whatever is on it (patient name, doctor, diagnosis, medicines). ÖRZA stores it as media before the call. Also a Hindi or Hinglish hint, and the listed **allergies** (≤ 12). |

**Common to all six**
- Each request carries ÖRZA's system prompt plus `WELLNESS_GUARDRAIL`.
- There is no account id or email in the OpenAI body, and no name beyond the first name.
- The model is `OPENAI_MODEL` or `OPENAI_VISION_MODEL` (default `gpt-4o-mini`).

**Never sent to OpenAI**
- Email, password, phone number.
- The medicine list, doses, alarms and reminders.
- Sleep and resting heart rate (`health_days`).
- `tracking.weight_kg` directly. It travels only inside built-in replies kept in the chat history.

**Not AI (checked, needs no consent)**
- Onboarding (`/onboarding/step` is deterministic) and Today's insight.
- Daily and weekly reports, goals.
- Meals: manual entry, food search, scan confirm.
- Medicines, including photos; prescription manual entry and apply.
- Steps, health, reminders, calendar, credits.
- Reading past chats, recipes, plans or scans.
- Speech recognition. It is the phone's own service (Apple or Google) under its own OS permission; the text it
  produces goes to OpenAI only when the member sends it.

The web privacy page lists "report insights" as an AI feature, but no code does that (§11, Q2).

---

## 3. Design

### 3.1 Server record and endpoint (web)
- `User.ai_consent?: {version: number; at: string} | null` (`web:src/lib/types.ts`, new type `AiConsent`).
  - Absent or `null` means no consent.
  - `at` is the server's clock (ISO) at the last Allow.
- `toPublicUser` sets `ai_consent: u.ai_consent ?? null`, so the field is in every `{user}` answer: `/auth/me`,
  login and register, `/profile`, `/settings/*`, and the export.
- `web:src/lib/ai-consent.ts` (new):
  - `AI_CONSENT_VERSION = 1`
  - `hasAiConsent(user)`: `typeof user.ai_consent?.version === "number" && version >= AI_CONSENT_VERSION`
  - `requireAiUser()`: R1, below
- `web:src/app/api/settings/ai-consent/route.ts` (new), for any signed-in session, cookie or Bearer:
  - `PUT {version}`: zod, a whole number from 1 to 1000. A version below `AI_CONSENT_VERSION` gets **409**
    `ai_consent_outdated`. Otherwise it sets `ai_consent = {version, at: nowISO()}` and `updated_at`, and answers
    `{user}`. A second PUT refreshes `at`.
  - `DELETE`: `$unset ai_consent` and answers `{user}` with `ai_consent: null`. It is idempotent.
- `preferences.ai_training_opt_out` ("Help improve ÖRZA's AI") is separate and doesn't change. Neither setting
  changes the other.

### 3.2 Server enforcement
- **R1, phone app.**
  - `requireAiUser()` = `getCurrentSession()` (the same single read `requireUser` does).
  - It throws 401 when signed out.
  - It treats the request as an app request when `via === "bearer" && session.kind === "mobile"`, or when
    `x-orza-client` is `mobile` (`session-token.ts` `CLIENT_HEADER`).
  - For an app request without `hasAiConsent(user)` it throws
    `new HttpError(403, "Allow ÖRZA's AI features in the app to use this.", "ai_consent_required")`.
  - Otherwise it returns `user`.
  - The six routes call it **instead of `requireUser()`**, as their first line. In `meals/scan` and
    `prescriptions/scan` it comes before `aiEnabled()` and `parseBody`.
  - Nothing is written, no credits move, no photo is saved, and the six-MB body is never read.
  - It applies **even when AI is off.** The emulator tests run with AI off (0 AI calls) and still exercise the gate.
- **R2, any client** (only `chat/send` carries tracked data). Let `consented = hasAiConsent(user)`.
  - `contextForPrompt(ctx, {steps: consented})`. Without consent, the line reads
    `Water {w}/{t} glasses · step goal {goal}.` and has no tracked count.
  - `aiHistory(earlier, consented)` (pure, `lib/coach.ts`). With consent it is everything. Without consent it keeps
    user turns, plus assistant turns with `meta.ai === true && meta.health === false` (AR review, §10.3).
  - It drops the built-in coach's replies, which quote tracked steps and weight.
  - It also drops AI replies made with health data in the prompt, so a withdrawal is respected in later web turns.
  - Every AI reply is stored with `meta.health = consented`. Add `health?: boolean` to `ChatMessage.meta`.
  - Old AI replies have no flag, and they are dropped too: their prompt had the day's tracked steps (an Android
    phone's Health Connect or motion count among them), which they can repeat. (The first build kept them.)
  - The built-in (free) coach still uses `ctx.tracking`, because nothing leaves the server for that.
  - The web coach of a member without consent no longer knows today's step count (§11, Q1).

### 3.3 The phone's gate
- `src/lib/aiConsent.ts` is pure, so `node --test` can load it. It imports types only.
  - `aiConsentState(user, version = AI_CONSENT_VERSION)` gives one of:
    - `'unsupported'`: the field is `undefined` (old server or an old snapshot);
    - `'allowed'`: `ai_consent.version` is a number ≥ `version`;
    - `'ask'`: anything else (`null`, malformed, or a lower version).
  - `gateStep(state, {refreshed, refused})` gives one of:
    - `'ask'` when `refused` (a server or backstop refusal: never trust the cache then);
    - `'go'` when allowed;
    - `'refresh'` when not yet refreshed;
    - `'ask'` (state ask) or `'unavailable'` (state unsupported) after the refresh.
- **Backstop** in `lib/api.ts`: `setAiConsentAllowed(boolean)`.
  - `AuthProvider` sets it whenever the user in state changes (`applyUser`, `setUser`, sign-out → false).
  - In `request()`, while it is false, `isAiPath(path)` throws
    `ApiError(403, {code: 'ai_consent_required'})` before `fetch`.
  - `isAiPath` matches the six paths, with or without `/api`, ignoring the query and a trailing slash.
    `/meals/scan/<id>/confirm`, `/prescriptions/<id>/apply` and `/recipes/<id>/save` don't match.
- **`src/features/ai/consent.ts`**, a small store. `AiConsentHost` (mounted once in `app/(app)/_layout.tsx` next to
  `AlarmPermissionPrompt`) subscribes to it. None of the six entry points sits inside another sheet, so one
  global sheet is safe.
  - `ensureAiConsent(feature): Promise<boolean>` never throws.
    - Fast path: the backstop says allowed, so it resolves `true`.
    - Otherwise the host runs `gateStep`:
      - `refresh`: `useAuth().refresh()`, at most 6 s. Offline keeps the snapshot.
      - `ask`: open the sheet. Allow resolves `true`; Not now, close or back resolve `false`.
      - `unavailable`: resolve `false` and show the unavailable line.
    - Concurrent calls share one pending promise.
  - `onAiRefusal(e, feature, retry?)` returns `true` when `isAiConsentRefusal(e)`. It then sets
    `ai_consent: null` on the user copy (backstop false), opens the sheet with `refused: true`, and on Allow runs
    `retry` once.
  - `useAiDeclined(feature)` gives `{declined, unavailable}` for `<AiDeclinedNote feature>`. A decline is set when
    the gate resolves `false` for that feature, and every Allow clears all of them.
- **The sheet's Allow** sends `PUT /settings/ai-consent {version: AI_CONSENT_VERSION}` (`features/ai/api.ts`).
  - Its button shows a spinner meanwhile, and the sheet can't be dismissed while it waits.
  - On 200: `setUser(res.user)`. The backstop then opens, the sheet closes, and the gate resolves `true`.
  - On failure the sheet stays open with a line: `errorMessage(e)`, or for 409 the outdated line. Closing it then
    resolves `false`.
  - The sheet comes up while a button's own spinner isn't running yet: the gate runs before the mutation starts.

### 3.4 Entry points (gate → request; Not now; 403)
Order in each: local validation first (empty, too long), then `await ensureAiConsent(f)`, then the request. Each
request's `onError` starts with `if (onAiRefusal(e, f, retry)) return;`.

| Feature (`f`) | Gate | Not now | Retry after a 403 + Allow |
|---|---|---|---|
| `chat` | `useConversation.send()` after the length check, before `pending` is set. The text stays in the composer. | `<AiDeclinedNote feature="chat">` above the composer. Past chats stay readable. | Re-send the same text. |
| `meal_text` | `MealComposer` before `logText.mutate` (typed and spoken). | The note under the composer. The food list button stays. | Re-submit. |
| `snap` | `pick(source)` before the camera or gallery opens. `analyse()` also gates (the backstop for a recovered photo). | A ProblemPanel kind `ai_consent` (`features/snap/types.ts`, `scanProblem`) with "Allow AI features" plus the food-list way. | `analyse()`. |
| `recipe` | `recipes.tsx` before `generate.mutateAsync`. | The note above the generator. Saved recipes stay. | Generate again. |
| `rebalance` | `RebalanceForm` before `create.mutateAsync`. | The note above the button. Past plans stay. | Create again. |
| `rx` | `rx/index.tsx` `read()` only. The photo may also go to manual entry ("Type instead"), so picking it is not AI. | ProblemPanel kind `ai_consent` (`features/rx/problem.ts`) with "Type the medicines instead". | `read()`. |

`features/chat/ai.ts` `aiErrorInfo` returns `needsConsent: true` for the code. That way a screen that only shows
`aiErrorInfo(e).message` still shows the declined line, not the server's text.

### 3.5 Settings › Privacy & data › AI features
- `AiFeaturesRow` (`features/ai/AiFeaturesRow.tsx`) goes right after `StepsSwitchRow` in `settings.tsx`. It has
  `icon="mci:creation"` and title "AI features". Its subtitle comes from `aiSettingsSubtitle(state)`.
- Tapping it opens a manage sheet: a status line, the same "what is sent" points, the privacy link, and one footer
  button.
  - **On:** "Turn off AI features". An inline confirm follows (§4), then `DELETE` → `setUser` → a toast.
  - **Off:** "Allow AI features", which is the sheet's Allow.
  - **Unsupported:** no button, just the unavailable line.
- Turning off changes nothing else: steps keep counting, and the history stays.

### 3.6 Edge cases
- **Offline with no consent:** the sheet opens and Allow fails with the network line. Nothing is sent.
- **Offline with consent:** AI requests fail as they do today.
- **Old server or an old snapshot (`unsupported`):** after the refresh it stays unsupported, so there is no sheet
  and no request. The note says the AI features aren't available yet.
  - **The backend must ship before the app build.**
- **Stale "allowed" on phone B** after a withdrawal on phone A or the web: B sends, the server answers 403, and
  `onAiRefusal` shows the sheet. The server is the authority.
- **Allowed elsewhere:** the gate's refresh finds it, so this phone doesn't ask.
- **Version bump on the server:**
  - A member with consent at the old version gets a 403, then the sheet. Allow sends the PUT.
  - An app with the old copy gets 409 and the line "update the app". There is no loop: the retry runs only after a
    200.
- **Sign-out or another member on the same phone:** the backstop follows the signed-in user, and consent is per
  account, so each member is asked separately.
- **Account deletion** removes the record with the user.
- **Admins** don't use the member app.
- **Credits:** consent comes first. With 0 credits, the request after Allow gets 402 as today.
- **AI off on the server:** the gate still asks, because the server checks consent first. After Allow, the routes
  fall back as today (built-in coach, food list, library recipe, built-in plan; scans 503 `ai_disabled`).

### 3.7 Flipping `SEND_IPHONE_HEALTH_DATA` (why it is safe now)
- **What flips**
  - `health/types.SEND_IPHONE_HEALTH_DATA = true`.
  - Plus `iphoneSendsHealthData(serverHasAiConsent)` = flag && `aiConsentState(member) !== 'unsupported'`.
  - `lib/steps/sync.ts` computes `hold` per run from the member the run is for, using the snapshot or the
    background `/auth/me`. `lib/health/sync.ts` passes the same value to `importMetrics('ios', …)`.
  - Days younger than 72 h that were held get saved (R5a). The iPhone's Health weight then comes in.
- **Why it is safe**
  - **From the phone:** an iPhone member's steps and weight reach OpenAI only inside an Ask ÖRZA request. The
    server refuses that request without the account's recorded consent (R1), and the app asks first. The sheet
    names OpenAI and the specific health data, which satisfies 5.1.2(i) and 5.1.3(i).
  - **From the website** (no ask yet): R2 leaves the tracked step count and the replies that quote tracked steps or
    weight out of every AI prompt for an account without consent.
  - **After a withdrawal:** both rules apply again, including to AI replies made with health data.
  - **The other five AI routes** never include tracked steps or weight (§2). Sleep and resting heart rate never
    reach AI. HealthKit data is never used for ads or marketing.
  - **An old server** (no field) receives nothing automatic from an iPhone, which closes the "dev build against an
    un-updated server" gap.
- Android was already sending. With R1 and R2, its Health Connect totals now also reach OpenAI only with consent.

### 3.8 The website
- No UI change in this build. Web requests are never refused, and only R2 changes what the web coach sends.
- The web can later read `user.ai_consent`, ask with the same sheet copy, and call the same endpoint. The server
  would then enforce R1 for every client. Whether, and when, is §11, Q1.

---

## 4. Copy (exact strings; the user reviews them, §11 Q2)

### The consent sheet (`consentCopy(feature, platform)`)
- **Eyebrow:** "AI features"
- **Title:** "Allow ÖRZA's AI features?"
- **Lead (per feature), then the shared sentence:**

| `feature` | First sentence |
|---|---|
| `chat` | "Ask ÖRZA answers with AI." |
| `meal_text` | "ÖRZA reads typed and spoken meals with AI." |
| `snap` | "Snap & Know reads your meal photo with AI." |
| `recipe` | "ÖRZA writes new recipes with AI." |
| `rebalance` | "ÖRZA personalises rebalance plans with AI." |
| `rx` | "ÖRZA reads prescription photos with AI." |
| `settings` | none |

The shared sentence is: "These features are run by OpenAI, our AI provider. When you use one, ÖRZA sends OpenAI
only what that request needs:"

- **Points** (icon, text):
  1. `camera`: "Meals — your meal photo, or the words you type or say, with your diet, region and language."
  2. `message-circle`: "Ask ÖRZA — your message and the chat so far, your first name and everything in your
     profile (including age, sex, weight, diet, allergies and health notes), your targets, what ÖRZA remembers, and
     today's meals, water and steps." Then a platform sentence:
     - iOS: "Steps can come from Apple Health or your iPhone's motion sensor, and weight from Apple Health."
     - Android: "Steps can come from Health Connect or this phone, and weight from Health Connect."
  3. `mci:chef-hat`: "Recipes and rebalance plans — what you ask for, with your first name, diet, allergies,
     region, goal and targets."
  4. `file-text`: "Prescription scans — the prescription photo and the allergies you listed."
  5. `lock`: "Never your account’s email, password or phone number, your saved medicines and alarms, or your sleep
     and heart rate." (AR review: "account’s" and "saved", because a prescription photo shows its medicines and a
     photo or message can show anything.)
- **After the points:**
  - "ÖRZA shares this only to answer you — never for ads, and it's never sold."
  - "Everything else works without AI: the food list, medicines and alarms, steps, water and weight."
  - "Turn AI features off any time in Settings › Privacy & data."
- **Link:** "How ÖRZA uses AI" opens `openWeb('/privacy#ai-processing')`
  (`https://orza-nine.vercel.app/privacy#ai-processing` in production builds).
- **Buttons:** "Allow" (primary, `variant="energy"`, `haptic="firm"`) and "Not now" (secondary, ghost).
- **While saving, then on error:**
  - Network: `NETWORK_MESSAGE` or `TIMEOUT_MESSAGE`.
  - 409: "This version of ÖRZA can't turn on AI features. Please update the app."
  - Anything else: "Couldn't save your choice. Please try again."

### Not now (`declinedLine(feature)`), plus a link button "Allow AI features"
| `feature` | Line |
|---|---|
| `chat` | "Ask ÖRZA needs AI features. Your earlier chats are still here." |
| `meal_text` | "Typing or speaking a meal needs AI features. You can still add foods from the food list." |
| `snap` | "Snap & Know needs AI features. You can still log your meal from the food list." |
| `recipe` | "New recipes need AI features. Your saved recipes are still here." |
| `rebalance` | "New rebalance plans need AI features. Your earlier plans are still here." |
| `rx` | "Reading a prescription needs AI features. You can type the medicines instead." |

- Old server (`AI_UNAVAILABLE`): "ÖRZA's AI features aren't ready for this app yet. Please try again later."
- Server 403 `error` text: "Allow ÖRZA's AI features in the app to use this." The server 409 text is "This version
  of the app can't turn on AI features. Please update ÖRZA."

### Settings
- **Row:** "AI features". Subtitle by state:
  - allowed: "On · run by OpenAI"
  - ask: "Off · ÖRZA asks before the first use"
  - unsupported: "Not available yet"
- **Manage sheet:** eyebrow "Privacy & data", title "AI features". Status line:
  - allowed: "On since {d MMM yyyy}"
  - ask: "Off"
- **Turn-off confirm:** title "Turn off AI features?", body "Ask ÖRZA, Snap & Know, typed and spoken meals,
  recipes, rebalance plans and prescription scans stop in the app until you allow them again. Your meals, chats and
  plans stay." Buttons "Turn off" (destructive) and "Keep on".
- **Toasts:** "AI features are off in the app. ÖRZA will ask before using them again." ("in the app": the website
  doesn't ask yet, §11 Q1) and "AI features are on." (Allow from Settings only).
- **The group footer stays.** It is the web's wording, still true: "… for example with our AI provider when you use
  an AI feature …".

### Steps and health (replaces the R/U line)
- `todayCard.ts` `AI` on **every** disclosure path, iPhone included: "If you allow AI features, your step totals go
  with your Ask ÖRZA chats to OpenAI, our AI provider."
- `ConnectCard.tsx` caption, **both platforms**: "You choose exactly what to share on the next screen. Only daily
  totals are saved to your ÖRZA account — if you allow AI features, your steps and weight go with your Ask ÖRZA
  chats to OpenAI — and you can disconnect any time."
- **iOS purpose strings** (`app.json`, iOS rebuild only, after the user reviews them):
  - `NSHealthShareUsageDescription`: "ÖRZA reads your steps, sleep, resting heart rate and weight from Apple Health
    to fill in Today and your Health trends. Only daily totals are saved to your ÖRZA account. If you allow AI
    features, steps and weight also go with your Ask ÖRZA chats."
  - `motionPermission`: "ÖRZA uses your iPhone's motion data to count your steps when Apple Health has none, and
    saves each day's total to your ÖRZA account. If you allow AI features, they also go with your Ask ÖRZA chats."

---

## 5. API contract (both builders follow this)

| | Request | Answers |
|---|---|---|
| Read | Any `{user}` answer (`GET /api/auth/me`, `GET /api/profile`, login, register, `PUT /api/settings/*`, export) | `user.ai_consent: {version: number, at: ISO string} \| null`, **always present** on the new server |
| Allow | `PUT /api/settings/ai-consent` `{version: int}` (JSON; cookie or Bearer) | **200** `{user}` (`ai_consent = {version, at: now}`) · **400** `{error, code:"validation"}` (missing, not a whole number, < 1, > 1000) · **401** · **409** `{error, code:"ai_consent_outdated"}` when `version < AI_CONSENT_VERSION` |
| Withdraw | `DELETE /api/settings/ai-consent` (no body) | **200** `{user}` (`ai_consent: null`), idempotent · **401** |
| AI routes | `POST /api/chat/send`, `/api/meals/text`, `/api/meals/scan`, `/api/recipes/generate`, `/api/compensation/plan`, `/api/prescriptions/scan` | For an **app request** (Bearer app session `kind:"mobile"`, or `X-ORZA-Client: mobile`) without consent: **403** `{error:"Allow ÖRZA's AI features in the app to use this.", code:"ai_consent_required"}`. It comes right after 401 and before 400, 402, 429 and 503. Nothing is stored or spent. Cookie (website) requests are never refused. |

- **Allowed:**
  - server: `ai_consent.version >= web AI_CONSENT_VERSION`;
  - app: `>= app AI_CONSENT_VERSION`.
  - Both constants are 1. They change together.
- **R2:** `chat/send` without consent, from any client, sends no tracked step count and the filtered history (§3.2).
  Every AI reply is stored with `meta.health = consented`; without consent only `false` ones stay in the history.
- **The phone:**
  - `ApiError.status === 403 && code === 'ai_consent_required'` means show the sheet;
  - `409 && 'ai_consent_outdated'` means update the app;
  - `ai_consent === undefined` means the old server: no AI, no automatic iPhone health data.

---

## 6. Files

### Backend: `E:\aylo\orza-backend`, branch `ai-consent-backend`
- `src/lib/types.ts`: `AiConsent`, `User.ai_consent?: AiConsent | null`, `ChatMessage.meta.health?: boolean`.
- `src/lib/ai-consent.ts` (new): `AI_CONSENT_VERSION`, `hasAiConsent`, `requireAiUser`.
- `src/lib/auth.ts`: `toPublicUser` adds `ai_consent: u.ai_consent ?? null`.
- `src/app/api/settings/ai-consent/route.ts` (new): `PUT`, `DELETE`, `export const dynamic = "force-dynamic"`.
- The six AI routes, where `requireAiUser()` replaces `requireUser()` as the first line:
  - `src/app/api/chat/send/route.ts` (this one also gets R2);
  - `src/app/api/meals/text/route.ts`;
  - `src/app/api/meals/scan/route.ts` (moved above `aiEnabled()`);
  - `src/app/api/recipes/generate/route.ts`;
  - `src/app/api/compensation/plan/route.ts`;
  - `src/app/api/prescriptions/scan/route.ts`.
- `src/lib/coach.ts`: `contextForPrompt(ctx, {steps})`, `coachSystemPrompt(ctx, history, {steps})`,
  `aiHistory(messages, consented)`, `ChatMessageRecord.meta.health`.
- `SPEC.md`: an "AI consent" bullet in Account (record, endpoint, R2) next to "AI improvement", and the 403 in
  "Mobile app".
- `scripts/check-ai-consent.mjs` (new), §7.
- **Not changed:** the privacy page (§11, Q2: the user reviews first), the web settings UI, the web chat UI.

### Mobile: `E:\aylo\orza-mobile`
- `src/lib/aiConsent.ts` (new, pure):
  - `AI_CONSENT_VERSION`, `AiFeature`, `aiConsentState`, `gateStep`, `AI_PATHS`, `isAiPath`;
  - `isAiConsentRefusal`, `isAiConsentOutdated` (duck-typed on `{status, code}`, so tests don't load `expo-device`);
  - `consentCopy`, `declinedLine`, `AI_UNAVAILABLE`, `aiSettingsSubtitle`, `AI_PRIVACY_PATH = '/privacy#ai-processing'`.
- `src/lib/types.ts`: `AiConsent`, `PublicUser.ai_consent?: AiConsent | null`.
- `src/lib/api.ts`: `setAiConsentAllowed`, plus the backstop in `request()`.
- `src/lib/auth.tsx`: keeps the backstop in step with the user in state.
- `src/features/ai/` (new):
  - `consent.ts` (store: `ensureAiConsent`, `onAiRefusal`, `useAiDeclined`);
  - `api.ts` (PUT and DELETE);
  - `AiConsentHost.tsx` and `AiConsentSheet.tsx` (StepsDisclosure's point style, `Sheet`, footer buttons);
  - `AiDeclinedNote.tsx`;
  - `AiFeaturesRow.tsx` (row plus manage sheet).
- `src/app/(app)/_layout.tsx`: `<AiConsentHost />`.
- Entry points:
  - `src/features/chat/useConversation.ts` and `src/app/(app)/ask.tsx`, `src/features/chat/ai.ts`;
  - `src/features/meals/MealComposer.tsx`;
  - `src/app/(app)/(tabs)/snap.tsx`, `src/features/snap/{types.ts,api.ts,Panels.tsx}`;
  - `src/app/(app)/recipes.tsx`;
  - `src/features/rebalance/RebalanceForm.tsx`;
  - `src/app/(app)/rx/index.tsx`, `src/features/rx/{problem.ts,ProblemPanel.tsx}`.
- `src/app/(app)/settings.tsx`: `<AiFeaturesRow />`.
- `src/lib/health/types.ts`: the flag set to `true`, `iphoneSendsHealthData`, docs.
- `src/lib/steps/sync.ts` and `src/lib/health/sync.ts`: the runtime hold.
- `src/lib/steps/todayCard.ts`: the AI line on every path.
- `src/features/health/ConnectCard.tsx`: the caption.
- `app.json`: the two iOS purpose strings, only after the user reviews them.
- Tests:
  - `scripts/tests/ai-consent.test.ts` (new) and `package.json` `"test:ai"`;
  - `scripts/tests/health-import.test.ts` and `scripts/tests/steps-card.test.ts` (updated).
- `docs/PROGRESS.md` and this note.

---

## 7. Tests

### Mobile: `npm run test:ai` (new, `npx --yes tsx --test scripts/tests/ai-consent.test.ts`)
- **A1 `aiConsentState`:**
  - `undefined` → unsupported; `null` → ask; `{version:1}` → allowed; `{version:2}` (app at 1) → allowed;
    `{version:0}` → ask;
  - malformed (`'yes'`, `{}`, `{version:'1'}`, `{version:NaN}`) → ask;
  - a user that is `null` → unsupported.
- **A2 `gateStep`:**
  - allowed → go;
  - ask or unsupported, not yet refreshed → refresh;
  - after the refresh: ask → ask, unsupported → unavailable, allowed → go;
  - `refused` → ask, even when the state says allowed.
- **A3 `isAiPath`:**
  - the six paths, also with `/api/…`, a query or a trailing slash, are true;
  - `/chat/history`, `/chat/sessions`, `/meals/manual`, `/meals/scan/x/confirm`, `/prescriptions/x/apply`,
    `/prescriptions`, `/recipes/x/save` and `/compensation` are false.
- **A4 refusal and outdated detection:**
  - 403 with `ai_consent_required` → refusal;
  - 403 `forbidden`, 401, 409 and `null` are not refusals;
  - 409 `ai_consent_outdated` → outdated.
- **A5 copy:**
  - every feature has a lead and a declined line;
  - the lead names "OpenAI";
  - the iOS chat point names Apple Health and the motion sensor; the Android one names Health Connect;
  - the "Never…" point is there, the buttons are "Allow" and "Not now", and `AI_PRIVACY_PATH` is
    `/privacy#ai-processing`;
  - the settings subtitles are right.
- **A6 `iphoneSendsHealthData`:** true for allowed and ask, false for unsupported (old server).
- **Updated tests**
  - `health-import.test.ts`: `SEND_IPHONE_HEALTH_DATA === true`. `importMetrics('ios', true)` keeps weight, and
    `importMetrics('ios', iphoneSendsHealthData(false))` drops it.
  - `steps-card.test.ts`: the new AI line on all 8 paths, iPhone included.
  - `test:steps` and `test:alarms` stay green.
- Before every mobile commit: `npm run typecheck`, `npx expo lint`, `npm run test:steps`, `npm run test:alarms`,
  `npm run test:ai`.

### Backend: `npm run typecheck`, then `scripts/check-ai-consent.mjs` (the `check-steps-modes.mjs` pattern)
- It runs only against a local host. Run it on `npx next dev -p 3101` in `E:\aylo\orza-backend`.
  - That worktree has **no `.env.local`**: a JSON-file database and no OpenAI key, so AI is off.
  - Then run `ORZA_BASE_URL=http://localhost:3101 node scripts/check-ai-consent.mjs`.
- **0 AI calls by construction.** Every AI-route call either expects the 403 or sends a body zod refuses, so it never
  reaches `aiJSON`, even with a key. The bodies are:
  - `{message:""}`, `{text:"a"}`, `{image:"x"}`, `{max_calories:5}`, `{occasion:"x"}` and `{image:"x"}`.
- It signs up a throwaway `ai-consent-check-…@orza.test` with `X-ORZA-Client: mobile`. The checks:
  1. `/auth/me` gives `ai_consent === null` (the field is present).
  2. Each of the six with Bearer and the header gives 403 `ai_consent_required`.
  3. Bearer **without** the header still gives 403 (session kind).
  4. PUT: `{}` → 400, `{version:0}` → 400, `{version:1.5}` → 400, `{version:1}` → 200 with `{version:1, at}`.
     `/auth/me` shows it.
  5. The six give 400 `validation` now, or 503 `ai_disabled` for `meals/scan` with AI off. Not 403.
  6. DELETE → 200 with `null`, and the six give 403 again. A second DELETE → 200.
  7. A website cookie session (login without the header, `Origin` = base) on the same account without consent:
     `chat/send` with `{message:""}` → 400, not 403. The web is unchanged.
- The check exits 1 on any failure.
- R2 has no HTTP check without an AI call. `aiHistory` and `contextForPrompt` are pure. Review them, and run
  `npm run typecheck`.

---

## 8. Emulator test plan (later; Android emulator, release-type test build as in V1)

**Setup**
- Put the backend branch on the local test server `E:\aylo\orza-localtest`.
- **Start it with `OPENAI_API_KEY` set to an empty string in the process env.** Its `.env.local` holds a real key,
  and Next keeps a variable that is already set, even an empty one.
- Check `GET /api/credits/balance` → `ai_enabled: false` before any AI action.
- Run `check-release-apk.sh` (SAFE) and `verify-local-bundle.mjs`.
- Use a new QA account for AC-1.
- Use `scripts/e2e/api.mjs` for server-side changes.

| Case | Steps | Pass |
|---|---|---|
| AC-1 first use, each entry point | New account. Try chat send, typed meal, spoken meal, Snap "Take photo", recipe, rebalance, Rx "Read". | The sheet opens **before** any request (the server log has no call to the route). The Snap camera doesn't open first. |
| AC-2 Not now | Not now, then close, then Android back, on each. | No request. The §4 line shows with "Allow AI features". The screen still works (food list, Type instead, saved recipes and plans, past chats). |
| AC-3 Allow | Allow on chat. | PUT 200, then the message sends (built-in coach reply, AI off). Next feature: no sheet. Snap: the camera opens after Allow. Analyse gives the 503 `ai_disabled` panel. |
| AC-4 across sessions | Withdraw with api.mjs (DELETE); allow on the web session with api.mjs (PUT). | After the PUT, the phone's next AI action doesn't ask (refresh). |
| AC-5 server refusal | Phone allowed, then api.mjs DELETE, then send in chat at once (stale cache). | 403, then the sheet. Allow re-sends once. Not now keeps the text. |
| AC-6 withdraw in Settings | Settings › Privacy & data › AI features › Turn off. | The confirm, then DELETE, then the toast. The row reads "Off · …". The next AI action asks. Steps keep counting. |
| AC-7 offline | Airplane mode, no consent: chat send, then Allow. | The network line in the sheet. No request reaches the server once back online, and nothing is queued. |
| AC-8 outdated | Temporarily set the server's `AI_CONSENT_VERSION = 2` locally (never committed); send in chat. | 403, the sheet, Allow, 409, then "This version of ÖRZA can't turn on AI features…". No loop. Revert afterwards. |
| AC-9 old server | Point the test build at a server without the field (the `a3e3c0e` build). | The AI entry points show the unavailable line. No sheet, no AI request. |
| AC-10 UI and accessibility | The sheet, notes, row and manage sheet at the default size, 360 dp and font 1.3; TalkBack. | No clipping. 48 dp targets. The title is announced as a header. The points are read in order. Back means Not now. |
| AC-11 steps copy | The steps disclosure (each reachable path) and the Health connect caption. | The new AI line naming OpenAI. |

**iPhone (D2, TestFlight; V5)**
- Automatic steps and weight now reach the server, and Today shows them.
- With no AI consent, chat on the phone asks.
- iOS swipe or backdrop on the sheet means Not now.
- The purpose strings are the reviewed ones.

---

## 9. Store declarations to add to D3

- **App Store**
  - Review notes: "AI features (run by OpenAI) ask for permission at first use. Settings › Privacy & data › AI
    features shows and withdraws it. Everything else works without it."
  - App Privacy: the data OpenAI receives as our service provider (Health & Fitness, photos, other user content),
    linked to the user, App Functionality.
  - The purpose strings from §4.
- **Google Play**
  - Data safety: collected; OpenAI is a service provider, so not "shared".
  - Re-word the Health Connect justifications. `READ_STEPS` and `READ_WEIGHT` become "…used by the AI coach only
    after the member allows AI features (OpenAI), as the app discloses".
- **Google Play AI-Generated Content (missing)**
  - An in-app way to report or flag an AI reply in Ask ÖRZA (and AI recipes) without leaving the app.
  - It needs a small backend store and a place in the admin console.
  - This is a follow-up before the Play release, not part of this build.

---

## 10. Ordered checklist (each step ≤ about 1 hour)

**Backend (`ai-consent-backend`; never pushed without the user's OK)**
- [x] **AB1.** `AiConsent` type, `toPublicUser` null default, `lib/ai-consent.ts`, `PUT`/`DELETE
  /api/settings/ai-consent`. (`web: c2604c4`.)
- [x] **AB2.** `requireAiUser()` first in the six AI routes (R1). `meals/scan` and `prescriptions/scan`: before
  `aiEnabled()` and `parseBody`. (`c2604c4`.)
- [x] **AB3.** R2 in `coach.ts` and `chat/send`: `contextForPrompt` without tracked steps, `aiHistory`,
  `meta.health`. (`c2604c4`; the AR fix `5e0e097` drops unflagged AI replies too, §10.3.)
- [x] **AB4.** `SPEC.md`, `scripts/check-ai-consent.mjs`, `npm run typecheck`, and the check against `next dev -p 3101`
  (no `.env.local`). Commit "AI consent backend: …". (`c2604c4`; 56/56, again 56/56 after `5e0e097`. The builder
  also changed the privacy page with the §11 Q2 lines: it still needs the user's review.)

**Mobile**
- [x] **AM1.** `lib/aiConsent.ts`, `test:ai` (A1–A6), `PublicUser.ai_consent`, the `api.ts` backstop plus the
  `auth.tsx` hook. (`ba22911`; `test:ai` 30/30.)
- [x] **AM2.** `features/ai/*`: store, host, sheet, PUT/DELETE, `AiDeclinedNote`. Mounted in `(app)/_layout.tsx`.
  (`830283c`.)
- [x] **AM3.** The six entry points (§3.4) and `aiErrorInfo.needsConsent`. ProblemPanel `ai_consent` on Snap and Rx.
  (`830283c`; every entry point is listed in §10.1.)
- [x] **AM4.** `AiFeaturesRow` plus the manage sheet in Settings › Privacy & data. (`830283c`.)
- [x] **AM5.** `SEND_IPHONE_HEALTH_DATA = true` plus `iphoneSendsHealthData` in steps and health sync; the §4 steps
  line and caption; `health-import` and `steps-card` tests. `app.json` purpose strings only after the user's review.
  (`ba22911`, caption `830283c`. **`app.json` is not changed**: the two §4 iOS purpose strings wait for the user's
  review.)
- [x] **AM6.** typecheck, lint, `test:steps` (419), `test:alarms` (69), `test:ai` (30), and an Android JS bundle
  export. Commits "AI consent AM1 + AM5 core: …", "AI consent AM2-AM5: …" and the review fixes.

**Then**
- [x] **AR.** Review (wiring, consent UX, the no-leak paths R1/R2/backstop). Fix. (Both sides; findings and what
  changed in §10.3. `web: 5e0e097`, mobile: the AR commit.)
- [ ] **AV.** §8 on the emulator (needs a local server with AI off). Record results here.
- [ ] **AU.** The user answers §11. Privacy lines and copy are approved, then the backend push is OK'd. Backend
  deploys **before** any app build that has the flag flipped reaches testers.

---

### 10.1 Every AI entry point goes through the gate (AM3 check, 2026-11-10)

A `grep` of `src/` for the six paths finds exactly six call sites (§2), all below. Each one awaits
`ensureAiConsent(f)` after its own checks and before its request. Its error handling starts with
`onAiRefusal(e, f, retry)`. Behind them, `lib/api.ts` `request()` refuses all six paths while the member has no
recorded consent (A3).

- [x] **Backstop**: `lib/api.ts` `request()` refuses `isAiPath(path)` while `setAiConsentAllowed(false)`. This covers
  any method and any caller. `AuthProvider` keeps it in step (`showUser`, `applyUser`, `setUser`), and `clearLocal`
  closes it.
- [x] **`chat`** `POST /chat/send` (`features/chat/api.ts` `sendChat`), called only from `useConversation.send()`:
  - [x] the composer's send button and keyboard send (`sendInput`). Voice too: the phone's speech recogniser only
    fills the composer;
  - [x] starter questions (`pickStarter`, `send: true`) and quick actions (`runQuickAction` with a prompt);
  - [x] Retry on a "Not sent" bubble (`retry` → `send`);
  - [x] after a server 403: the message stays "Not sent", the sheet opens, and Allow re-sends it once;
  - [x] `?q=` only pre-fills the composer (no send). Today's insight and quick action only open Ask ÖRZA.
- [x] **`meal_text`** `POST /meals/text` (`useLogMealText`), called only from `MealComposer.submit()`: the "Log meal"
  button and the keyboard's send key, typed or spoken. The food list (`/meals/manual`) is not AI.
- [x] **`snap`** `POST /meals/scan` (`useScanMeal`), from `snap.tsx`:
  - [x] before the camera or gallery opens: `pick()` → `preparePhoto(…, consent = true)`. This covers Take photo,
    Choose from gallery, Retake, Gallery, the permission panel's Allow access and other source, and the error panel's
    Use another photo;
  - [x] before the request: `runAnalyse()`. This covers Analyse, the note's Go key, Try again on the error,
    no-credits and slow-down panels, and a photo recovered after Android restarted the app (it skips `pick`);
  - [x] scan confirm (`/meals/scan/<id>/confirm`) is not AI.
- [x] **`recipe`** `POST /recipes/generate` (`useGenerateRecipe`), called only from `recipes.tsx` `runGenerate()`:
  Generate recipe, and "Another" on the result card. Save (`/recipes/<id>/save`) and logging a recipe are not AI.
- [x] **`rebalance`** `POST /compensation/plan` (`useCreatePlan`), called only from `RebalanceForm.submit()` (Create
  my plan, after its own field checks).
- [x] **`rx`** `POST /prescriptions/scan` (`useScanPrescription` → `rxApi.scan`), called only from `rx/index.tsx`
  `read()`: Read prescription, and Try again on the problem panel. Take photo, Upload, Type the medicines instead,
  manual entry and apply are not AI.
- [x] **Not AI (no gate)**: onboarding, Today's insight, reports, goals, food search, manual meals, scan confirm,
  medicines (photos too), prescription manual entry and apply, steps, health, reminders, calendar, credits, reading
  past chats, recipes, plans or scans, and speech recognition.

### 10.2 Build notes (mobile, 2026-11-10): where the build refines §3

- **Only the consent's own answers change the user copy's consent.** `setUser(user, {aiConsent: true})` (the PUT and
  DELETE answers, a server refusal), sign-in and `/auth/me` set it.
  - A screen's copy keeps the consent in state. An example is `{...user, credits}` from a mutation that started
    before an Allow.
  - A `/auth/me` answer that was in flight across a change on this phone keeps it too (`auth.tsx` `keepAiConsent`,
    `consentChangedAt`).
  - Without this, the first AI answer after Allow could close the backstop again and show "Off" in Settings.
- **The backstop's own refusal is marked local** (`ApiError.data = {local: true}`, `isLocalAiRefusal`).
  - It runs the ordinary gate (refresh first), not `refused: true`. Nothing reached the server, so its cache isn't
    known to be wrong, and an old server never gets a sheet whose Allow can't save.
  - A server 403 still skips the cache.
- **`runAiGate` (pure, tested) is the whole gate.**
  - A copy that says "allowed" while the backstop is closed is not trusted.
  - The sheet's "true" counts only once the backstop opened, so a refusal's retry can't loop.
  - It has one more outcome than §3.3: **`offline`** (an old snapshot and no answer from ÖRZA). That shows the network
    toast, not the "not ready" line, because the server may well know the consent.
- **`useAiDeclined`** hides its line once the member's copy is allowed (for example allowed on the web, then picked up
  by a refresh). It hides the "not ready" line once the server knows the consent.
- **Snap and Prescriptions** show their consent panel from `useAiDeclined`.
  - Snap: `AiConsentPanel`, with "Allow AI features" and "Open the meal log".
  - Rx: `ProblemPanel` kind `ai_consent`, plus `ai_unavailable` for an old server.
  - `scanProblem` and `rxProblem` also map a refusal to it, as a fallback.
- **Settings' Allow sends the PUT itself.** The manage sheet shows the same points, so the consent sheet doesn't open
  on top of it (no sheet inside a sheet).
- **Names:** `iphoneSendsHealthData(serverKnowsAiConsent)`, `aiConsent.serverKnowsAiConsent(user)`,
  `StepsMember.aiConsentKnown`, `SaveJob.hold` and `SyncOptions.aiConsentKnown`.
  - Every steps member the app builds carries it. A headless run takes it from the snapshot or its `/auth/me`.
  - `importMetrics(platform, send)` now needs its second argument.
- **Copy** uses the app's typographic apostrophe (’), as the steps disclosure does. Otherwise it is the §4 strings
  exactly. These strings are new (§4 doesn't give them), for the user's review (§11 Q2):
  - the panels' titles "AI features are off" and "AI features aren’t ready yet", and "Open the meal log";
  - `AI_NEEDED_LINE`, "This needs ÖRZA’s AI features. You can allow them in Settings › Privacy & data.", for a refusal
    where the feature isn't known;
  - the manage sheet's "Turn off AI features" button.

### 10.3 AR review (2026-11-10): both sides

**Checked and sound**
- R1: the server's only OpenAI path is `aiJSON`, and its six callers all start with `requireAiUser()`. Every phone
  request sends `X-ORZA-Client: mobile` (`baseHeaders`), so a cookie can't bypass R1 either.
- The phone: every request goes through `lib/api.ts` `request()` (there is no other `fetch` or upload). There are no
  offline queues, persisted mutations or AI calls in the background tasks. A headless JS context starts with the backstop
  closed. A grep finds six call sites, all gated (§10.1).
- The contract (§5) matches on both sides: the paths, the `{version}` body, the 403 and 409 codes, a DELETE with no body,
  and `ai_consent` in every `{user}`. The website's requests and UI are unchanged.
- The flag flip: sync decides the hold on each run from the member's copy (a headless run uses the snapshot or
  `/auth/me`). A new server keeps automatic steps and weight out of every AI prompt without consent (R1 and R2), and an
  old server gets nothing automatic. No prompt includes sleep or heart rate.

**Fixed**
- **web `5e0e097` (R2):** without consent, the coach's history kept AI replies that had no `meta.health` flag. Replies
  from before this change had today's tracked steps in their prompt (an Android phone's Health Connect or motion count,
  as SPEC already notes) and can repeat them. Now every AI reply stores `health = consented`, and without consent only
  `false` replies stay in the history. A scratch Node test of `aiHistory` failed before the fix and passes after it.
- **The gate across a sign-out** (`runAiGate` `current`, outcome `gone`; `features/ai/consent.ts` `pending` per
  member). If member A signed out during the gate's `/auth/me` refresh, the gate could open the sheet with no host. Member
  B then saw it on sign-in, and B's Allow let A's waiting action, such as A's typed message, go out on B's session. Now
  the pass ends with nothing sent or shown. Covered by 2 new tests in `test:ai`.
- **Chat Retry with Not now:** Retry removed the "Not sent" bubble before the gate, so Not now lost the message. Now the
  bubble goes only when the message is sent (`send(…, {replaces})`), and the refusal's re-send works the same way.
- **Rx:** an earlier problem panel (for example "offline") hid the Not now line. The consent panel now comes first, as
  on Snap.
- **Copy:** the "never" point now reads "your account’s email, password or phone number, your saved medicines and
  alarms". A prescription photo shows its medicines. The turn-off toast now says "off in the app", because the website
  doesn't ask (Q1). Both are pinned in `test:ai`.

**Not changed (and why)**
- The iOS purpose strings (`app.json`) don't mention AI yet. They wait for the user's review (§4), and only an iOS
  rebuild picks them up. They are needed before the iPhone build with the flag reaches testers.
- The website doesn't ask (Q1). After Turn off in the app, the website's AI features still run for the account,
  without tracked steps (R2). The copy says "in the app".
- If Allow's PUT succeeds but its answer is lost (a timeout), the account is allowed while the sheet shows the network
  line. The member did tap Allow, and Settings shows "On", so this needs no change.
- Google Play's in-app reporting of AI output is still a follow-up (§9).
- An AI-learned memory fact could restate tracked data. The prompt allows only durable facts, and it was not changed.

## 11. Open questions for the user

1. **Website.** Should the website ask the same consent, using the same record and copy, so the server can refuse
   AI requests from every client? Recommended: yes, before the iOS release.
   - Until then, website members use AI as today. For accounts without consent, though, the server leaves today's
     step count, and the built-in coach's replies that quote steps or weight, out of the website coach's AI prompt.
   - That means the website coach won't know today's steps for those members. This is the price of flipping
     `SEND_IPHONE_HEALTH_DATA` now.
   - Alternative: keep the iPhone flag off until the website asks too.
2. **Privacy policy and copy review.** These need the user's review before going live: the §4 strings (sheet,
   declined lines, settings, the steps line, the connect caption, the iOS purpose strings), and these privacy-page
   changes (`web:src/app/(site)/privacy/page.tsx`).
   - **`#ai-processing`, first paragraph.** Replace "AI models operated by third-party model providers — … AI
     chat, recipe generation, rebalancing plans and report insights." with: "AI models from OpenAI, our AI model
     provider — meal photo scans, prescription scans, text and voice meal logging, AI chat, recipe generation and
     rebalancing plans." No code makes AI report insights.
   - **New list item "You choose.":** "The ÖRZA phone app asks before your first AI feature and sends nothing to
     OpenAI until you allow it. You can turn AI features off any time in the app under Settings › Privacy & data ›
     AI features; the app's AI features then stop until you allow them again, and nothing else changes."
   - **New list item "Health data only with your permission.":** "Steps and weight from Apple Health, Health
     Connect or your phone's motion sensor go to OpenAI only inside AI chat, and only after you've allowed AI
     features. Without that permission, ÖRZA leaves them out of AI requests."
   - **`#phone-app`, "In AI chat, if you use it:":** becomes "In AI chat, if you've allowed AI features:".
   - **Optional**, only if the OpenAI organisation's data-sharing (training) setting is confirmed off: "OpenAI
     doesn't use this content to train its models."

---

## Sources (checked 2026-11-10)
- Apple App Review Guidelines 5.1.1, 5.1.2, 5.1.3: https://developer.apple.com/app-store/review/guidelines/
- Google Play User Data policy (prominent disclosure and consent; third-party AI integrations; service providers):
  https://support.google.com/googleplay/android-developer/answer/10144311
- Google Play Android health permissions, guidance and FAQs (explicit, informed consent before sharing with third
  parties; no ads): https://support.google.com/googleplay/android-developer/answer/12991134
- Google Play AI-Generated Content (scope: chatbots as a central feature; in-app reporting):
  https://support.google.com/googleplay/android-developer/answer/14094294 and
  https://support.google.com/googleplay/android-developer/answer/13985936
- OpenAI API data controls (no training on API data by default; abuse-monitoring logs up to 30 days):
  https://developers.openai.com/api/docs/guides/your-data
