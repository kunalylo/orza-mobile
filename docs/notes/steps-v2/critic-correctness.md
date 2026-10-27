# Auto steps v2: correctness critique

Date: 2026-10-27. Independent critic, **correctness lens**: what makes ÖRZA's daily step count wrong, or different from
the number other health apps show. I read `research.md`, `E:\aylo\orza-mobile\docs\PROGRESS.md`, every file in
`src/lib/steps`, `src/lib/health`, `modules/orza-steps` and the web side that stores steps (`E:\aylo\orza`). I changed
nothing in either repo. Paths without a drive are relative to `E:\aylo\orza-mobile`. `[name]` points to **Sources** at the
end. Severity: H = a wrong number that the member will notice, M = wrong in common edge cases, L = rare or small.

---

## 0. Verdict

The research is right that taking the **max** of sources never adds two sources together, so it never double counts
by summing. But four things still make the number wrong, and only one of them is in the research:

1. **The phone app has two writers to `tracking.steps`, and the second one can undo the member's correction (C1).** The
   Health sync (`/api/health/import`) only ever raises the day. So a lower number the member types ("a bus ride was
   counted") goes back up at the next Health sync, within 3 hours. Nothing in `save.ts` can detect a value going up.
2. **The two writers use different day definitions (C2).** The steps sync uses the profile time zone. The Health sync
   uses the phone's time zone and the store's own local days. The server also accepts tomorrow's date from an import.
   While the member travels, or whenever the profile zone isn't the phone's zone, steps land on the wrong day and some
   are counted twice across days.
3. **Max plus "never lower" doesn't produce the health app's number (C3).** Apple Health and Health Connect (HC) resolve
   overlapping sources by the member's **priority list**, not by the highest value. ÖRZA's max goes above the health
   app whenever an unfiltered or lower-priority source counts more, and "never lower" keeps it there.
4. **Bases (the member's edit, a mid-day start) follow the source by value (C4).** When two close sources take turns
   being the highest, every switch throws away the steps walked since the last switch. When a watch syncs late, steps
   from before the edit are added on top of it.

Then: past days go final before late watch data arrives (C6); an estimate can beat a real reading (C7); only the
sampler gets a partial first day (C8). The Recording API and the HC writer each bring their own traps (C9, C11).

**What a correct v2 needs** (section 2):
- one reference number per platform: the health store's de-duplicated total, in the member's day;
- the phone counter only as a fallback, and as a live tail for today;
- bases anchored in time, not in value;
- three server write modes: raise-only for automatic saves, set and mark for the member's edits, and a conditional lower
  that corrects only this phone's own earlier save;
- one day definition everywhere.

---

## 1. Findings

### C1 (H): The Health sync undoes the member's lower edit

**Code**
- `src/app/(app)/_layout.tsx:15,18` mounts both `useHealthAutoSync()` and `useStepsAutoSync()`.
- `src/lib/health/sync.ts:109-147` (`syncHealth`) runs on launch and on every foreground, at most every 3 h. It reads 30
  days, steps included (`bridge.android.ts:187`, `bridge.ios.ts:61`), and posts them to `/api/health/import`.
- Web `E:\aylo\orza\src\lib\care\health.ts:359-385` (`mirrorIntoTracking`) raises `tracking.steps` whenever the import is
  higher (`steps: { $lt: steps }` at line 379).
- `src/lib/steps/policy.ts:114-117` (`editedOnServer`) only reacts to a server value that is **lower** than this phone's
  save.
- `policy.ts:171-188` (`shownSteps`) shows the highest of live, sent and server.

**Scenario**
1. Today the phone and HC count a 40-minute bus ride: 12,400.
2. The member taps "Not right? Edit" and enters 9,000. `saveManualSteps` posts 9,000, and `applyManualSteps` records an
   edit base.
3. On the next return to the app (at most 3 h later), `syncHealth` uploads HC's day total of 12,650. The mirror sets
   `tracking.steps = 12,650`.
4. Today now shows 12,650, labelled "saved". The steps sync can't post its 9,000 + Δ (`serverAllows` is false), and it
   doesn't notice anything, because the server value went **up**.

The member's correction is gone without a word. The same happens:
- to any past day within 30 days that the member lowers, on the phone or on the website;
- to a web edit, once the phone's next Health sync runs.

**Fix:** R9 (an edit is sticky on the server) and R8 (the phone's import sends steps computed by the steps pipeline).

### C2 (H): Two writers with two day definitions, and the import accepts tomorrow

**Code**
- Steps sync: days in the **profile** zone (`sync.ts:160-161`, `shared.ts:8-14` `dayRanges`).
- Health sync, phone side:
  - `src/lib/health/aggregate.ts:10-18`: `localDate` and `rangeStart` use the **phone's** zone.
  - HC `aggregateGroupByPeriod` (`bridge.android.ts:105-116`) groups by local date-times. HC matches those against each
    record's own zone offset, and "Record without specifying zoneOffset will assume the current system zone offset at
    query time" [HC-time].
  - HealthKit `queryStatisticsCollectionForQuantity` is anchored at the phone's local midnight (`bridge.ios.ts:50-69`).
- Web `normaliseDays` (`health.ts:164-202`):
  - keeps a plain `YYYY-MM-DD` as written (`dayBucketOf`);
  - lets dates up to `latest = today + 1` through (lines 166 and 179), so **tomorrow** in the profile zone is accepted.
    `/api/track/steps` refuses that same date (`track/_shared.ts:11-17`).

**Scenario: the profile zone is Asia/Kolkata (also the server default), the phone is in Singapore (2.5 h ahead)**
- The phone's day D runs from D−1 21:30 IST to D 21:30 IST. The import writes that total to row D, and the steps sync
  writes the IST day to row D. Row D keeps the larger one, which includes D−1's evening walk. That walk is also in row
  D−1, so weekly totals and Reports count it twice.
- At 00:30 Singapore time on D+1 (22:00 IST on D), the import creates row **D+1** with steps that are also in IST day D.

**Same class, smaller cases**
- The member never set a profile zone and lives elsewhere: the server default is IST, so the mismatch is permanent.
- The website's Health page (`health_days`, store only, phone zone) and Today/Reports (`tracking.steps`) show two
  different numbers for the same date.

**Fix:** R8.

### C3 (H): Max plus "never lower" drifts above the health app

**Why the platforms differ from max**
- **HC:** for Activity types, the aggregate "keeps only the data from the app with the highest priority" wherever
  sources overlap. Only the member can change that priority list [HC-agg].
- **Apple Health:** "the data source at the top will take priority over others" [AP-prio].
- **ÖRZA** (`shared.ts:33-50` `bestOf`) takes the **highest** of the store and the phone's own counter, then never
  lowers a saved count (`policy.ts:151-162`, and the web mirror).

**Scenarios**
- **Samsung phone with a Galaxy Watch.** Samsung Health (watch prioritised) shows 8,000. ÖRZA's sampler counts 8,700 on
  the raw `TYPE_STEP_COUNTER`, phone in pocket on a bumpy ride. ÖRZA shows and saves 8,700.
- **iPhone with an Apple Watch, pushing a stroller.** The watch on the wrist undercounts, and Health keeps the watch's
  intervals. CMPedometer (iPhone only, `reader.ios.ts:89`) counts more, so ÖRZA shows the iPhone's number. Apple Health
  shows less.
- **HC during the day.** On Android 14+ the on-device phone steps fill the intervals the watch hasn't synced yet. When
  the watch syncs, its data replaces the phone's for those intervals, so **HC's own total can go down**. ÖRZA keeps the
  earlier, higher number.
- **Android 14+ in v2 as researched.** Both the HC aggregate (which includes on-device phone steps) and the Recording API
  read the same sensor. The max always picks the slightly higher of two near-equal values, so ÖRZA sits a few dozen
  steps above the HC app every day.

None of this double counts, but the client's test ("like other health apps") fails every time a member compares.

**Fix:** R1–R4.

### C4 (H): Bases follow the source by value

**Code**
- `policy.ts:83-95` (`withBase`): `counted = base.steps + (auto.steps − base.auto)`.
- `policy.ts:98-102` (`rebased`): when the best source changes, the base is re-anchored at the new source's current
  value, keeping `last`.
- `save.ts:105-119` applies the re-anchor and the new `last`.

**(a) Source flapping loses steps.** The member edits today to 9,000 at 15:00, while the phone counter says 12,000. The
base is {9,000, auto 12,000, phone}.

| Time | Phone | HC | Best source | Day |
|---|---|---|---|---|
| 15:30 | 12,100 | 12,050 | phone | 9,100 |
| 15:31 | 12,100 (hourly sample, no live read) | 12,200 | HC → re-anchored at 12,200 | 9,100 |
| 16:00 | 12,500 (live) | 12,300 | phone → re-anchored at 12,500 | 9,100 |

The member walked 400 steps (phone) or 250 (HC) after 15:30, and the day still says 9,100. Every switch discards what
the new source gained since the base last sat on it. v2 adds sources (HC on-device writes about every minute
[HC-steps]; the Recording API; the live `sampleNow`), so switches become frequent. An edited or mid-day-started day can
stay frozen all day.

**(b) A late watch sync is counted twice.** The edit is made at 15:00 on HC = 8,000, because the watch hasn't synced
since 10:00; the member types 11,000. At 18:00 the watch syncs 10:00–18:00 = 5,000 steps, 3,000 of them before 15:00.
HC becomes 13,000, and the day becomes 11,000 + 5,000 = 16,000. The right value is 11,000 + 2,000 = 13,000.

`startBase` (`policy.ts:125-128`) has both problems.

**Fix:** R6. Anchor bases in time. "Counted after the base" is a source's own sum over `[base.at, now]`.

### C5 (M-H): The read-then-POST race can lower another writer's count, and the other phone then misreads it as an edit

**Code**
- `save.ts:123-149`: GET the server value, then POST a SET. The race is documented in the code.
- `policy.ts:114-117` (`editedOnServer`).

**Scenario (one member, an iPhone A and an Android B; or one phone and the import mirror)**
1. B reads 5,000.
2. A posts 6,000.
3. B posts 5,500. The server now has 5,500.
4. A's next server read is 5,500. That is below A's saved 6,000 and was requested after A's save, so `editedOnServer`
   accepts it as the **member's edit** (`save.ts:92`).
5. A shows "Edited by you" and counts from 5,500, staying 500 low for the rest of the day.

Slow mobile networks and background runs make the window seconds long, not milliseconds.

**Fix:** R10. Automatic saves use an atomic `$max` on the server, so they can never lower anything. A lower server value
is then always a real edit.

### C6 (M-H): Past days go final before late data arrives

**Code**
- HC and Apple Health candidates are `complete: !!health[i]` (`reader.android.ts:113`, `reader.ios.ts:87`).
- CMPedometer is complete whenever the read returned anything, 0 included (`reader.ios.ts:89`).
- `sync.ts:269` marks the day final after one save. `plan.ts:11` sets `FINAL_DAYS = 7`.

**What goes wrong**
- Watch data often reaches the store hours or days late: Fitbit and Samsung Health push to HC in batches, an Apple Watch
  can be out of range. A day is final once it has been read with any value at all, and the steps sync never reads it
  again.
- Today the 30-day Health sync covers for this, but only for members who connected the Health screen.
- v2 plans a steps-only grant from Today (research G1/G4). Those members have no Health sync, so the late watch steps
  are lost for good.
- An iPhone day that CMPedometer reads as 0 (phone left at home, watch worn) becomes final at 0.

**Fix:** R5.

### C7 (M): An estimate can beat a real reading, and is saved for good

**Code**
- `counter.ts:184-202` (a long gap across midnight) and `counter.ts:257` spread the steps over the days by time and flag
  them as estimated.
- `bestOf` compares totals, estimate included.
- `postTarget` (`policy.ts:135-143`) leaves the estimate out only for today **without** a base. With a base, the
  estimate is posted even for today (`withBase` uses `day.steps`).

**Scenario**
1. The app is force-stopped Monday 20:00, so no alarms run.
2. It is opened Thursday 20:00 with 30,000 steps on the counter, which the sampler spreads at about 10,000 a day.
3. Real days: Tuesday 16,000 (a hike), Wednesday 4,000, both in HC from a watch.
4. `bestOf` gives Tuesday 16,000 (correct) but Wednesday 10,000 (the estimate wins). Wednesday is saved final at
   **+6,000**.

**Fix:** R7.

### C8 (M): Only the sampler gets a partial first day; every new source has one

**Code:** `policy.ts:120-122`. The START base applies only to source `phone` with `partialFrom`. HC, HealthKit and
CMPedometer never report `partialFrom`.

**Scenario (Android 14+)**
1. The member typed 6,000 this morning.
2. They grant READ_STEPS at 14:00. HC on-device counting starts only once some app holds READ_STEPS [HC-steps], so there
   is no data from before 14:00.
3. At 21:00 HC reads 6,100 and marks it `complete`. ÖRZA saves max(6,000, 6,100) = 6,100.
4. The real total is about 12,100.

**The same partial first day happens**
- on the Recording API's first day: data exists only "since the latest subscription" [REC];
- after a re-subscribe: a reinstall, a sign-out, or a permission that was revoked and granted again;
- on the sampler's first day after a sign-out cleared its samples. This case is already handled.

**Before coverage starts:** an empty or 0 result from a source must be "no data", not 0. Otherwise the day can be marked
final at 0 and stop being read (see C6).

**Fix:** R11.

### C9 (M): Recording API traps

1. **Google's sample code buckets the wrong days.** Its example reads `bucketByTime(1, TimeUnit.DAYS)` from `now − 1
   week` [REC], which gives rolling 24-hour windows that start at the current time of day, not local days. The research's
   15-minute buckets aligned to UTC quarter hours are correct; keep them, and never copy the sample.
2. **The 10-day window and the server's history.**
   - The server is the record of truth for anything older than the window.
   - A Recording API read for a day outside `[subscribedAt, now]`, or older than 10 days, is **no data**, never 0.
   - `FINAL_DAYS = 7` is safe. When the app comes back after more than 7 days, read back to 9 days for this source.
3. **Unsubscribe and account switches.**
   - "If a subscription is removed by calling unsubscribe, collected data won't be accessible" [REC].
   - The subscription belongs to the app, not to the ÖRZA account. Without an `unsubscribe` at sign-out, the next
     member to sign in on that phone reads the previous person's walking for the last 10 days.
   - Unsubscribe at sign-out. Subscribe at sign-in with `partialFrom = subscribedAt`.
4. **Freshness.** How soon a step appears in `readData` isn't documented. A past day is complete only on a read taken
   some margin after its midnight (60 min, adjusted after the device test). Today's number gets a live tail (R3).
5. **The read range is inclusive at both ends** (research §1.1). Use `end − 1 ms`.
6. **A phone with Play services but no step counter.** Whether it returns data isn't documented. Base availability on
   the sensor (`FEATURE_SENSOR_STEP_COUNTER`) **and** on the subscription producing data within a day. Never treat an
   empty read from such a phone as 0.

### C10 (M): The sampler undercounts silently on some phones, and calls the day complete

- **The counter may stop when nothing listens.** Google's step-counter guide says "the step counter sensor should only
  count steps while the sensor listener is registered" and recommends the Recording API instead [SENSOR].
  - `StepSensor.keepCounting` (`StepSensor.kt:87-110`) registers only for the life of the process.
  - After Android kills the process, a phone that follows that rule stops counting until the next alarm or boot
    receiver.
  - Those steps are missing with no estimate flag, and `coversDayEnd` still marks the day complete.
- **A reboot gap is recorded as covered with 0 steps.**
  - `deltaBetween` sets `gapFrom` (`counter.ts:201`), and `DayBook.add` (`counter.ts:237-240`) credits the stretch
    from the last reading to the boot as 0 steps.
  - With no `shutdown` sample (a cached process, Restricted bucket, force stop), the steps walked before the power-off
    are lost, and the day still counts as complete.
  - The notes put the loss window at up to about 2 h, longer in the Frequent / Rare buckets.

**Fix**
- The sampler is used only when neither HC nor the Recording API can count.
- Its days are never complete when the stretch before a reboot has no `shutdown` sample: the day stays pending, which
  is harmless with raise-only saves.
- The card says "approximate" for sampler days.
- Full parity on phones without Play services would need a foreground service (`FOREGROUND_SERVICE_HEALTH`). That is a
  product and store decision, not a code fix.

### C11 (M, phase 2 only): Writing to HC and then reading it back

If ÖRZA ever writes steps to HC (research §2.3, Android 9–13 opt-in):

- **Echo.** `stepsBetween` aggregates with no origin filter (`bridge.android.ts:244-247`), so it would read ÖRZA's own
  records back as `health_connect`, with `complete: true`. When the only source is ÖRZA's partial sampler data, that
  data then becomes the final value. The label "From Health Connect" would also be wrong.
- **Third-party apps that add up raw records.** HC removes duplicates only inside `aggregate` [HC-agg]. Apps that add up
  `readRecords` count ÖRZA's phone steps plus Google Fit's phone steps. The "only if no other origin" check must
  therefore run per interval and keep running, because Fit can be installed later. A day-level check isn't enough.
- **Day boundaries in other apps.**
  - Other apps place a record by its own zone offset. A null offset means "the current system offset at query time"
    [HC-time].
  - RNHC writes null offsets (research G9), so ÖRZA's records would move to other days in other apps after travel.
  - Offsets must come from the record's own instant (`ZoneId.systemDefault().rules.getOffset(start)`) [HC-write], not
    from the profile zone.
- **Policy.** "if your app has read data from Health Connect, that data shouldn't be written back" [HC-write]. Any
  number touched by `bestOf`, a base, an edit or an estimate is derived, and is never written.
- **iOS** is the same in kind but worse: "When you add a new data source, it appears above all apps and devices"
  [AP-prio]. An ÖRZA steps source would override the Watch. The research's "never write on iOS" is right.

**Fix:** R15 (W1–W6).

### C12 (L-M): A profile time-zone change re-reads past days in the new zone

**What happens**
- `pendingPastDays` re-reads up to 7 days in whatever zone is current.
- The headless background run takes the zone from the Keychain user snapshot (`sync.ts:333-336`), which can be stale.
- Example, IST → Europe/London on day D: D−1 is re-read as London's D−1, which ends at D 05:30 IST. Steps between 00:00
  and 05:30 IST were already saved in D, and now also raise D−1.
- A stale snapshot can flip the windows back and forth.

**Fix:** R8b.

### C13 (L-M): The glitch filter is loose for a rule that never lowers

**Code:** `counter.ts:44-46`. 50,000 steps an hour with a 15-minute minimum window accepts a 12,500-step jump in 15
minutes.

**Why it matters:** a counter jump from the sensor driver that passes the filter is saved and can never be undone.

**Fix:** R13. Allow at most 15,000 an hour, which is 3,750 per 15 minutes: a sustained 250 steps a minute is beyond
running cadence. Apply the cap to phone sources only. Never filter a health store's number, because it would then
differ from the health app.

### C14 (L): Shared phone, different member

HC, HealthKit, CMPedometer and the Recording API belong to the phone (or its user profile), not to the ÖRZA account. When
a second member signs in, ÖRZA reads up to 7 past days (`plan.ts:24-31`) and saves the phone owner's steps into the new
account.

**Fix:** R14.

### C15 (L, verify): HealthKit samples across midnight

kingstinct's predicate uses no strict options when the date filter doesn't set them
(`node_modules/@react-native-healthkit/core/ios/Predicates.swift:36-43`). `stepsBetween` (`bridge.ios.ts:155-182`) queries
each day separately. Whether a sample that crosses midnight is split by time or counted on both sides isn't documented.

**Check on a device:** read ÖRZA's two day totals for a walk that crosses midnight and compare them with the Health app.
If they differ, query with `strictStartDate` or use one statistics-collection query across the days.

### C16 (L, note): Two devices counting different parts of the day

When the member carries phone A in the morning and phone B in the afternoon, each phone saves its own count and the
server keeps the larger, so the day is too low. HC and HealthKit do the same within one phone. Document it and don't fix
it: adding the two would double count the common case, where both phones are carried.

### What is already correct (checked, keep it)

- **DST and zones with a missing midnight:**
  - `dayStartMs` searches for the first minute that belongs to the date (`counter.ts:73-92`).
  - `dayRanges` builds the ranges from instants.
  - HC `aggregateRecord` and HealthKit `queryStatisticsForQuantity` take instant ranges, so they are DST-safe.
  - Trap for v2: never build a day as start + 24 h, for example by copying Google's sample (C9.1).
- **Midnight split in the sampler:** proportional, plus exact midnight samples when "Alarms & reminders" is allowed.
  15-minute buckets in the Recording API make it exact.
- **The reboot counter:** the boot clock, re-anchoring and the 2025 clock floor are well tested (66 tests).
- **"0 from a health store = no data"** (`reader.android.ts:113`, `reader.ios.ts:87`), which is needed because HealthKit
  hides a denied read [research S17].

---

## 2. Proposed rules (the contract for v2)

**R1: The reference number.** "Like other health apps" means the platform store's de-duplicated daily total for the
member's day:
- Apple Health: HKStatistics `cumulativeSum` over the day;
- Health Connect: `aggregate` over the day, minus ÖRZA's own origin (W1).

When ÖRZA can read that number for a day and it is above 0, **it is the day's automatic count. No max with the phone
counter**, except for today's live tail (R3).

**R2: Source order per platform.**

| Phone | 1st | 2nd (when the 1st can't read the day) | 3rd | Never |
|---|---|---|---|---|
| Android 14+, SDK ext ≥ 20 | HC aggregate (includes on-device phone steps once READ_STEPS is granted [HC-steps]) | Recording API | sampler | writing steps |
| Android 9–13 with Play services ≥ 241500000 | HC aggregate, when another app writes steps there | Recording API | sampler | writing, unless W1–W6 hold |
| Android without Play services (Huawei, Fire) | HC, if installed | sampler, labelled approximate | manual entry | — |
| Android without a step counter | HC (watch, other apps) | manual entry | — | treating an empty read as 0 |
| iPhone with Health read | HealthKit statistics | — | — | writing steps |
| iPhone, Health denied or empty for 7 days | CMPedometer (iPhone only, 7 days [CMP]) | manual entry | — | — |

The phone sources (Recording API, sampler, CMPedometer) all read the same sensor, so they never add up: take the max of
**those**. The sampler runs alongside the Recording API only during its first day (C8), and stops after that.

**R3: Today's live tail.** Health stores lag: watches sync in batches, and HealthKit's iPhone samples arrive in
batches. For **today only**:
- shown and saved = max(store, phone source);
- while today runs, saves stay raise-only (R10).

The website then follows the phone within the usual 10 minutes / 50 steps.

**R4: Reconcile a past day once.**
- When a past day settles (R5), set the day to the store's number (R1), even if it is lower.
- Do this only when the server still holds **exactly the value this phone last saved automatically**: no edit, and no
  higher save from somewhere else.
- It needs the conditional write in R10 (`expect`).
- This is the one exception to "never lower". It corrects ÖRZA's own provisional overshoot from R3, and matches the
  health app the next morning.

**R5: Settle window and lookback, per source.**
- A day from a health store stays pending until 72 h after it ends. Read it again on launch and on a new day, else at
  most every 30 minutes.
- Only then is it final (and reconciled, R4).
- A day from a phone counter is final when a reading after its midnight exists:
  - sampler: `coversDayEnd`, and no unknown reboot gap (C10);
  - Recording API: a read at least 60 minutes after that midnight.
- How far back to read when the app returns after a long time:

  | Source | Lookback |
  |---|---|
  | HealthKit | 30 days |
  | HC | 30 days (limited to 30 days before the first grant [HC-agg]) |
  | Recording API | 9 days (it keeps 10) |
  | Sampler | 9 days |
  | CMPedometer | 7 days |

- A CMPedometer 0 is never final while HealthKit is readable.

**R6: Bases are anchored in time.**
- A base stores `{steps, at}` only.
- The day = `base.steps + max over sources of sum_s([base.at, now])`. Every source can answer a range: HC and HealthKit
  with range queries, CMPedometer with a range, the Recording API with buckets, the sampler with
  `dailyStepCounts`-style interval maths.
- `rebased()` is deleted: a change of source no longer matters.
- Watch data stamped before `base.at` never counts on top of the base (C4b).
- START = `max(whole-day automatic count, saved + max_s sum_s([partialFrom, now]))`.

**R7: Estimates.**
- `bestOf` compares counts **without** their estimated part. An estimate wins only when no other source has the day.
- An estimated day is never final while any health store is readable. It waits for the settle window (R5).
- Today never saves an estimate, base or no base (fixes the `withBase` path).

**R8: One day definition.**
- (a) Every step day is computed in the **profile** zone, the same zone the server uses for "today".
- (b) The phone's Health import sends `steps` from the steps pipeline's numbers (`stepsBetween(dayRanges(dates,
  profileTz))`), or leaves steps out, never the phone-zone collection.
- (c) The server rejects a steps value for a date after the profile's today in `normaliseDays`.
- (d) When the phone's zone differs from the profile's for more than about 6 h, Today offers "Update your time zone?". This
  keeps ÖRZA's day equal to the health app's day in practice (the health apps use the phone's zone).
- **R8b.** Each day record stores the zone it was computed in. A past day saved under another zone is frozen. Only today
  is recomputed after a zone change. The background run refreshes the user snapshot before trusting its zone.

**R9: The member's edit is sticky.**
- A manual save marks the day on the server (`steps_edited_at`, and the base's `at`).
- The import mirror never raises a day that carries a newer edit.
- The phone keeps counting on top of an edit with R6.
- A web edit is the same marker, so the phone sees it as an edit by the marker, not by "the value went down".

**R10: Server write modes for `POST /api/track/steps`.**

| Mode | Server behaviour | Used for |
|---|---|---|
| `auto` | atomic `$max` | every automatic save; can never lower anything (fixes C5) |
| `manual` | `$set` plus the edit marker (R9) | the Edit / Log sheet, the website |
| `reconcile` | `$set` only if current == `expect` | R4 |

- The app isn't in the stores yet, so changing the default costs no compatibility.
- `editedOnServer` then reads the marker instead of guessing from a lower value.

**R11: Coverage proof.**
- Every source reports `partialFrom`:
  - HC: the first READ_STEPS grant time, on days where the origins are only `android` or the device's synthetic package
    name;
  - Recording API: the subscription time;
  - sampler: as now.
- The START base applies to any source with `partialFrom` (C8).
- A 0 or empty result counts as a reading only for time the source provably covered. Otherwise it is null.

**R12: Recording API.**
- 15-minute buckets aligned to UTC quarter hours, added up per profile day.
- Read range `[start, end − 1 ms]`.
- Subscribe on every launch and every background run, which is idempotent (research [S2]).
- Unsubscribe on sign-out (C9.3). Store `subscribedAt` per account.
- Read from the hourly background task (Google suggests periodic collection because of the 10-day window [REC]).
- A read counts as data only inside `[max(subscribedAt, now − 10 days), now]`. Outside that window it is null, never
  0 (C9.2).

**R13: Plausibility.**
- Phone sources: at most 15,000 steps an hour, with a 15-minute minimum window.
- Health stores: never filtered.
- Server: 100,000 a day (unchanged).

**R14: Account scoping.**
- The phone's step history from before a member's first sign-in on this device is read only after one confirmation:
  "Import the last 7 days from this phone?".
- At sign-out the sampler clears its samples (as now) and the Recording API unsubscribes.

**R15: If an HC writer ever ships (Android 9–13 only).**
- **W1.** Every HC read for counting excludes ÖRZA's origin:
  1. aggregate with no filter;
  2. if `dataOrigins` contains `in.co.ylo.orza`, aggregate again with `dataOriginFilter` = `dataOrigins` minus ÖRZA;
  3. if ÖRZA is the only origin, the result is "no store data".

  Check on a device that a filtered aggregate still removes duplicates by priority among the origins it includes.
- **W2.** Write only raw, counted phone intervals: Recording API buckets or sampler deltas. Never the `bestOf` winner,
  a base, an edit, an estimate or a HealthKit / HC value.
- **W3.** Never on Android 14+ with SDK ext ≥ 20 (HC already holds the phone's steps). Never on iOS.
- **W4.** One record per interval:
  - `clientRecordId = "orza-steps:<startMs>"`;
  - `clientRecordVersion` = write time (upserts happen only with a higher version [HC-write]);
  - zone offsets from the interval's own instant;
  - `autoRecorded(Device(TYPE_PHONE, manufacturer, model))`;
  - no zero records [HC-write].
- **W5.** Check per interval, every run: if another steps origin covers an interval ÖRZA wrote, delete ÖRZA's record
  for it.
- **W6.** Turning the toggle off stops writing. Records already written are left in place, because they are the phone
  owner's real steps. Say so in the toggle's text.

**R16: One displayed number.** Today shows what R1–R3 save. The Health screen's steps column reads `tracking.steps`, not
the per-source `health_days` maximum, so the app and the website never show two step counts for one date.

---

## 3. Corrections and additions to `research.md`

| Research says | Correction | Rule |
|---|---|---|
| §0.3 "Reading and de-duplication are already correct in principle … A max never adds the two together, so it never double counts" | True for summing only. Max ≠ the health app's priority result (C3), and two existing paths double count or undo: the import mirror (C1, C2) and value-anchored bases (C4b) | R1–R4, R6, R8, R9 |
| §1.2 "Don't switch sources inside a day … the day-base maths re-anchors on a source change" | Re-anchoring is the bug (C4a). With time anchoring, switching sources is safe | R6 |
| §1.2 "Pass `partialFrom` for the first subscribed day" | Needed for **every** new source, including the HC first grant, and after any re-subscribe; also unsubscribe at sign-out | R11, R12 |
| §1.1 retention | Days outside the subscription window are "no data", never 0; lookback 9 days | R5, R12 |
| §2.3 "check the day's … `aggregate.dataOrigins`" before writing | Must be per interval and continuous, and reads must exclude ÖRZA's own origin, or the echo becomes the final value | W1, W5 |
| §5 G11 "Consider the START base for a HC first day too" | Required: without it a typed morning is absorbed (C8) | R11 |
| §5 suggested matrix: "Day value = higher of the two" | Store authoritative; max only as today's live tail; reconcile once | R1–R4 |
| Not covered | Health sync = a second writer in a different zone; import accepts tomorrow; GET→POST race; Google's day-bucket sample; the sampler counts only while registered | R8, R10, C9.1, C10 |

The research is right, and should stay, on these points:
- never write steps on iOS or on Android 14+;
- read HC with `aggregate` and HealthKit with statistics;
- use 15-minute buckets for the Recording API;
- background read permissions;
- removing `NSHealthUpdateUsageDescription`.

---

## 4. Tests to add

**Pure (`npm run test:steps`)**
- An edit, then an import that raises the day: the server keeps the edit (needs the web mirror rule; add a web unit test
  for `mirrorIntoTracking` with `steps_edited_at`).
- Flapping: phone and HC alternate as the best source for 10 reads after an edit, and the day grows by the real
  increments (C4a).
- A late watch backfill dated before the edit isn't added (C4b).
- A START base for HC's first grant and for the Recording API's first subscription (C8).
- An estimated sampler day loses to a real HC reading and isn't final within 72 h (C7).
- `bestOf` under R1: the store wins over a higher phone count on past days; today uses max.
- Reconcile: lowers only when server == this phone's last automatic save; a server edit marker or a higher foreign value
  blocks it.
- Zone change: a past day saved under IST isn't re-saved under Europe/London; today is.
- The import's steps use profile-zone ranges; the server refuses tomorrow.
- Recording API buckets around 00:00 for +05:30, +05:45 and a DST day (23 h / 25 h); an empty read outside
  `[max(subscribedAt, now − 10 days), now]` is null.
- Echo: HC origins = {ÖRZA} → no store data; {ÖRZA, android} → filtered to `android`.
- Plausibility: 4,000 steps in 15 minutes is rejected, 3,700 accepted.

**On a device (add to the real-phone checklist)**
- Samsung + Galaxy Watch, and Pixel + Fitbit or Wear OS: compare ÖRZA's past-day numbers with the HC app and the
  vendor app for 3 days. Expect them equal after reconciliation.
- iPhone + Apple Watch: stroller or cart walk, then compare with the Health app the next morning.
- Android 14 first READ_STEPS grant at midday with a typed morning count (C8).
- Recording API: steps-to-`readData` latency; reboot; app update; revoke and re-grant Physical activity; sign-out then
  sign-in as another account (the previous data must be unreadable).
- A phone that stops counting when nothing is registered (C10): leave the app killed for 3 h, walk 1,000 steps, compare
  sampler and Recording API.
- A walk across midnight on the iPhone: ÖRZA's two days vs the Health app (C15).
- Travel simulation: change the phone's zone to Asia/Singapore with the profile on Asia/Kolkata, and check that no row
  for tomorrow appears and no evening walk appears in two days (C2).

---

## 5. Backend changes this needs (web, `E:\aylo\orza`; push only with the user's OK)

1. `POST /api/track/steps` gets `mode: 'auto' | 'manual' | 'reconcile'` and `expect`. `auto` uses an atomic `$max`;
   `manual` sets the value and `steps_edited_at`; `reconcile` is a conditional `$set` (R10).
2. `mirrorIntoTracking` skips raising a day with `steps_edited_at` (R9). `GET /dashboard/today` returns
   `steps_edited_at` so the phone can see an edit.
3. `normaliseDays`: no `steps` for a date after the profile's today (R8c).
4. Optional: return per-source automatic counts for the day, so the card can say "From Samsung Health" and support can
   explain a number.

---

## Sources

Checked today, 2026-10-27, unless marked.

- [HC-agg] Health Connect, Read aggregated data: "keeps only the data from the app with the highest priority"; "Only the
  Activity and Sleep data types are deduped"; only end users change priority; 30 days before the first grant:
  https://developer.android.com/health-and-fitness/health-connect/aggregate-data
- [HC-steps] Health Connect, Track steps: Android 14 + SDK ext 20; "active only when at least one application … has been
  granted the READ_STEPS permission"; writes "no more frequently than once per minute"; `android` origin before June
  2026, synthetic package name after; Recording API advice for Android 13 and lower:
  https://developer.android.com/health-and-fitness/health-connect/features/steps
- [HC-write] Health Connect, Write data: "if your app has read data from Health Connect, that data shouldn't be written
  back"; zone offsets from `ZoneId.systemDefault()`; `clientRecordId` upserts and version rule; no zero records when not
  worn; at most 15 minutes between writes: https://developer.android.com/health-and-fitness/health-connect/write-data
- [HC-time] TimeRangeFilter reference: LocalDateTime ranges [start, end); "Record without specifying zoneOffset will
  assume the current system zone offset at query time". Read from the search-result extract of this page, because the
  full reference page didn't load:
  https://developer.android.com/reference/kotlin/androidx/health/connect/client/time/TimeRangeFilter
- [REC] Recording API on mobile: "stores up to 10 days of data"; "data since the latest subscription - for up to 10
  days - is accessible"; "If a subscription is removed by calling unsubscribe, collected data won't be accessible";
  ACTIVITY_RECOGNITION; sample uses `bucketByTime(1, TimeUnit.DAYS)` from now − 1 week; WorkManager advice:
  https://developer.android.com/health-and-fitness/guides/recording-api
- [SENSOR] Read step count data with SensorManager: "the step counter sensor should only count steps while the sensor
  listener is registered"; recommends the Recording API:
  https://developer.android.com/health-and-fitness/guides/basic-fitness-app/read-step-count-data ; Sensor reference
  (counter since reboot; not re-read today, the page was too large):
  https://developer.android.com/reference/android/hardware/Sensor#TYPE_STEP_COUNTER
- [AP-prio] Apple Support, Manage Health data: default order (manual, then iPhone / iPad / Apple Watch, then apps); "When
  you add a new data source, it appears above all apps and devices"; the top source wins:
  https://support.apple.com/en-us/108779
- [CMP] Apple, CMPedometer (7 days of history), from research [S14], not re-read:
  https://developer.apple.com/documentation/coremotion/cmpedometer
- Apple HKStatistics merges sources before calculating, from research [S15], not re-read:
  https://developer.apple.com/documentation/healthkit/hkstatistics
- App Store Review Guidelines 5.1.3(ii), no inaccurate data into HealthKit, from research [S19]:
  https://developer.apple.com/app-store/review/guidelines/
- Code read locally:
  - `E:\aylo\orza-mobile\src\lib\steps\*`, `src\lib\health\*`, `modules\orza-steps\android\...\*.kt`,
    `docs\notes\steps-fix-and-device-test.md`;
  - `node_modules/@react-native-healthkit/core/ios/Predicates.swift`;
  - `E:\aylo\orza\src\lib\care\health.ts`, `src\components\care\health\aggregate.ts`,
    `src\app\api\track\steps\route.ts`, `src\app\api\track\_shared.ts`, `src\lib\domain\tracking.ts`.
