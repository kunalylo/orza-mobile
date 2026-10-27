# Auto steps v2: final implementation plan

Date: 2026-10-27. Status: **in progress** — see the ticks in §10 and the PROGRESS log.

**Coordinator decisions on the plan's open points (2026-10-27)**
- S0 (a) Backend changes are built LOCALLY on the `mobile-backend-batch` branch in `E:\aylo\orza-backend` after web batch 1;
  pushing still needs the user's OK.
- S0 (b) No WRITE_STEPS / no HealthKit writes (§0.3) is the default. The user asked for "sync to other health apps"; §11 explains
  why phone steps already reach them; reported to the user, who can still ask for the Appendix A writer.
- B5 is NOT done as a temporary removal: the coach keeps steps on the web (Apple's rule is about HealthKit data and the iOS app is
  not released). Instead the app-wide AI data consent (explicit permission before personal/health data goes to the AI provider,
  App Store 5.1.2(i) / 5.1.3) is built before any iOS submission (V6/D3) — and until it ships, the iOS build must not send
  HealthKit-derived steps to the coach.
- S0 (c)/(d) The real Android phone (V2) and Health Connect Toolbox download (E-3) are asked of the user when those steps come.

**Inputs**
- `steps-v2/research.md`, `steps-v2/critic-policy.md` (P1–P20) and `steps-v2/critic-correctness.md` (C1–C16, R1–R16) next to this file;
- `E:\aylo\orza-mobile\docs\PROGRESS.md` (the auto-steps log entries and "NEXT after D1: auto steps v2");
- the code in `src/lib/steps/*`, `src/lib/health/*`, `src/features/today/StepsCard.tsx`, `modules/orza-steps/**`, `app.json` and
  `index.ts`;
- on the web side: `src/app/api/track/steps/route.ts`, `src/lib/care/health.ts` (`normaliseDays`, `mirrorIntoTracking`),
  `src/app/api/health/days/route.ts` and `src/lib/domain/tracking.ts`;
- the official pages re-checked today, listed under **Sources** at the end.

**Conventions**
- Paths without a prefix are relative to `E:\aylo\orza-mobile`. `web:` means `E:\aylo\orza`.
- **On resume:** read §0, then go to the first unchecked step in §10.

---

## 0. Decisions on one screen

1. **One reference number per platform: the health store's day total.**
   - The health store is Health Connect (HC) `aggregate`, or Apple Health `cumulativeSum` statistics.
   - It is what other health apps show. The phone's own counter is the fallback when there is no store.
   - **Today** shows and saves `max(store, phone)` as a live tail.
   - **Past days** follow the store. ÖRZA may lower *its own* earlier automatic save to match. It never lowers a number
     somebody else saved, and never lowers a member's edit.
   - This replaces "highest source per day, never lower" (C3, R1–R4).
2. **Ask for one permission per platform by default** (P20, P5):

   | Phone | First (and normally only) ask |
   |---|---|
   | Android 14+ with SDK extension ≥ 20 | HC **Steps (+ background)**. ÖRZA's grant also switches on HC's own on-device step counting. |
   | Android 9–13, or 14 without extension 20 | **Physical activity**, read through the Google Play services **Recording API**. Our alarm sampler is used only when Play services is missing or too old. HC "include your watch or app" is a separate optional tap. |
   | iPhone | **Apple Health Steps** only. CMPedometer (Motion & Fitness) is a one-time fallback offer when Health returns no steps. |
3. **No `WRITE_STEPS` and no HealthKit writes in v2** (P13 accepted; research phase 2 rejected).
   - "Both ways" already holds for phone steps:
     - On iOS, every iPhone and Watch step is in Apple Health for every app.
     - On Android 14+, ÖRZA's `READ_STEPS` grant makes HC record this phone's steps for every app the member allows.
   - ÖRZA reads the store, which brings in other apps and watches.
   - Writing a second copy would double count in apps that add up raw records, and would cost a declaration plus a
     "shared" Data safety answer. §2.8 has the note for the client.
4. **Per-member consent, with an off switch** (P8, P9, C14).
   - OS permissions belong to the phone. ÖRZA reads only after **this member** has gone through the steps disclosure.
   - A "Count steps automatically" switch stops every path.
   - At sign-out, the Recording API subscription is removed.
5. **One writer, three server modes** (C1, C2, C5, R9, R10).
   - Steps reach `tracking.steps` only through `POST /api/track/steps`, in one of three modes: `manual` (the default; sets an
     edit marker), `auto` (an atomic raise, refused when there is an edit the phone hasn't seen) and `reconcile` (a
     compare-and-set lower).
   - The phone's Health import stops sending `steps`.
   - The Health charts show `tracking.steps` (R16).
6. **Bases are anchored in time, not in value** (C4, R6).
   - An edit is stored as `{steps, at}`, and the day is the edit plus what any source counted after `at`.
   - `rebased()` is deleted.
7. **Store and privacy fixes are part of v2, not left for later** (P1–P4, P6, P7, P10–P12, P16, P17, P19):
   - Health Connect's privacy link opens a real privacy-policy activity;
   - the privacy policy gets a section on the phone app;
   - steps leave AI prompts until the app-wide AI consent ships;
   - the pre-permission sheet has one "Continue" button;
   - "Log steps" is always there when nothing counts;
   - step day records move out of backups;
   - the iOS purpose strings are rewritten.

---

## 1. Resolution of every critic point

### 1.1 Policy critic (P1–P20)

| ID | Verdict | Reason / how it is resolved (step in §10) |
|---|---|---|
| P1 | **Accept** | HC requires an activity that "displays your app's privacy policy … The activity must display the same privacy policy you provide … in the Google Play Console" [G-start]. Fix: a native `HealthPrivacyActivity` in `orza-steps` plus an activity-alias, and drop RNHC's config plugin, which only points both entries at MainActivity (`node_modules/react-native-health-connect/app.plugin.js`) (N3). |
| P2 | **Accept** | Web privacy page section "Phone app: steps and health data", anchor `#phone-app` (B6). It must be live before any store submission. It isn't needed for device tests. |
| P3 | **Accept, option (b) now, (a) in D3** | 5.1.2(i): "clearly disclose where personal data will be shared with third parties, including with third-party AI, and obtain explicit permission" [A-guide]. v2: the coach prompt no longer includes steps (B5). The app-wide AI-sharing consent covers meals, photos and chat as well as steps, so it is a D3 item (§9). |
| P4 | **Accept** | Copy in the toggle and the policy: "Steps and anything read from Apple Health, Health Connect or your phone's motion sensors are never used to improve AI" (U4, B6). |
| P5 | **Accept** | HC: "Request the minimum data types needed" [G-hcpol]. Drop Active energy, Distance, Heart rate and Water on both platforms. They are uploaded and displayed nowhere (R1, R3, N5). The steps request from Today is Steps only. |
| P6 | **Accept** | HIG: "Include only one button … Use a term like 'Continue' or 'Next'"; "don't provide a way for people to leave the screen … without viewing the system alert" [A-hig]. Use one "Continue" button. The watch option moves onto the card. On iOS the sheet has no close (no X, no swipe, no backdrop). On Android the system back still closes it, as the platform expects, but there is no X (U1). |
| P7 | **Accept** | 5.1.1(iv): "provide alternative solutions for users who don't grant consent" [A-guide]. "Log steps" is shown whenever no automatic source counts today, whatever the permission state. The iOS "Health has no steps" state offers Motion once (U1, U2). |
| P8 | **Accept, modified** | Accept: a per-member consent record, backfill limited on shared phones, and Recording API `unsubscribe` at sign-out. **Reject** mirroring consent on the server: consent is to read *this device's* data, and a server copy decides nothing. Shared-phone rule M9 (§2.7). |
| P9 | **Accept, modified** | Add a "Count steps automatically" switch on the Health screen and in Settings › Privacy & data. Off stops reads and saves, stops and clears the sampler, unsubscribes the Recording API and calls `clearBackgroundTypes()`. **Not** `revokeAllPermissions()` on the steps switch: it would also revoke sleep, weight and resting HR. Instead the off sheet links to Health Connect › App permissions, and the Health screen's full **Disconnect** calls `revokeAllPermissions()` (U3, R6). |
| P10 | **Accept** | Ship `NSHealthUpdateUsageDescription: false`, and check the first TestFlight upload for ITMS-90683. If it appears, restore the honest string from §6 (D2/D3 checklist). |
| P11 | **Accept** | New purpose strings in §6 (R3). |
| P12 | **Accept** | Re-file the Health apps declaration with `READ_HEALTH_DATA_IN_BACKGROUND`, minus the 4 dropped types (§9). |
| P13 | **Accept** | See §0.3 and §2.8. Writing first-party meals, water or weight to HC/HealthKit is a separate product decision. |
| P14 | **Accept** | The sampler's midnight alarm uses only the inexact chain. The exact branch is removed from `StepScheduler.armMidnight` (N4). Step sampling isn't a user-facing timed function [G-alarm]. |
| P15 | **Accept** | No foreground service for steps. If Recording API freshness turns out poor, the answer is a foreground `sampleNow()` top-up (step V3-c), not an FGS. |
| P16 | **Accept** | Per-day step records move to `Paths.cache`, which is excluded from iCloud Backup and Android Auto Backup and can be purged. That is safe, because the server is now the record of truth (edit marker, modes). They are deleted at sign-out. Consent and permission flags (not health data) stay in `Paths.document` (J7). |
| P17 | **Accept** | Add `ios.privacyManifests` with `NSPrivacyAccessedAPICategoryUserDefaults` / `CA92.1` to app.json (R3). Check the generated `PrivacyInfo.xcprivacy` in D2. |
| P18 | **Accept** | D3 listing text mentions Apple Health (§9). |
| P19 | **Accept** | After a refusal: "Not now — I'll log steps" collapses the CTA for 30 days, per member. The switch and the Health screen keep the way back (U1). |
| P20 | **Accept** | Android 14+ with extension ≥ 20 asks HC first. Physical activity is only a fallback. When HC steps are ON on such a phone, the phone sources are switched off (rule S-A3). The disclosure says HC then keeps this phone's steps for other apps. |

Points the policy critic raised for D3 outside steps go into §9: the "Not now" in `AlarmPermissionPrompt`, Snap's
"Allow access", and medicine photos in `Paths.document`.

### 1.2 Correctness critic (C1–C16 → rules)

| ID | Verdict | Resolution |
|---|---|---|
| C1 | **Accept** | Edit marker `steps_edited_at` set by `manual` saves. `auto` saves and the import mirror never raise an edited day the phone hasn't seen. The phone's import stops sending steps (M-rules §2.5, B1, B3, R6). |
| C2 | **Accept** | One day definition: the profile zone, everywhere. The import no longer carries steps. The server drops `steps` for a date after the profile's today (B3). |
| C3 | **Accept** | Past days are store-authoritative (M4), and reconcile lowers ÖRZA's own save (M6). P20 makes one source per platform the norm, so the max rarely matters. |
| C4 | **Accept** | Time-anchored bases (M5). `rebased()` and `DayBase.auto/source/last` are removed. |
| C5 | **Accept** | `auto` = atomic `$max` with the edit-marker guard. Edits are detected by the marker, never by "the value went down" (B1, J6). |
| C6 | **Accept** | A store day settles 72 h after it ends. A phone-only day settles when complete and at least 60 min after the day ends (M7). |
| C7 | **Accept** | Estimates never beat a real reading. Comparisons use `steps − estimated`. An estimated day isn't final while a store is ON (M4, M7). |
| C8 | **Accept** | Every source reports `coverFrom`. START bases apply to any source (M5c). HC first-grant coverage: rule S-H2. |
| C9 | **Accept** | Recording API rules S-R1…S-R6: quarter-hour or minute buckets, end − 1 ms, null outside the window, unsubscribe at sign-out, sensor required, and never Google's day-bucket sample. |
| C10 | **Accept, partly** | A reboot gap without a `shutdown` sample makes the day "not complete" (it stays pending and is saved raise-only), and sampler days are labelled "approximate". Full parity would need an FGS, which is rejected (P15). |
| C11 | **Moot** | There is no HC writer in v2. W1–W6 stay in Appendix A in case the decision changes. |
| C12 | **Accept** | Day records store `tz`. A past day saved under another zone is frozen. The background run refreshes the user snapshot before using its zone (M8). |
| C13 | **Accept for the sampler only** | `MAX_STEPS_PER_HOUR` drops from 50,000 to 15,000 (15-min floor, so at most 3,750 per window). Not applied to Recording API or store numbers: those are platform pipelines, and filtering them would make ÖRZA differ from them. |
| C14 | **Accept** | Per-member consent plus the shared-phone backfill rule M9. |
| C15 | **Verify on device** | Apple's statistics docs don't say how a sample crossing midnight is split ([A-hkscq] has no statement). Device test I-6. If ÖRZA's two days differ from the Health app's, switch the per-day queries to one statistics collection query (`queryStatisticsCollectionForQuantity`, `{day: 1}`), anchored at the **profile-zone** midnight. |
| C16 | **Document only** | When two phones each carry part of the day, the server keeps the higher number. Adding them would double count the usual case, where both are carried. The note goes in the code (`merge.ts`). |

R1–R16 are adopted as written, with these changes:
- **R2:** HC comes first on Android 14+ with extension ≥ 20, per P20.
- **R4:** reconcile whenever the server still holds this phone's own last automatic value, not once at 72 h, so a past day
  matches the health app the next morning. It is still guarded by `expect` and the edit marker.
- **R8(d):** the time-zone hint is optional, step U5.
- **R13:** the sampler only.
- **R14:** replaced by M9. A silent shared-phone rule beats an extra yes/no dialog, which would add a second button to a
  pre-alert sheet.
- **R15:** moot.

### 1.3 Research claims

| Research says | Verdict |
|---|---|
| Recording API primary on Android 9–13; sampler fallback; 15-min buckets; read from the hourly task | **Kept.** Plus: sensor required, window → null, unsubscribe at sign-out, minute buckets for base ranges |
| Android 14+: Recording API and HC side by side, "higher of the two" | **Changed:** HC alone when it can count the phone (P20/C3); Recording API only as a fallback |
| G1 "Read HC steps whenever `READ_STEPS` is granted" | **Rejected as written:** gated by the member's consent (P8) |
| iOS: HealthKit first, CMPedometer fallback; background delivery hourly via kingstinct `configureBackgroundTypes` / `subscribeToChanges` | **Kept** (signatures confirmed in `node_modules/@kingstinct/react-native-healthkit/src/specs/CoreModule.nitro.ts:58-67`) |
| Never write steps on iOS or Android 14+ | **Kept** |
| Phase-2 opt-in `WRITE_STEPS` on Android 9–13 | **Rejected for v2** (P13) |
| Drop `NSHealthUpdateUsageDescription` | **Qualified:** verify on upload (P10) |
| Day value = higher of store and phone | **Changed:** today only; past days follow the store (M3/M4) |
| "Manual entry remains the fallback" | **Corrected:** always offered when nothing counts (P7) |
| The RNHC plugin provides the privacy activity | **Corrected:** it opens MainActivity (P1) |

---

## 2. Source priority and merge rules (exact, testable)

**Notation**
- Member day `D` = `[s, e)` in the **profile** time zone. `now` = `t`. `end′ = min(e, t)`.
- Each source `x` that is ON returns, for `D`:
  - `x.steps`: an integer ≥ 0, or `null` = "no data";
  - `x.coverFrom`: the first instant of `D` it can see. It equals `s` when it sees the whole day;
  - `x.estimated`: the sampler only, how many of `x.steps` are a long-gap estimate;
  - `x.complete`: the source has read up to the day's end;
  - `x.since(a)`: its count over `[max(a, x.coverFrom), end′)`.

### 2.1 Which sources are ON

**Android**

| Rule | Source (`StepSource`, internal `counter`) | ON when | `coverFrom` | Lookback |
|---|---|---|---|---|
| S-A1 | HC aggregate (`health_connect`) | the member has `consent.store` **and** the HC SDK status is available **and** `READ_STEPS` is granted | `s`, except on the day of `hcGrantAt` (S-H2) | 30 days (HC's limit from before the first grant) |
| S-A2 | Recording API (`phone`, `recording`) | `consent.phone` **and** Physical activity is granted (always granted below API 29) **and** the phone has a step counter (`Sensor.TYPE_STEP_COUNTER`) **and** `recordingStatus() == 'available'` **and** `subscribe` succeeded **and not** S-A3 | `max(s, subscribedAt, t − 10 d)` | 9 days |
| S-A3 | (minimisation) | `stepTracking` (API ≥ 34 **and** `SdkExtensions.getExtensionVersion(UPSIDE_DOWN_CAKE) ≥ 20`) **and** S-A1 is ON → every phone source is OFF; the Recording API is unsubscribed and the sampler stopped | — | — |
| S-A4 | Sampler (`phone`, `sampler`) | `consent.phone` **and** permission **and** step counter **and** the Recording API isn't usable (status ≠ available, or subscribe failed) **and not** S-A3 | from its samples (existing `dailyStepCounts`) | 9 days (the ring buffer keeps 10) |

**HC rules**
- **S-H1.** HC `0` → `null` (existing rule: 0 means nothing synced). It is read with `aggregateRecord` over instant ranges
  built from **profile-zone** midnights. Never `aggregateGroupByPeriod` (phone zone) and never `readRecords` sums
  [G-read: "use `aggregate()` instead of `readRecords()` to avoid double counting"].
- **S-H2.** `hcGrantAt` = the first time ÖRZA saw `READ_STEPS` granted on this install (stored in prefs). On the day that
  contains it:
  - if `HC(s, hcGrantAt) == 0`, then `coverFrom = hcGrantAt` (only on-device counting, which starts at the grant
    [G-steps]);
  - otherwise `coverFrom = s` (another writer had data before the grant).

**Recording API rules**
- **S-R1.** Day totals come from 15-minute buckets. The range start is floored to a UTC quarter-hour, so buckets split
  exactly at a profile-zone midnight in every real offset (+05:30, +05:45, DST days).
- **S-R2.** `setTimeRange(start, end − 1, MILLISECONDS)`: the end is inclusive (research [S2a]).
- **S-R3.** Only data inside `W = [max(subscribedAt, t − 10 d), t]` counts.
  - A day entirely before `W` → `null`.
  - A day straddling `W`'s start → `coverFrom = W.start`.
  - A day inside `W` with no buckets → `0` (covered, really 0).
- **S-R4.** For base ranges (`since(a)`), use 1-minute buckets from `floor_minute(a)`, today only.
- **S-R5.** No step counter → status `no_sensor`, so the Recording API is not used (C9.6).
- **S-R6.** Never copy Google's sample, which uses `bucketByTime(1, TimeUnit.DAYS)` from now − 1 week: those are rolling
  24 h windows, not local days [G-rec].

**iOS**

| Rule | Source | ON when | `coverFrom` | Lookback |
|---|---|---|---|---|
| S-I1 | HealthKit `queryStatisticsForQuantity(StepCount, ['cumulativeSum'])` (`apple_health`) | `consent.store` **and** HealthKit is available **and** the StepCount sheet has been answered | `s` (HealthKit keeps iPhone history from before the grant) | 30 days |
| S-I2 | CMPedometer (`phone`, `pedometer`) | `consent.phone` (set only by the fallback offer, or when HealthKit is unavailable) **and** Motion is granted | `s` | 7 days (`t − s > 7 d` → `null`) |

- HealthKit `0` → `null`. HealthKit hides denied reads [A-hk-auth].

### 2.2 What Today asks, and in what order

**`firstAsk` on Android**

| Condition | `firstAsk` |
|---|---|
| HC SDK available **and** `stepTracking` | `hc`: request `READ_STEPS`, plus `BackgroundAccessPermission` when `healthFeatures().backgroundRead == 'available'` |
| else, the phone has a step counter | `phone`: Physical activity, then Recording API subscribe (or sampler) |
| else, HC available or installable | `hc`: watches and apps only; the copy says so |
| else | none: Log steps only |

- **After a refusal of `hc`** (including the 2-denial lockout) on a phone with a counter, the card shows a separate button,
  "Use this phone's motion sensor instead". It is never chained automatically.
- **After `phone` is granted on a non-`stepTracking` phone with HC available or installable**, the card offers
  "Include your watch or fitness app" (HC `READ_STEPS` + background).

**iOS**
- `firstAsk = healthkit` (`requestAuthorization({toRead: [StepCount]})`).
- **"Health empty" state:** every one of the last 7 past days is `null` and today is `null`.
  - Show "Log steps".
  - Show a one-time "Use iPhone motion instead", which opens its own pre-alert sheet and then the Motion prompt and sets
    `consent.phone`.
  - Never claim "you denied": HealthKit can't tell [A-hk-auth].

**When the OS permission is already granted but this member has no consent** (a second member, or after the switch was
off):
- the sheet becomes a plain consent screen with a "Turn on" button;
- no system alert follows, so the HIG pre-alert rule doesn't apply;
- it may be closed.

### 2.3 Merge rules (pure, `src/lib/steps/merge.ts`)

- **M0 (null and 0).**
  - Store `0` → `null`.
  - Phone sources keep a real `0` when they covered the time.
  - `null` never wins and never counts as "complete".
- **M1 (phone sources never add).**
  - `P` = the phone source with the highest `steps − estimated`. Its flags (`coverFrom`, `estimated`, `complete`) come
    with it.
  - They all read the same sensor, so they are compared, never summed.
- **M2 (store).** `S` = the store reading (at most one store per platform).
- **M3 (today, `s ≤ t < e`).**
  - `auto = max(S, P)`, with nulls ignored.
  - A tie goes to the store (label).
  - The estimated part is never saved for today (target = `auto − estimated` when the phone wins).
- **M4 (past day).**
  - If `S ≠ null` **and** `S.coverFrom ≤ (P?.coverFrom ?? +∞)`, then `auto = S`. This is store-authoritative, even when
    `P` is higher.
  - Otherwise, `auto` = the higher of `S` and `P` by `steps − estimated`. When only `P` exists, `auto = P` including its
    estimate.
- **M5 (bases, time-anchored).**
  - A base is `{kind: 'edit' | 'start', steps, at, editRef?}`.
  - `counted(base)` applies the M3/M4 selection to each ON source's `since(base.at)`.
  - (a) `edit`: `value = clamp(base.steps + counted)`.
  - (b) `start`: `value = max(auto, clamp(base.steps + counted))`.
  - (c) **How a base is created:**
    - (c1) **The member saves a number on this phone at `a`.** It is `edit` if some ON source had `coverFrom ≤ a` on `D`
      (something was counting). Otherwise it is `start` (typed while nothing counted, so counting that starts later adds
      on, and a whole-day store count can still replace it once higher).
    - (c2) **The phone sees a server marker `m` ≠ the known `editRef`.** Same test, with `a = clamp(Date.parse(m), s,
      t)`. `steps` = the server value, and `editRef = m`.
    - (c3) **Implicit start.** There is no base, this phone hasn't auto-saved `D` yet, the winner's `coverFrom > s`, and
      the known server value is > 0. Then `start {steps: server, at: winner.coverFrom}`. This covers a new source's first
      day, and a re-subscribe after sign-out.
  - (d) An `edit` with `at ≥ e` (a past day edited after it ended) keeps `value = base.steps` forever. Late watch data
    stamped before `at` never adds on (C4b).
  - (e) No base → `value = auto`.

### 2.4 What Today shows (`policy.shownSteps`)

- **Today:**
  - `shown = max(value, server)`. When offline, `server` = the last known value (`server ?? autoSent`).
  - Labels:
    - an `edit` base → "Edited by you";
    - the server higher than `value` → "Saved";
    - otherwise the winner: "From Health Connect", "From Apple Health", "Counted by this phone", or "Counted by this phone
      · approximate" for the sampler.
- **Past day:** `shown` = the server value (it is the reconciled truth). When offline, it is `value`.

### 2.5 Saving: server modes (backend B1) and the phone's plan (`policy.savePlan`)

**Server contract: `POST /api/track/steps`**

Body:
```ts
{
  steps: number;                       // 0..100000
  date?: string;                       // YYYY-MM-DD; omitted = today
  mode?: 'manual' | 'auto' | 'reconcile'; // default 'manual': the website's own form keeps working
  edit_ref?: string | null;            // the steps_edited_at the phone has seen (null = none)
  expect?: number;                     // reconcile only
}
```
Response: `{ tracking: TrackingDay & { steps_edited_at?: string | null }, applied: boolean, reason?: 'not_higher' | 'edited' | 'changed' }`.

| Mode | Atomic server operation | Not applied when |
|---|---|---|
| `manual` | `$set {steps, steps_edited_at: nowISO, updated_at}` (upsert) | never |
| `auto` | ensure the row (`$setOnInsert`, no steps change); then `updateOne({user_id, date, steps: {$lt: n}, steps_edited_at: edit_ref ?? null}, {$set: {steps: n, updated_at}})` | `reason: 'edited'` when `steps_edited_at` ≠ `edit_ref`; else `'not_higher'` |
| `reconcile` | `updateOne({user_id, date, steps: expect, steps_edited_at: edit_ref ?? null}, {$set: {steps: n, updated_at}})` | `'edited'` or `'changed'` |

`steps_edited_at: null` in a Mongo filter matches a missing field, so old rows work.

**Phone plan (M6)**

Target: `T = clamp(value − (isToday ? estimated : 0))`. Known floor: `K = max(server ?? 0, autoSent ?? 0)`.
1. **An `edit` base with `at ≥ e`:** save nothing.
2. **`T > K`:**
   - **Today:** save when `T − K ≥ 50`, or when 10 min have passed since the last save, or when nothing was saved yet.
   - **Past day:** save at once.
   - Mode `auto` with `edit_ref = rec.editRef ?? null`.
3. **Past day, `T < server`, and all of these hold:** `server == autoSent`, `rec.serverModes` is true, and no unseen
   marker. Mode `reconcile`, `expect = autoSent`. ÖRZA corrects only its own earlier save (the provisional live tail).
4. **Otherwise:** nothing.

**Responses**
- `applied` → `autoSent = server = tracking.steps`.
- `'edited'` → take the edit (M5c2) from `tracking.steps_edited_at`. The next run saves edit + counted since.
- `'not_higher'` / `'changed'` → `server = tracking.steps`. `autoSent` is left alone, so a foreign value is never
  reconciled.
- **Capability detection:** `serverModes = ('applied' in response)`. While it is false (the old production server):
  - no `reconcile`;
  - the existing GET-before-POST raise-only guard stays.

  The legacy branch is deleted once B1 is deployed (step V4).

### 2.6 When a past day is final, lookback, zone freeze

- **M7 (final).** Past day `D` stops being read after a successful save (or a "nothing to save") on a run where:
  - **a store is ON:** `t ≥ e + 72 h` (`SETTLE_STORE_MS`), whether or not the day had data. Late watch syncs are caught
    before then (C6);
  - **phone only:** the winner is `complete` **and** `t ≥ e + 60 min` (`SETTLE_PHONE_MS`), or `t ≥ e + 72 h` with no
    reading.
    - The sampler is `complete` = `coversDayEnd` **and** no uncertain reboot gap (C10).
    - The Recording API is `complete` = read at or after `e + 60 min`.
    - CMPedometer is `complete` = `t ≥ e + 60 min`.
    - A CMPedometer `0` is never final while HealthKit is ON.
- **Lookback.** `pendingPastDays` covers back to the largest lookback among ON sources (§2.1) and never before the
  coverage floor (M9). Days already final are skipped, so in steady state at most 3 past days are pending.
  - The first run after consent may read up to 30 store days.
  - A background run reads at most 7 past days per run.
- **M8 (zone freeze).** A day record stores the profile `tz` it was saved under. If `rec.tz ≠ current tz` and
  `rec.autoSent != null`, the day is treated as final. After a zone change, only today is recomputed.
  `syncStepsInBackground` refreshes the Keychain user snapshot (`GET /api/me`, best effort) before trusting its zone.

### 2.7 Account scoping (M9)

- **The consent record** lives in the prefs file `orza-steps-prefs.json` in `Paths.document`, per `userId`:
  - `store?: {at}` and `phone?: {at}`;
  - `off?: {at}` (the switch);
  - `notNowUntil?` (P19);
  - `motionOffered?` (iOS);
  - `sharedAtConsent: boolean`.
- **`sharedAtConsent`** is true when, at this member's first consent on this install, the prefs already hold a consent
  record for another `userId`.
- **Coverage floor.**
  - If `sharedAtConsent`, then `coverFloor = consent.at` and every source's `coverFrom = max(coverFrom, coverFloor)`.
    Days ending before it are never pending, and today becomes a START.
  - Otherwise, `coverFloor = −∞`: a full backfill up to each lookback, which the disclosure mentions.
- **Sign-out:**
  - the epoch bump (existing);
  - sampler `stop` + `clear` (existing);
  - **Recording API `unsubscribe`**: data becomes inaccessible [G-rec], and the next member can't read it;
  - iOS `clearBackgroundTypes()`;
  - **delete this member's day records** (P16).

  Consent records stay, so the same member signing in again isn't asked again. The next run re-subscribes, and the new
  `subscribedAt` makes the first day partial (M5c3).
- **Account deletion:** the same as sign-out, plus remove the member's consent record.

### 2.8 "Both ways": what syncs where

| Direction | iPhone | Android 14+ (ext ≥ 20) | Android 9–13 |
|---|---|---|---|
| Other apps and watches → ÖRZA | Apple Health statistics: iPhone + Watch + apps, de-duplicated like the Health app | HC aggregate: phone + watch + apps, by the member's priority list | HC aggregate when the member taps "Include your watch or fitness app"; otherwise the phone via the Recording API |
| ÖRZA → other apps | The iPhone already writes its steps to Apple Health. ÖRZA adds nothing: a second copy would sit **above** the Watch in the priority list [A-prio], and 5.1.3(ii) forbids inaccurate data | ÖRZA's `READ_STEPS` grant switches on HC's own phone step recording, which every allowed app sees [G-steps] | Not in v2. ÖRZA's Recording API steps stay inside ÖRZA (Appendix A if the client insists) |

### 2.9 Known limits (documented, not fixed)

- **C16:** two phones carried at different times. The server keeps the higher number.
- **Today's live tail** can sit a little above the store until the next morning's reconcile. This is limited to phones
  where two sources are ON (Android 9–13 with HC, or iOS with the Motion fallback).
- **HealthKit reads fail while the phone is locked** [A-hk-priv]. A background run then saves nothing and the next run
  catches up.

---

## 3. Backend changes (web, `E:\aylo\orza`)

Build them on a branch in the `E:\aylo\orza-backend` worktree (or a new `steps-v2-backend` branch) and test with
`E:\aylo\orza-localtest`. **Push only with the user's OK.** The phone feature-detects `applied` (§2.5), so it is safe
against the old production server.

| # | Change | Files |
|---|---|---|
| B1 | Modes `manual` (default) / `auto` / `reconcile`, `edit_ref`, `expect`; response `{tracking, applied, reason}` (§2.5). Ensure the row exists before the conditional `auto` update, so a failed `$lt` filter never hits the unique index through an upsert | `web:src/app/api/track/steps/route.ts`, `web:src/lib/domain/tracking.ts` (new `raiseSteps`, `reconcileSteps`, `setStepsManual`) |
| B2 | `steps_edited_at` in `TrackingDay` and in every response that returns tracking (`GET /api/dashboard/today` at least) | `web:src/lib/types*`, `web:src/app/api/dashboard/today/*` |
| B3 | `mirrorIntoTracking`: add `steps_edited_at: null` to the raise filter (never raise an edited day). `normaliseDays`: drop the `steps` metric for a date after the profile's today (other metrics keep the +1-day slack) | `web:src/lib/care/health.ts:164-202, 359-385` |
| B4 | `GET /api/health/days`: per date, `steps` = `tracking.steps` when a tracking row exists with steps > 0, otherwise the merged `health_days` steps (R16: one number in the app and on the website) | `web:src/app/api/health/days/route.ts` (+ `trackingInRange`) |
| B5 | Coach: remove `steps …/…` from `contextForPrompt` (about `web:src/lib/coach.ts:1308-1317`) until the AI-sharing consent ships (P3b). The member still sees steps everywhere | `web:src/lib/coach.ts` |
| B6 | Privacy page: section "Phone app: steps and health data" `id="phone-app"` (P2 list). AI-improvement text: health-store and motion data are never used (P4). Fix "never share … without your consent" wording on the web if present | `web:src/app/(site)/privacy/page.tsx`, `web:src/components/account/options.ts` |
| B7 | Web unit tests if a runner exists (`package.json` has no `test` script today): otherwise a `scripts/check-steps-modes.mjs` against the local server covering the B1/B3 cases in §7.2 | — |

The privacy text (B6) is legal copy, so the user reviews it before pushing.

---

## 4. Native changes

### 4.1 Android, `modules/orza-steps` (Kotlin)

**`android/build.gradle`: add a `dependencies` block**
```groovy
dependencies {
  implementation 'com.google.android.gms:play-services-fitness:21.3.0' // check maven-metadata for a newer 21.x
  implementation 'androidx.health.connect:connect-client:1.1.0'        // same version RNHC 4.1.3 uses (its build.gradle:95)
}
```

**New `StepRecording.kt`** (the Recording API on mobile [G-rec])
- `status(ctx): String` returns one of:
  - `"no_sensor"` when there is no `TYPE_STEP_COUNTER`;
  - otherwise, from `GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(ctx,
    LocalRecordingClient.LOCAL_RECORDING_CLIENT_STEPS_MIN_VERSION_CODE)`:
    - `SUCCESS` → `"available"`;
    - `SERVICE_VERSION_UPDATE_REQUIRED` / `SERVICE_UPDATING` → `"update_required"`;
    - `SERVICE_MISSING` / `SERVICE_INVALID` → `"missing"`;
    - `SERVICE_DISABLED` → `"disabled"`;
    - anything else → `"unavailable"`.
  - Use the steps-only constant: ÖRZA reads only `TYPE_STEP_COUNT_DELTA`. Research [S2] gives the values 241500000 (steps
    only) and 250500000 (all types). Always use the constants, never the numbers.
- `subscribe(ctx, cb)`:
  - calls `FitnessLocal.getLocalRecordingClient(ctx).subscribe(LocalDataType.TYPE_STEP_COUNT_DELTA)`;
  - on success, `StepStore.setRecordingSubscribedAt(now)` **only if it is unset**;
  - failure → `false`, plus the exception class name for logs.
- `unsubscribe(ctx, cb)`:
  - calls `….unsubscribe(LocalDataType.TYPE_STEP_COUNT_DELTA)`;
  - always clears `recordingSubscribedAt`.
- `read(ctx, startMs, endMs, bucketMinutes, cb)`:
  - request: `LocalDataReadRequest.Builder().aggregate(LocalDataType.TYPE_STEP_COUNT_DELTA).bucketByTime(bucketMinutes,
    TimeUnit.MINUTES).setTimeRange(startMs, endMs - 1, TimeUnit.MILLISECONDS)`;
  - sums `dp.getValue(LocalField.FIELD_STEPS).asInt()` per bucket;
  - returns JSON `[[bucketStartMs, bucketEndMs, steps], …]`, non-zero buckets only.

**New `HealthFeatures.kt`**, a `Coroutine` AsyncFunction:
- `stepTracking`: `SDK_INT >= 34 && SdkExtensions.getExtensionVersion(Build.VERSION_CODES.UPSIDE_DOWN_CAKE) >= 20` (the
  exact check from [G-steps]);
- `extension`: the int;
- `backgroundRead`: `HealthConnectClient.getOrCreate(ctx).features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND)`
  → `available` / `unavailable` [G-read]. Add `@OptIn(ExperimentalFeatureAvailabilityApi::class)` if the compiler asks;
- `backgroundGranted`: `permissionController.getGrantedPermissions()` contains
  `HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND`;
- `stepsGranted`: the same check for `HealthPermission.getReadPermission(StepsRecord::class)`;
- every field wrapped in try/catch. `getSdkStatus` not available → all false.

**New `HealthPrivacyActivity.kt`** (P1)
- A plain `android.app.Activity` with a `WebView` loading the constant `PRIVACY_URL =
  "https://orza-nine.vercel.app/privacy#phone-app"`. It must equal the Play Console privacy URL page.
- JavaScript on.
- Navigation outside the host opens externally.
- On a load error it shows "Couldn't load the privacy policy. Open it at orza-nine.vercel.app/privacy." with a
  "Open in browser" button.
- Back finishes.
- It needs no sign-in and no React.

**`OrzaStepsModule.kt`: new functions**
- `recordingStatus()`
- `recordingSubscribe(): {ok, subscribedAt}`
- `recordingUnsubscribe()`
- `recordingRead(startMs, endMs, bucketMinutes): string`, which rejects `ERR_RECORDING_READ` (message = exception class +
  status code)
- `recordingSubscribedAt()`
- `healthFeatures()`

`getStatus` adds `recording` and `subscribedAt` for diagnostics.

**`StepScheduler.armMidnight`** (P14): remove the `canScheduleExact` branch. Always use `nextInexactMidnightSample`.
`canScheduleExact` stays for `getStatus` only.

**`StepStore`:** `recordingSubscribedAt` in the settings JSON (`noBackupFilesDir`).

**`modules/orza-steps/src/index.ts`:** typed wrappers that never throw, same pattern as the existing ones.

### 4.2 Android manifest and app.json

`modules/orza-steps/android/src/main/AndroidManifest.xml` adds:
```xml
<activity android:name="expo.modules.orzasteps.HealthPrivacyActivity" android:exported="true"
          android:theme="@android:style/Theme.Material.Light.NoActionBar">
  <intent-filter><action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" /></intent-filter>
</activity>
<activity-alias android:name="expo.modules.orzasteps.ViewPermissionUsageActivity" android:exported="true"
                android:targetActivity="expo.modules.orzasteps.HealthPrivacyActivity"
                android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
  <intent-filter>
    <action android:name="android.intent.action.VIEW_PERMISSION_USAGE" />
    <category android:name="android.intent.category.HEALTH_PERMISSIONS" />
  </intent-filter>
</activity-alias>
```
These are exactly the filters [G-start] shows.

**`app.json`**
- **Plugins:** remove `"react-native-health-connect"`. Its plugin only adds the MainActivity filter and alias. The
  library's `android-expo` module still autolinks for the permission delegate.
- **Android `permissions`:**
  - remove `health.READ_ACTIVE_CALORIES_BURNED`, `health.READ_DISTANCE`, `health.READ_HEART_RATE` and
    `health.READ_HYDRATION` (P5);
  - add `android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND`;
  - keep `ACTIVITY_RECOGNITION`, `READ_STEPS`, `READ_SLEEP`, `READ_RESTING_HEART_RATE`, `READ_WEIGHT`,
    `RECEIVE_BOOT_COMPLETED` and `SCHEDULE_EXACT_ALARM` (medicine alarms only).
- **Never add:** `health.WRITE_STEPS`, `FOREGROUND_SERVICE_HEALTH`, `HIGH_SAMPLING_RATE_SENSORS`,
  `READ_HEALTH_DATA_HISTORY`.

**After prebuild, check the merged manifest of the build copy.**
- Expect:
  - exactly one `ACTION_SHOW_PERMISSIONS_RATIONALE` filter (on `HealthPrivacyActivity`);
  - exactly one `VIEW_PERMISSION_USAGE` alias, targeting it;
  - no rationale filter on MainActivity;
  - no new permission from `play-services-fitness`. If one appears, strip it with `tools:node="remove"` through a small
    config plugin.
- The GMS `com.google.android.gms.permission.ACTIVITY_RECOGNITION` is added only if the Android 9 device test needs it
  (research §1.1).

### 4.3 iOS (no custom Swift)

**`app.json` › `@kingstinct/react-native-healthkit`**
- `"background": true` adds `com.apple.developer.healthkit.background-delivery`, which `enableBackgroundDelivery` requires
  [A-bg].
- `"NSHealthUpdateUsageDescription": false` (P10: verify on upload).
- New `NSHealthShareUsageDescription` (§6).

**Other app.json changes**
- `expo-sensors` `motionPermission`: the new text (§6).
- `ios.privacyManifests`:
  `{ "NSPrivacyAccessedAPITypes": [{ "NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults", "NSPrivacyAccessedAPITypeReasons": ["CA92.1"] }] }`
  (P17).

**Background delivery from JS**
- After `consent.store` on iOS: `configureBackgroundTypes(['HKQuantityTypeIdentifierStepCount'], UpdateFrequency.hourly)`.
  `stepCount` is hourly at most on iOS [A-bg].
- On switch-off, sign-out or deletion: `clearBackgroundTypes()`.

**New `src/lib/steps/healthkitObserver.ios.ts`** (+ a no-op `healthkitObserver.ts`)
- It is imported by `index.ts` **before** `expo-router/entry`, next to the alarms task.
- When the prefs say background is configured, it calls `subscribeToChanges('HKQuantityTypeIdentifierStepCount', () =>
  void import('./sync').then(m => m.syncStepsInBackground()))`.
- It is wrapped in try/catch and lazy-requires the module, so Expo Go and builds without the module never crash.
- kingstinct calls HealthKit's completion handler natively (research §3.4), so the three-miss stop rule [A-bg] can't
  trigger.

---

## 5. JS changes (file by file)

| File | Change |
|---|---|
| `src/lib/steps/types.ts` | `SourceReading {source, counter?: 'recording' \| 'sampler' \| 'pedometer', steps, coverFrom, estimated?, complete?, since?}`; `DayReading {date, start, end, sources}`; `ReadOptions` gains `sinceAt?: Record<date, number>`, `consent`, `coverFloor`; `StepsAccess` gains `firstAsk`, `store: 'granted' \| 'not_granted' \| 'unavailable' \| 'needs_install'`, `recording` status. `StepsReader.readDays` returns `DayReading[]` |
| `src/lib/steps/counter.ts` | `MAX_STEPS_PER_HOUR = 15_000` (C13); `StepSample.reason?`; a reboot delta whose previous sample isn't `shutdown` marks `uncertainGap` on the days it touches, so `complete` is false (C10); new `stepsInRange(samples, tz, from, to)` (prorated, same rounding) |
| `src/lib/steps/recording.ts` (new, pure) | `recordingRange(start, end)` (quarter-hour floor, end − 1); `recordingDays(buckets, dates, tz, window)` → `SourceReading` per S-R1/S-R3; `recordingSince(minuteBuckets, at, end)` |
| `src/lib/steps/merge.ts` (new, pure) | M0–M5: `phoneWinner`, `autoCount(reading, isToday)`, `dayValue(reading, base, isToday)`, `hcCoverFrom(grantAt, preGrant)`, `applyCoverFloor`. Replaces `shared.bestOf`, which is deleted |
| `src/lib/steps/policy.ts` | `DayBase` becomes `{kind, steps, at, editRef?}`; `DayRecord` adds `autoSent`, `autoAt`, `editRef`, `serverModes`, `tz`; `savePlan()` (M6) returns `{mode, steps, expect?, editRef} \| null`; `baseForEdit(at, reading)` (M5c); `shownSteps` per §2.4; delete `rebased`, `withBase`, `editedOnServer` (value heuristic) and `needsStartBase` (replaced by M5c3) |
| `src/lib/steps/plan.ts` | `SETTLE_STORE_MS`, `SETTLE_PHONE_MS`, `LOOKBACK_DAYS`; `isFinal(dayRead, rec, now, storeOn)` (M7); `pendingPastDays(today, isFinal, maxBack, coverFloor, tz)` with the zone freeze (M8); `backfill(consents, userId)` (M9); `firstAsk(features)` and `healthEmpty(days)` (pure, §2.2) |
| `src/lib/steps/save.ts` | Rewritten around `savePlan` and the server modes. `postSteps(date, steps, mode, editRef, expect)` returns `{tracking, applied, reason}`. Response handling per §2.5. The legacy GET-before-POST branch is kept behind `serverModes === false` |
| `src/lib/steps/store.ts` | Split: `orza-steps-prefs.json` in `Paths.document` (version 2: Android permission history, consents, `hcGrantAt`, `notNowUntil`, `hkBackground`) and `orza-steps-days.json` in **`Paths.cache`** (day records, `KEEP_DAYS = 35`). `deleteUserDays(userId)` at sign-out. Version-1 file: migrate the asked/blocked flags, drop the day records |
| `src/lib/steps/reader.android.ts` | Source selection S-A1…S-A4. HC through the bridge (consent-gated, not `healthConnected`). Recording API via the module (subscribe on every `prepare`; read 15-min buckets for the dates, 1-min for `sinceAt`). Sampler only per S-A4. `requestPermission(kind: 'hc' \| 'phone')` |
| `src/lib/steps/reader.ios.ts` | HealthKit primary (S-I1); CMPedometer only with `consent.phone` (S-I2); `requestPermission(kind: 'healthkit' \| 'phone')`; `sinceAt` via range queries |
| `src/lib/steps/sync.ts` | Consent gate (nothing reads or saves without this member's consent and with the switch on); `firstAsk`; the new save flow; Android `READ_HEALTH_DATA_IN_BACKGROUND` used by the background run (HC reads simply return null without it); `clearStepsOnSignOut` adds unsubscribe, `clearBackgroundTypes` and `deleteUserDays`; `setAutoSteps(userId, on)`; the background run refreshes the user snapshot (M8) |
| `src/lib/steps/useSteps.ts` | `requestAccess(kind)`, `turnOn()` (consent only), `setAutoSteps`, `notNow()`, `useMotionInstead()` (iOS); exposes `firstAsk`, `store`, `healthEmpty`, `counter` |
| `src/lib/steps/healthkitObserver(.ios).ts` (new) | §4.3 |
| `index.ts` | `import './src/lib/steps/healthkitObserver';` before `expo-router/entry` |
| `src/lib/health/bridge.android.ts` | `RECORDS` / `READ_TYPES` = Steps, SleepSession, RestingHeartRate, Weight (P5); `requestSteps()` → `requestPermission([{read, Steps}, {read, BackgroundAccessPermission}?])`; `stepsBetween` returns `{steps, origins}` (for labels); `revokeAll()` → RNHC `revokeAllPermissions()` |
| `src/lib/health/bridge.ios.ts` | `READ_TYPES` = StepCount, RestingHeartRate, BodyMass, SleepAnalysis (P5); `requestSteps()` (StepCount only); `configureStepsBackground(on)` |
| `src/lib/health/sync.ts` | `uploadDays` **omits `steps`** (§0.5); connect also records `consent.store` for steps (the Health card copy says so); `disconnect` on Android calls `revokeAll()` and clears `consent.store`; on iOS it clears `consent.store` and shows the Settings path |
| `src/lib/health/types.ts` | `HEALTH_METRICS` that the phone reads: the 4 kept; the server's list is unchanged |
| `src/features/today/StepsCard.tsx` | §6 copy and states: one-button disclosure; `manual = !countingToday`; "Not now"; "Include your watch or fitness app" (Android, non-stepTracking); motion fallback (Android after an HC refusal, iOS when health is empty); "approximate"; first-day "counting since" |
| `src/app/(app)/health.tsx`, `src/features/health/ConnectCard.tsx` | Steps switch card; "both ways" line; the metric list without the 4 types; Disconnect = revoke |
| `src/app/(app)/settings.tsx` | Privacy & data: the "Count steps automatically" switch; footer copy (§6) |
| `src/app/(app)/account/preferences.tsx`, `account/data.tsx`, `account/memory.tsx` | P4 copy; the "never share" sentence (§6) |
| `scripts/tests/steps-counter.test.ts` (+ new `steps-merge.test.ts`) | §7; `test:steps` lists both files explicitly (`npx --yes tsx --test scripts/tests/steps-counter.test.ts scripts/tests/steps-merge.test.ts`). No glob: Windows shells don't expand it |

---

## 6. UI copy (exact strings)

### Today card: the disclosure sheet (P6: one button, "Continue")

**Title:** "Count your steps automatically"

**Points by path**

| Path | Points |
|---|---|
| Android `hc` (14+) | 1. "ÖRZA reads your daily step total from Health Connect — this phone's steps plus any watch or fitness app you use with it." 2. "Health Connect then keeps this phone's steps, so other health apps you allow can use them too." 3. "Only each day's total is saved to your ÖRZA account — on Today, your reports and the website. Never where you go." 4. "Turn it off any time in Settings › Privacy & data." |
| Android `phone` | 1. "Your phone counts steps with a low-power motion sensor, and Google Play services keeps them for ÖRZA — even when ÖRZA is closed." 2. as point 3 above. 3. as point 4 above |
| iOS `healthkit` | 1. "ÖRZA reads your daily step total from Apple Health — your iPhone and Apple Watch counted once, just like the Health app." 2–3. as above |
| iOS motion (fallback) | 1. "Apple Health has no steps for ÖRZA, so your iPhone's motion sensor can count them instead (the last 7 days, without a watch)." 2–3. as above |

When the full backfill applies (M9), add: "Your steps from the last 30 days come in too." (7 days for motion.)

**Footer caption**

| Path | Caption |
|---|---|
| Android `hc` | "Next, Health Connect shows what ÖRZA would like to read." |
| Android `phone` | "Next, your phone asks to allow “Physical activity”." |
| iOS `healthkit` | "Next, Apple Health shows what ÖRZA would like to read." |
| iOS motion | "Next, your iPhone asks to allow “Motion & Fitness”." |

**Button:** "Continue". When the OS permission is already granted, the button is "Turn on" and the sheet can be closed.

### Today card: other states

**Refused**
- Buttons: "Log steps", then "Open Settings" or "Open Health Connect", then "Not now — I'll log steps".
- "Not now" collapses the card for 30 days.

**Android after an HC refusal (phone has a counter)**
- Button: "Use this phone's motion sensor instead".

**Android `phone` granted, HC available, not stepTracking**
- Ghost button: "Include your watch or fitness app".
- Hint: "Reads Health Connect — Samsung Health, Fitbit and others write there."

**iOS, Health empty**
- Status: "Apple Health has no steps for ÖRZA yet. If Steps is off for ÖRZA, turn it on in Settings › Health › Data
  Access & Devices › ÖRZA."
- Buttons: "Log steps", "Use iPhone motion instead" (shown once).

**Source labels:** "From Health Connect", "From Apple Health", "Counted by this phone", "Counted by this phone ·
approximate", "Edited by you", "Saved".

**Optional (U5):** with HC origins, "From Samsung Health", "From Fitbit", or "From this phone" (origin `android` /
on-device).

**Status lines**
- First day of HC on-device: "Counting since {time} — Health Connect starts counting this phone's steps when you turn
  this on." If a START base applies: "Counting since {time}, on top of the {n} saved earlier today."
- Sampler estimate (today): unchanged.

### Health screen: the Steps switch card

**Title:** "Count steps automatically"

**Subtitle by state**

| State | Subtitle |
|---|---|
| HC on | "From Health Connect — this phone and your watch" |
| Recording API or sampler on | "Counted by this phone" |
| HealthKit on | "From Apple Health" |
| iOS motion on | "Counted by your iPhone's motion sensor" |
| Off | "Off — you log steps yourself" |

**"Both ways" line**

| Platform | Line |
|---|---|
| Android 14+ | "Your phone's steps are in Health Connect, so other health apps you allow see them too. ÖRZA doesn't add a second copy." |
| Android 9–13 | "ÖRZA reads steps that Samsung Health, Fitbit and others share through Health Connect." |
| iOS | "Your iPhone already saves its steps to Apple Health for every app you allow. ÖRZA reads them and never writes a second copy." |

**Off confirmation sheet**
- **Title:** "Stop counting steps automatically?"
- **Body:** "ÖRZA stops reading steps on this phone. Steps already saved stay in your account."
- **Platform note:**
  - Android: "Health Connect may keep counting this phone's steps for other apps. To remove ÖRZA's access, open Health
    Connect › App permissions › ÖRZA." Button: "Open Health Connect".
  - iOS: "To remove ÖRZA's access, open Settings › Health › Data Access & Devices › ÖRZA."
- **Buttons:** "Turn off", "Keep counting".

### Settings and Account

- **Settings › Privacy & data:** the same switch row.
- **Footer** (replaces "We never share personal health information without your consent."): "Your data is stored
  securely. Steps and anything read from Apple Health or Health Connect are only used to show your own progress — never
  for ads, never sold, and never sent to AI providers." This is true once B5 is live. Meals and photos are covered by the
  D3 AI consent; until then the sentence speaks only about health-store data.
- **AI toggle** (`preferences.tsx`): "Lets your conversations and meal logs, anonymized first, help make ÖRZA's AI better.
  Steps and anything read from Apple Health, Health Connect or your phone's motion sensors are never used for this."

### iOS purpose strings (P11)

| Key | Text |
|---|---|
| `NSHealthShareUsageDescription` | "ÖRZA reads your steps, sleep, resting heart rate and weight from Apple Health to fill in Today and your Health trends. Only daily totals are saved to your ÖRZA account." |
| `NSMotionUsageDescription` | "ÖRZA uses your iPhone's motion data to count your steps when Apple Health has none, and saves each day's total to your ÖRZA account." |
| `NSHealthUpdateUsageDescription` (only if ITMS-90683 forces it) | "ÖRZA doesn't save anything to Apple Health. If that ever changes, it will ask you first." |

---

## 7. Unit tests

### 7.1 `npm run test:steps` (pure; the existing 66 tests are kept and updated where the API changed)

**counter.ts**
- **T1.** The 15,000/h cap: 3,800 steps in 15 min is rejected, 3,700 is accepted, 14,000 in 1 h is accepted. The old
  50,000 test is updated.
- **T2.** A reboot with no `shutdown` sample before it → the day isn't complete. With a `shutdown` sample → complete.
- **T3.** `stepsInRange`:
  - a delta overlapping `from` is prorated;
  - a whole-day range equals `dailyStepCounts`;
  - a New York DST day.

**recording.ts**
- **T4.** 15-min buckets → day totals for Asia/Kolkata (+05:30), Asia/Kathmandu (+05:45), and New York spring forward
  (23 h) and fall back (25 h). Each split lands exactly at local midnight.
- **T5.** `recordingRange` floors to a UTC quarter-hour, and its end is `end − 1`.
- **T6.** The window:
  - a day before `max(subscribedAt, now − 10 d)` → null;
  - a day straddling the window start → partial `coverFrom`;
  - a day inside the window with no buckets → 0.
- **T7.** `recordingSince` with 1-min buckets: `at` is floored to the minute and the sum covers `[at, end)`.

**merge.ts**
- **T8.** Today: `max(store, phone)`; a tie gets the store label.
- **T9.** C3: on a past day the store wins when its `coverFrom ≤` the phone's, even though the phone is higher (Samsung
  8,000 vs sampler 8,700 → 8,000).
- **T10.** On the store's partial first day (HC grant at 14:00, 0 before it) with a whole-day phone count, the larger by
  non-estimated part wins.
- **T11.** Store 0 → null. A phone-only day → the phone.
- **T12.** C7: store 4,000 vs sampler 10,000 with 9,000 estimated → 4,000. A sampler-only estimated day → 10,000.
- **T13.** `hcCoverFrom`: pre-grant 0 → `grantAt`; pre-grant > 0 → `s`.
- **T14.** Phone sources compare and never add: Recording 5,000 and sampler 5,100 → 5,100.
- **T15.** `applyCoverFloor` (shared phone): `coverFrom` is raised to `consentAt`, and days ending before it → no
  reading.

**policy.ts (bases, plan, display)**
- **T16.** C4a: after an edit, phone and HC alternate as the best source over 10 reads, and the day grows by the real
  increments since the edit (no frozen day).
- **T17.** C4b: a watch backfill stamped before the edit isn't added (13,000, not 16,000).
- **T18.** START from a typed morning:
  - 6,000 typed at 09:00 and HC from 14:00 → 6,000 + HC since 09:00;
  - with whole-day HC history of 12,000 → 12,000.
- **T19.** M5c1: a phone edit while something counts → `edit`; with nothing counting → `start`.
- **T20.** M5c2: a web marker → `at = Date.parse(marker)` clamped to the day; a marker equal to `editRef` is ignored.
- **T21.** A past day edited after it ended → its value is the edit forever, and nothing is auto-saved.
- **T22.** M5c3: re-subscribe the same day (server 5,000, new `coverFrom` 13:00) → 5,000 + counted since 13:00.
- **T23.** Today never saves the estimated part, with or without a base.
- **T24.** `savePlan` for today: the throttle (≥ 50 steps / 10 min), mode `auto`, the `edit_ref` is passed through.
- **T25.** `savePlan` for a past day:
  - higher → `auto`;
  - lower and `server == autoSent` → `reconcile(expect)`;
  - lower and `server ≠ autoSent` → nothing;
  - `serverModes` false → nothing.
- **T26.** `shownSteps`: today = `max(value, server)` with the labels in §2.4; a past day = server; offline → value.

**plan.ts**
- **T27.** M7, store ON: pending until `e + 72 h`, then final after an ok save; a no-data day is final at `e + 72 h`.
- **T28.** M7, phone only: final when complete and `t ≥ e + 60 min`; never final with an uncertain gap before 72 h.
- **T29.** Lookback per source (30 / 9 / 9 / 7); the background run caps at 7 past days; no day before `coverFloor`.
- **T30.** M8: a day saved under Asia/Kolkata isn't re-read after the profile moves to Europe/London; today is.
- **T31.** M9: the first member on the install → full backfill; a second member → from consent; the same member
  returning → unchanged.
- **T32.** `firstAsk`:
  - stepTracking + HC → `hc`;
  - no stepTracking + counter → `phone`;
  - no counter + HC → `hc`;
  - neither → none;
  - S-A3 turns phone sources off when HC is ON on a stepTracking phone.
- **T33.** `healthEmpty`: 7 past nulls + today null → true; any value → false.

**save.ts (fake server that implements the modes)**
- **T34.** C1: edit 9,000, then a server-side raise attempt without a marker match is refused → the day stays 9,000 +
  counted.
- **T35.** C5: a second phone's lower `auto` never lowers the server, and phone A doesn't take it as an edit.
- **T36.** Response `'edited'` → the edit is taken; the next run saves edit + since with the new `editRef`.
- **T37.** `'not_higher'` → `server` updated, no retry loop.
- **T38.** Reconcile:
  - today saved 12,000 as the live max, and the next morning the store says 11,500 → 11,500;
  - if the website set 11,800 meanwhile → unchanged.
- **T39.** Legacy server (no `applied`): never reconcile; the GET guard still prevents lowering.
- **T40.** The consent gate: OS permission granted but no consent for this member → no reads, no saves. The switch off →
  reads stop. Sign-out deletes that member's day records.

### 7.2 Backend checks (B7, against the local server)

| Case | Expected |
|---|---|
| `manual` | sets `steps_edited_at` |
| `auto` higher with no marker | applied |
| `auto` when a marker exists and `edit_ref` is null | `edited` |
| `auto` with the matching `edit_ref` | applied |
| `auto` lower | `not_higher` |
| `reconcile` when `expect` matches | applied |
| `reconcile` when `expect` doesn't match | `changed` |
| mirror on an edited day | no raise |
| `normaliseDays` with steps for tomorrow | steps dropped |
| `GET /api/health/days` | steps = `tracking.steps` |
| coach prompt | has no steps |

---

## 8. Device test plan

The emulator (Medium_Phone AVD) has **no step counter**. Under S-R5 its Recording API path is therefore "no_sensor", and
the sampler is unavailable too. Background HealthKit delivery doesn't run on the Simulator [A-bg].

### 8.1 Emulator (Android, local server with the B-batch)

| ID | Check |
|---|---|
| E-1 | **No counter, HC available (API 34+ image):** `firstAsk = hc`. The disclosure has one "Continue" button and no X. The HC sheet lists Steps (+ "Access data in the background" when the feature is available). Grant → "Not counted yet" + "Log steps" (HC 0 → null). |
| E-2 | **Privacy link (P1):** HC › App permissions › ÖRZA › privacy policy opens `HealthPrivacyActivity` with the policy, signed in and signed out. Offline → the fallback text. Then check the merged manifest (§4.2). |
| E-3 | **HC data without a sensor.** Insert Steps with Google's **Health Connect Toolbox** [G-toolbox]. It is installed by `adb install` from `goo.gle/health-connect-toolbox`: **downloading it needs the user's OK**. Then check: Today = the HC total; past days follow HC; edit → "Edited by you" + steps inserted after it add on (T16/T17 live); insert a record dated before the edit → not added; first-grant day partial (S-H2). |
| E-4 | **Server modes (local):** edit on the website lower → the phone shows the edit on its next read, and `auto` saves never undo it. Reconcile: insert HC steps, save, delete some HC steps in Toolbox → the past day lowers next run; edit on the website first → it doesn't. |
| E-5 | **Member switch:** sign out → sign in as member B → no reads before B's disclosure; B's sheet says "Turn on" (permission already granted); no past days for B (M9). |
| E-6 | **The switch off** → no reads or saves (logcat); the off sheet's "Open Health Connect"; the Health screen Disconnect → HC shows no permissions for ÖRZA. |
| E-7 | **Background:** grant the background permission; run the WorkManager task (`adb shell cmd jobscheduler run -f in.co.ylo.orza <jobId>`, or the e2e `adb.sh` helper) with the app in the background → the HC read succeeds (server updated). Revoke background in HC → null, with no error UI. |
| E-8 | **P5:** the Health screen connect sheet lists only Steps, Sleep, Resting heart rate and Weight; the charts still draw, with steps from `tracking.steps` (B4). |
| E-9 | **Copy and HIG:** the "Not now" collapse survives a relaunch; "Log steps" is visible in the `undetermined` state. |

### 8.2 A real Android phone over USB (ask the user to connect one; ideally one Android 13 and one Android 14+, Pixel or Samsung)

| ID | Check |
|---|---|
| A-1 | **Recording API (Android ≤ 13, or 14+ after refusing HC)**: subscribe → walk 500 steps → measure the **latency** until `recordingRead` shows them (open question). If > 5 min, do step V3-c (foreground live top-up). |
| A-2 | **Reboot:** walk, reboot, walk → no loss, and the subscription survives (else re-subscribe on launch). App update (`adb install -r`) → the subscription survives. |
| A-3 | **Revoke Physical activity in Settings** → `subscribe`/`readData` errors are handled (no crash; the card shows "Open Settings"). Re-grant → `subscribedAt` is new and the first day is partial. |
| A-4 | **Sign out → sign in as another account** → the previous member's walking is unreadable (unsubscribe) and B sees nothing before consent. |
| A-5 | **Android 14+ HC on-device:** the grant at midday with a typed morning count → START (C8). Today matches the HC app's Steps within a minute or two. Samsung / One UI: `stepTracking` true? (open question). |
| A-6 | **Samsung + Galaxy Watch, or Pixel + Fitbit / Wear OS:** for 3 days, ÖRZA's past days equal the HC app's numbers the next morning (reconcile). Today is ≥ HC and close to it. |
| A-7 | **Sampler fallback** (dev-only override `__DEV__` flag forcing `recordingStatus = 'unavailable'`): the hourly samples work; reboot without a shutdown sample → the day stays pending and is labelled "approximate". The midnight alarm is inexact (`getStatus().exactMidnight` is still reported but unused). |
| A-8 | **Killed-app behaviour (C10):** force-stop or kill the app for 3 h and walk 1,000 steps → compare the Recording API and the sampler. |
| A-9 | **Background:** Doze (`adb shell dumpsys deviceidle force-idle`) plus the WorkManager run → the website updates. |
| A-10 | **Zone:** profile Asia/Kolkata, phone set to Asia/Singapore → no row for tomorrow, and no evening walk counted on two days (C2). Change the profile zone → past days frozen (M8). |
| A-11 | **Android 9 device, if available:** `subscribe` needs the GMS `ACTIVITY_RECOGNITION`? Add it only if this fails. |

### 8.3 iPhone (TestFlight, D2; HealthKit background needs a real device)

| ID | Check |
|---|---|
| I-1 | **Upload:** ITMS-90683 with `NSHealthUpdateUsageDescription: false`? (P10). The generated `PrivacyInfo.xcprivacy` has UserDefaults CA92.1 (P17). The entitlements include background delivery. |
| I-2 | The disclosure → the HealthKit sheet shows **Steps only**. Allow → Today = the Health app's steps. Turn Steps off in the sheet → "Health empty" state, Log steps, a one-time motion offer → the Motion prompt → counting. |
| I-3 | **Background delivery:** close the app, walk 15 min, wait up to 1 h → the website updates without opening the app. Locked phone → no save, then a catch-up on unlock. |
| I-4 | **Apple Watch:** a stroller or shopping-cart walk → ÖRZA's past day the next morning equals the Health app (C3). |
| I-5 | **Member switch** as in E-5. The switch off → `clearBackgroundTypes` (no wake-ups). |
| I-6 | **C15:** a walk across midnight → ÖRZA's two days vs the Health app's two days. If they differ, apply the C15 fix. |

---

## 9. Store declarations to add to the D3 checklist (`docs/PROGRESS.md` D3 note)

### Google Play

**Health apps declaration** [G-decl][G-pub]: re-file.
- **Features:** Activity and fitness; Sleep; Nutrition and weight management; Medication management.
- **Data types:** `READ_STEPS`, `READ_HEALTH_DATA_IN_BACKGROUND`, `READ_SLEEP`, `READ_RESTING_HEART_RATE`, `READ_WEIGHT`.
  Remove Active calories, Distance, Heart rate and Hydration.

**Justifications**

| Permission | Justification |
|---|---|
| `READ_STEPS` | "Today shows the member's daily steps toward their step goal without typing. ÖRZA reads the day's aggregated, de-duplicated step total (phone, watches, fitness apps) and saves only the daily total to the member's account, shown on Today, the Health trends screen, weekly reports and the website." |
| `READ_HEALTH_DATA_IN_BACKGROUND` | "Keeps today's step total on the member's account current while ÖRZA is closed, so the step goal, website dashboard and weekly report are up to date. Runs about hourly and reads only daily step totals for today and the previous few days." |
| `READ_SLEEP` | "Sleep chart on the Health screen and website." |
| `READ_RESTING_HEART_RATE` | "Resting heart-rate chart on the Health screen." |
| `READ_WEIGHT` | "Weight trend and weight tracker (fills days with no weigh-in)." |

**Privacy policy URL:** the same page as `HealthPrivacyActivity` (`/privacy`, with the B6 section).

**Data safety** [G-ds]:
- Health and fitness › **Fitness info** (steps; sleep) and **Health info** (resting heart rate, weight).
- Collected: yes. Shared: no. There is no HC write, and B5 removes steps from AI prompts. Re-check meals and AI in D3.
- Optional for the user. Purposes: App functionality, Personalization. Encrypted in transit; deletion available.
- Processing only on the phone (Recording API buckets, sampler samples) is not collection.

**Other Play items**
- `ACTIVITY_RECOGNITION`: no form, but the prominent disclosure (the §6 sheet) must come immediately before the request.
- `SCHEDULE_EXACT_ALARM`: justified by medicine alarms only; steps no longer uses exact alarms (P14).
- No foreground-service declaration for steps. No `WRITE_STEPS`.
- **Reviewer notes:**
  - Steps count automatically after one consent.
  - On a phone without Health Connect or a step counter, Today offers "Log steps".
  - Health Connect › ÖRZA › Privacy policy opens the policy.
  - Provide a demo account.

### App Store

- **Entitlements:** `com.apple.developer.healthkit`, `com.apple.developer.healthkit.background-delivery`. No
  `healthkit.access` (health records). `UIBackgroundModes`: only `processing` (expo-background-task).
- **Info.plist:** the §6 strings. `NSHealthUpdateUsageDescription` only if I-1 forces it.
- **App privacy** [A-priv]:
  - Health & Fitness › **Health** (HealthKit) and **Fitness** (Motion & Fitness);
  - collected, linked to the user, App Functionality + Product Personalization;
  - not tracking.
- **Privacy manifest:** UserDefaults CA92.1 (P17).
- **Listing description** mentions Apple Health integration (P18; 2.5.1).
- **Review notes:**
  - Steps on Today come from Apple Health after one consent.
  - Everything works with every permission denied (Log steps).
  - Background updates are hourly at most.
  - Provide a demo account.
- **App-wide (from P3/P6):**
  - explicit AI-sharing consent naming the provider, before the first AI feature (5.1.2(i));
  - fix the "never share" sentences app-wide;
  - HIG pre-alert checks on `AlarmPermissionPrompt` ("Not now") and Snap ("Allow access");
  - medicine photos out of `Paths.document`.

---

## 10. Ordered checklist (each step ≤ about 1 hour; tick as you go)

**Rules for every step**
- Read `docs/notes/steps-v2.md` (this plan) §0 first.
- Run `npx tsc --noEmit`, `npx expo lint` and `npm run test:steps` before ticking a JS step.
- Commit locally at the end of each phase (WIP commits are the project's resume mechanism).
- Push mobile or web only with the user's OK.
- Never hand-edit `android/` or `ios/`.
- Dependencies via `npx expo install`, except Gradle deps inside `modules/`.

**Phase 0: setup**

- [x] **S0.** Confirm the emulator run that is editing `orza-mobile` has finished and committed.
  - Copy this file to `docs/notes/steps-v2.md` and add a PROGRESS log line "steps v2 started (plan: docs/notes/steps-v2.md)".
  - Ask the user:
    - (a) OK to build the backend batch locally;
    - (b) client sign-off on "no WRITE_STEPS" (§2.8 note);
    - (c) a real Android phone for §8.2;
    - (d) OK to download Health Connect Toolbox for E-3.

**Phase B: backend (web, local only)**

- [ ] **B1.** `track/steps` modes + response (§2.5) and the `tracking.ts` helpers.
- [ ] **B2.** `steps_edited_at` in `TrackingDay` and in the dashboard/today response.
- [ ] **B3.** Mirror skips edited days; `normaliseDays` drops future-dated steps.
- [ ] **B4.** `GET /api/health/days` steps from `tracking.steps`.
- [ ] **B5.** Coach prompt without steps.
- [ ] **B6.** Privacy page section `#phone-app` + AI-improvement wording (the user reviews the text).
- [ ] **B7.** `scripts/check-steps-modes.mjs` against `orza-localtest` (the §7.2 cases). Commit on the backend branch;
  not pushed.

**Phase J: pure JS core (no native; test-first)**

- [ ] **J1.** `counter.ts`: 15k cap, `reason`, uncertain gaps, `stepsInRange` + T1–T3.
- [ ] **J2.** `recording.ts` + T4–T7.
- [ ] **J3a.** `types.ts` new shapes. `merge.ts` M0–M4 + T8–T15. Delete `bestOf`, keeping a thin adapter until R2/R4.
- [ ] **J3b.** `merge.ts` M5 (`dayValue`, base creation) + T16–T22.
- [ ] **J4.** `policy.ts`: the new `DayBase` and `DayRecord`, `savePlan`, `shownSteps` + T23–T26. Delete `rebased` and
  `withBase`.
- [ ] **J5.** `plan.ts`: settle, lookback, zone freeze, backfill, `firstAsk`, `healthEmpty` + T27–T33.
- [ ] **J6.** `save.ts` with modes, response handling and the legacy branch + T34–T39 (fake server).
- [ ] **J7.** `store.ts` split (prefs in document, days in cache), v1 migration, `deleteUserDays` + T40 (store part).
  Then commit "steps v2: pure core".

**Phase N: native Android (one native rebuild at the end of the phase)**

- [ ] **N1.** `orza-steps` Gradle deps + `StepRecording.kt` + the module functions + the TS wrappers (`modules/orza-steps/src/index.ts`).
- [ ] **N2.** `HealthFeatures.kt` + wrapper.
- [ ] **N3.** `HealthPrivacyActivity.kt` + manifest activity and alias; remove the RNHC plugin from app.json.
- [ ] **N4.** `StepScheduler.armMidnight` inexact only (P14); keep `reason` in `getSamples` output.
- [ ] **N5.** app.json Android permissions (P5 removals, background add).
  - `npx expo install --check` (the 6 Expo patch updates from D1).
  - Prebuild and Gradle build in the build copy.
  - Check the merged manifest (§4.2). Commit "steps v2: native Android".

**Phase R: readers, sync, iOS config**

- [ ] **R1.** `health/bridge.android.ts`: P5 types, `requestSteps`, `stepsBetween` with origins, `revokeAll`.
- [ ] **R2.** `reader.android.ts`: sources S-A1…S-A4, the Recording API path, HC first-grant coverage, `sinceAt`.
- [ ] **R3.** iOS config: app.json healthkit (`background: true`, `NSHealthUpdate… false`, share text), the motion
  string, `ios.privacyManifests`; `bridge.ios.ts` P5 types, `requestSteps`, `configureStepsBackground`.
- [ ] **R4.** `reader.ios.ts`: HealthKit primary, the CMPedometer fallback by consent, `sinceAt`, health-empty detection.
- [ ] **R5a.** `sync.ts`: consent gate, `firstAsk`, the new save flow wiring, `setAutoSteps`.
- [ ] **R5b.** `sync.ts`: background (snapshot refresh, past-day cap), sign-out (unsubscribe, `clearBackgroundTypes`,
  `deleteUserDays`); `healthkitObserver(.ios).ts` + the `index.ts` import.
- [ ] **R6.** `health/sync.ts`: the import without steps, connect sets `consent.store`, disconnect revokes.
  `useSteps.ts` API. Commit "steps v2: readers + sync".

**Phase U: UI**

- [ ] **U1.** `StepsCard`: one-button disclosure (per-platform copy §6), "Turn on" variant, `manual = !countingToday`,
  "Not now", the watch/app button on the card, labels and status lines.
- [ ] **U2.** Motion fallback flows: Android after an HC refusal; iOS health-empty + the one-time offer.
- [ ] **U3.** Health screen: the Steps switch card, the "both ways" line, the off sheet; ConnectCard metric list (P5);
  Disconnect = revoke.
- [ ] **U4.** Settings › Privacy & data switch + footer; `preferences.tsx` AI copy; "never share" sentences in
  `account/data.tsx` and `memory.tsx`. Commit "steps v2: UI".
- [ ] **U5** (optional). HC origin labels ("From Samsung Health"); a time-zone mismatch hint on Today when the phone's
  offset ≠ the profile's (R8d).

**Phase V: verify and ship**

- [ ] **V1.** All checks: typecheck, lint, `test:steps`, `test:alarms`. Run §8.1 E-1…E-9 on the emulator against the
  local server with the B-batch. Fix and retest. Record the results in `docs/notes/steps-v2.md`.
- [ ] **V2.** Ask the user to connect the Android phone(s). Run §8.2 A-1…A-11.
- [ ] **V3-c** (only if A-1 latency > 5 min). Foreground live top-up: while Today is open, add the sampler's `sampleNow()`
  delta since the latest Recording bucket end, as a phone source compared under M1. Never an FGS.
- [ ] **V4.** With the user's OK:
  - push the backend batch (B1–B6) and deploy;
  - confirm `applied` in production responses, then delete the legacy save branch (J6) in a follow-up commit;
  - push mobile; update PROGRESS (tick "auto steps v2").
- [ ] **V5.** D2 (TestFlight): §8.3 I-1…I-6. If ITMS-90683 appears, restore the update string.
- [ ] **V6.** D3: the §9 items (Play declaration, Data safety, App privacy, listing, review notes, app-wide AI consent).

---

## 11. Note for the client: "sync with other health apps, both ways"

- **Into ÖRZA:**
  - iPhone: everything Apple Health has, iPhone and Apple Watch counted once.
  - Android: everything in Health Connect (Samsung Health, Fitbit, Google and other apps or watches), de-duplicated by the
    member's own priority list.
  - Phones without either still count with the phone's own motion sensor.
- **Out of ÖRZA:**
  - On iPhone and on Android 14+, the phone's steps are already in Apple Health and Health Connect for every app. On
    Android, ÖRZA's permission is what switches Health Connect's phone counting on.
  - ÖRZA deliberately doesn't write a second copy. Apps that add records up would count the steps twice, and Apple puts
    a new source above the Watch.
  - Writing ÖRZA's own data (meals, water, weight) to Health is possible later as a separate feature.

---

## Appendix A: if an HC steps writer is ever required (Android 9–13 only)

Adopt critic R15 W1–W6 unchanged:
- **W1.** Exclude ÖRZA's own origin from every read.
- **W2.** Write raw Recording API or sampler intervals only.
- **W3.** Never on stepTracking phones or iOS.
- **W4.** One record per interval:
  - `clientRecordId` `orza-steps:<startMs>`;
  - `clientRecordVersion` = the write time;
  - `Metadata.autoRecorded(Device(TYPE_PHONE, …))`;
  - zone offsets from each record's own instant;
  - no zero records.
- **W5.** Delete ÖRZA's record when another origin covers that interval, checked on every run.
- **W6.** Toggle off = stop writing.

Write natively in `orza-steps` (RNHC writes null zone offsets). It costs:
- `WRITE_STEPS` in the declaration;
- Data safety "shared" unless the consent qualifies;
- a feature reviewers on Android 14+ can't see.

---

## Sources (checked 2026-10-27 unless marked)

- [G-steps] Health Connect, Track steps:
  - "With Android 14 (API level 34) and SDK Extension version 20 or higher, Health Connect provides on-device step
    counting. If any app has been granted the READ_STEPS permission, Health Connect starts capturing steps";
  - the SDK-extension check code;
  - synthetic package names from June 2026, and `getCurrentDeviceDataSource` (extension 22);
  - Recording API advice for Android 13 and lower.

  https://developer.android.com/health-and-fitness/health-connect/features/steps
- [G-rec] Recording API on mobile: `ACTIVITY_RECOGNITION`; "stores up to 10 days of data"; "If a subscription is removed by
  calling unsubscribe, collected data won't be accessible"; accountless; the sample's `bucketByTime(1, TimeUnit.DAYS)`;
  WorkManager advice: https://developer.android.com/health-and-fitness/guides/recording-api
- [G-lrc] `LocalRecordingClient` reference (`LOCAL_RECORDING_CLIENT_STEPS_MIN_VERSION_CODE`, "if only using
  TYPE_STEP_COUNT_DELTA"; the numeric values are from research [S2], not re-read):
  https://developers.google.com/android/reference/com/google/android/gms/fitness/LocalRecordingClient
- [G-read] Health Connect, Read data:
  - `READ_HEALTH_DATA_IN_BACKGROUND`;
  - `getFeatureStatus(FEATURE_READ_HEALTH_DATA_IN_BACKGROUND)`;
  - "your app should still run … with the permissions that the user granted";
  - 30-day limit;
  - "use aggregate() instead of readRecords() to avoid double counting".

  https://developer.android.com/health-and-fitness/health-connect/read-data
- [G-agg] Health Connect, Aggregate data: "keeps only the data from the app with the highest priority"; "Only the
  Activity and Sleep data types are deduped": https://developer.android.com/health-and-fitness/health-connect/aggregate-data
- [G-start] Health Connect, Get started: the rationale activity (`ACTION_SHOW_PERMISSIONS_RATIONALE`) and the alias
  (`VIEW_PERMISSION_USAGE` + `HEALTH_PERMISSIONS`); "The activity must display the same privacy policy you provide … in
  the Google Play Console": https://developer.android.com/health-and-fitness/health-connect/get-started
- [G-toolbox] Health Connect Toolbox (reads and writes all HC data types; installed with `adb install` from
  goo.gle/health-connect-toolbox):
  https://developer.android.com/health-and-fitness/health-connect/test/health-connect-toolbox
- [G-hcpol] Play Console Help, Android health permissions guidance: "Request the minimum data types needed"; "Sharing
  health data with third parties without explicit, informed user consent" (prohibited); privacy policy contents:
  https://support.google.com/googleplay/android-developer/answer/12991134
- [G-decl] Play Console Help, Health apps declaration: https://support.google.com/googleplay/android-developer/answer/14738291
- [G-pub] Health Connect, Publish (per-type justification, re-filing, same privacy policy):
  https://developer.android.com/health-and-fitness/health-connect/publish
- [G-ds] Play Console Help, Data safety: https://support.google.com/googleplay/android-developer/answer/10787469
- [G-alarm] Schedule alarms (exact alarms only for user-facing, precisely timed functions):
  https://developer.android.com/develop/background-work/services/alarms/schedule
- [A-guide] App Review Guidelines:
  - 5.1.1(iv): "provide alternative solutions for users who don't grant consent";
  - 5.1.2(i): "including with third-party AI, and obtain explicit permission before doing so";
  - 5.1.3(i): HealthKit / Motion and Fitness;
  - 5.1.3(ii): "must not write false or inaccurate data into HealthKit … may not store personal health information in
    iCloud".

  https://developer.apple.com/app-store/review/guidelines/
- [A-hig] HIG, Privacy, "Pre-alert screens, windows, or views": "Include only one button … Use a term like 'Continue' or
  'Next'"; "don't provide a way for people to leave the screen or window without viewing the system alert":
  https://developer.apple.com/design/human-interface-guidelines/privacy
- [A-bg] `enableBackgroundDelivery(for:frequency:withCompletion:)`:
  - the background-delivery entitlement (iOS 15+);
  - "on iOS, stepCount samples have an hourly maximum frequency";
  - observer setup at launch;
  - three missed completion handlers stop delivery;
  - not on the Simulator.

  https://developer.apple.com/documentation/healthkit/hkhealthstore/enablebackgrounddelivery(for:frequency:withcompletion:)
- [A-hkscq] HKStatisticsCollectionQuery / HKStatisticsQuery (no documented rule for samples that cross an interval;
  hence device test I-6): https://developer.apple.com/documentation/healthkit/hkstatisticscollectionquery
- [A-hk-auth] / [A-hk-priv] Authorizing access to health data; Protecting user privacy (read denial looks like no data;
  the store is encrypted while locked; usage keys) [research S17]:
  https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data ;
  https://developer.apple.com/documentation/healthkit/protecting-user-privacy
- [A-prio] Apple Support, Manage Health data (new sources are listed above existing ones) [research S18, critic AP-prio]:
  https://support.apple.com/en-us/108779
- [A-priv] App privacy details: https://developer.apple.com/app-store/app-privacy-details/
- [A-itms] ITMS-90683 forum thread (community evidence, for P10): https://developer.apple.com/forums/thread/695864
- **Local code read:**
  - `node_modules/react-native-health-connect/app.plugin.js` (manifest only: rationale filter on MainActivity + alias);
  - `node_modules/react-native-health-connect/android/build.gradle:95` (`connect-client:1.1.0`);
  - `node_modules/@kingstinct/react-native-healthkit/src/specs/CoreModule.nitro.ts:58-67` (`configureBackgroundTypes(typeIdentifiers, updateFrequency)`, `clearBackgroundTypes()`);
  - `node_modules/@react-native-healthkit/core/src/types/Background.ts:4-9` (`UpdateFrequency.hourly = 2`);
  - `@kingstinct/react-native-healthkit/app.plugin.ts:13-45` (`background`, `NSHealthUpdateUsageDescription: false`).
