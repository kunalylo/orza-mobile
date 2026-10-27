# Auto steps v2: store-review and privacy critique

Date: 2026-10-27. Role: independent critic (App Store / Google Play review and privacy). Inputs: `steps-v2/research.md`,
`docs/PROGRESS.md`, the steps code (`src/lib/steps/*`, `src/lib/health/*`, `src/features/today/StepsCard.tsx`,
`modules/orza-steps`), `app.json`, the merged release manifest from the D1 build copy, and the web repo where the data
ends up (`E:\aylo\orza`: privacy page, AI coach). Nothing in `E:\aylo\orza-mobile` was changed.

Paths without a prefix are relative to `E:\aylo\orza-mobile`. `web:` means `E:\aylo\orza`. `merged:` means
`E:\aylo\orza-mobile-build\android\app\build\intermediates\merged_manifests\release\processReleaseManifest\AndroidManifest.xml`.
Sources are tagged [A#] (Apple) and [G#] (Google). The quotes come from the official pages, fetched on 2026-10-27.

---

## 0. Verdict

Most of research.md's direction is sound from a policy point of view, and some of it is required: never write steps to
Apple Health, don't write on Android 14+, request steps-only access in context, and declare
`READ_HEALTH_DATA_IN_BACKGROUND`. But v2 would fail review or create privacy exposure in several places that the
research doesn't cover:

1. **Health Connect's "privacy policy" link opens ÖRZA's home screen, not a privacy policy** (P1). Google requires an
   activity that displays the policy [G1].
2. **The privacy policy doesn't cover the phone app.** It says it applies to "the ÖRZA website and web app" and only
   mentions Apple Health *exports* and CSV (P2). Both stores and Health Connect review check this [A1][G3][G6].
3. **Step counts reach OpenAI without explicit consent.** The AI coach puts today's steps into its prompt. Under v2 that
   number usually comes from Apple Health or Motion & Fitness, and Apple now requires explicit permission before
   sharing with "third-party AI" [A1 5.1.2(i)][A3] (P3, P4).
4. **The app asks for more health data than it uses** (8 types; 4 of them are shown nowhere) (P5).
5. **The pre-permission sheet uses the patterns Apple's HIG names as manipulative**: an "Allow …" button, a second
   exit action, and a closable sheet (P6).
6. **"Fully usable when denied" is not true today.** Manual entry appears only *after* a refusal (P7).
7. **Consent is per phone, not per member.** A second account on the same phone gets the previous person's last
   7–10 days uploaded with no in-app consent. Research gap G1 ("read HC whenever READ_STEPS is granted") would widen
   this (P8).
8. **There is no in-app "off" switch.** Disconnecting doesn't revoke anything (P9).
9. **Two research recommendations need care:** removing `NSHealthUpdateUsageDescription` can break the App Store upload
   (P10), and the phase-2 `WRITE_STEPS` costs more in policy work than it gives (P13).

None of these block the engineering plan. They change the consent model, the copy, the manifest and the legal pages.

---

## 1. Findings at a glance

| ID | Sev | Platform | Finding | Fix (short) |
|---|---|---|---|---|
| P1 | **High** | Android | HC rationale intent / `VIEW_PERMISSION_USAGE` alias open MainActivity → app home / Welcome, never the privacy policy | Dedicated native activity that shows the public privacy policy; retarget filter + alias via config plugin |
| P2 | **High** | Both | Privacy policy is scoped to the website; no HealthKit / HC / motion sensor / background collection / Recording API / AI use of steps | Add a "Phone app: health & activity data" section before any submission (also what P1 opens) |
| P3 | **High** (iOS) / Med (Android) | Both | Today's steps (Apple Health / Motion-derived under v2) are sent to OpenAI in the coach prompt with no explicit consent; app claims "we never share personal health information without your consent" | Explicit AI-sharing consent before first AI use (names provider + data), or strip health-store/motion-derived values from prompts |
| P4 | Med | Both | "Help improve ÖRZA's AI" is opt-out (default ON) over "conversations and logs" | State that Apple Health / HC / motion data is never used for AI improvement; or make it opt-in on iOS |
| P5 | **High** (HC approval) / Med (iOS) | Both | 8 HC / HealthKit read types requested at once; Active energy, Distance, Heart rate, Water are uploaded but displayed nowhere | Drop the 4 unused types (or ship visible features first); steps-only request in context for v2 |
| P6 | Med-High (iOS) | Both | Pre-permission sheet: button "Allow step counting", extra "Wear a watch? Use Apple Health" exit, sheet closable | One button "Continue" → system prompt; move the watch option outside the sheet |
| P7 | Med | Both | Typing steps is only possible after a refusal (`undetermined` → no Log button); v2 iOS would hide it entirely when Health is denied | Always offer "Log steps" when nothing counts today |
| P8 | Med | Both | Phone-level permission covers every ÖRZA account on the phone: past 7 days (CMPedometer) / 10 days (Recording API) / HC history land in a new member's account without that member's consent | Per-account consent record; backfill only from consent time; `unsubscribe` Recording API on sign-out; keep a per-account HC/HK gate |
| P9 | Med | Both | No in-app "stop counting"; HC "Disconnect" only flips a local flag; nothing revokes or unsubscribes | "Count steps automatically" switch: off → stop all sources, `unsubscribe`, `clearBackgroundTypes`, HC `revokeAllPermissions()` on disconnect |
| P10 | Med | iOS | Research says drop `NSHealthUpdateUsageDescription`; App Store Connect has rejected binaries (ITMS-90683) whose code *references* HealthKit write APIs without it | Try `false` on a TestFlight upload first; keep an honest string if ITMS-90683 appears |
| P11 | Med-Low | iOS | Purpose strings don't say the totals are saved to the account (and HealthKit string lists types to be dropped) | Rewrite (texts in §5.3) |
| P12 | Med | Android | v2 needs a re-filed Health apps declaration with per-type justifications, incl. `READ_HEALTH_DATA_IN_BACKGROUND`; access is allow-listed per package | Wording in §5.2; file before the release that needs it |
| P13 | Med | Android | Phase-2 `WRITE_STEPS`: Data safety "shared", justification, feature invisible on Android 14+ test devices, read-back rule | Don't ship it. If the client insists on "both ways", write ÖRZA's own first-party data (meals, water, weight) instead |
| P14 | Low-Med | Android | Midnight step samples use exact alarms (via the medicine-alarm grant), which isn't a user-facing timing need | Inexact chain only (Recording API removes the sampler anyway) |
| P15 | Low | Android | Don't solve background counting with a `health` foreground service (needs `FOREGROUND_SERVICE_HEALTH`, Play FGS declaration and a video) | Recording API, as planned |
| P16 | Low | Both | Step / health day records in `Paths.document` → iCloud Backup / Android Auto Backup; kept for every user after sign-out | Non-backed-up location; delete the member's records on sign-out |
| P17 | Low | iOS | HealthKit pods use `UserDefaults` and ship no `PrivacyInfo.xcprivacy`; app.json has no `ios.privacyManifests` | Verify the generated app manifest declares UserDefaults (CA92.1) before upload |
| P18 | Low | iOS | App Store description must say it integrates with Apple Health (2.5.1) | D3 listing text |
| P19 | Low | Both | After a refusal Today keeps a full-width "Count my steps automatically" / "Open Settings" CTA forever | "Not now" that collapses it (remembered) |
| P20 | Low | Android 14+ | Data minimisation: Physical activity *and* HC READ_STEPS for the same phone's walking | Ask for one by default; the other only if the first is refused / unavailable; mention HC on-device capture |

---

## 2. Findings in detail

### P1 (High, Android): Health Connect's privacy-policy link doesn't show a privacy policy

**Evidence**
- The RNHC config plugin adds `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` to **MainActivity**. It also adds the
  `ViewPermissionUsageActivity` alias (`VIEW_PERMISSION_USAGE` + `HEALTH_PERMISSIONS`) with `targetActivity` =
  MainActivity (`node_modules/react-native-health-connect/app.plugin.js`; merged:212-227).
- Nothing in `src/` handles either intent (no match for `RATIONALE` / `VIEW_PERMISSION_USAGE`). A tap on "Privacy
  policy" in Health Connect › ÖRZA therefore opens ÖRZA's normal start route: Today, or Welcome when signed out.

**Rule.** "Your Android manifest needs to have an Activity that displays your app's privacy policy, which is your app's
rationale of the requested permissions, describing how the user's data is used and handled." Also: "The activity must
display the same privacy policy you provide for your app in the Google Play Console" [G1]. Play: "This must be the same
privacy policy that is displayed to users when they click the privacy policy link in Health Connect" [G2].

**Fix**
- Add a tiny native activity (it fits in `modules/orza-steps`, which already owns Android steps code), e.g.
  `HealthPrivacyActivity`. It opens the **public** policy URL (Custom Tab, or a WebView for
  `https://orza-nine.vercel.app/privacy#phone-health`) and finishes. It must work while signed out.
- Use a config plugin to move RNHC's rationale intent-filter off MainActivity and point the `ViewPermissionUsageActivity`
  alias at the new activity. The project's rule is config plugins only, never hand-edit `android/`.
- Test on Android 14+ (HC › App permissions › ÖRZA › privacy link) and on the Health Connect APK (Android 9–13).

### P2 (High, both): the privacy policy doesn't describe the phone app

**Evidence**
- `web:src/app/(site)/privacy/page.tsx:32`: the policy applies to "the ÖRZA website and web app (together, the
  'Service')".
- Health data (`:74-77`) is listed only as "an Apple Health export or CSV file you import, or sent by an app you set up
  with your personal sync link". Nothing covers:
  - HealthKit or Health Connect reads by the phone app (8 types, 30 days, every 3 h);
  - the phone's motion sensor (Android "Physical activity" + sampler / Recording API; iOS Motion & Fitness);
  - collection while the app is closed (hourly background task, HealthKit background delivery, HC background read);
  - that daily step totals go to the account and the website;
  - that steps are used in the AI coach (P3);
  - (phase 2) writes to Health Connect.

**Rules**
- Apple 5.1.1(i): the policy must "Identify what data, if any, the app/service collects, how it collects that data,
  and all uses of that data". Apple 5.1.3(i): "You must disclose the specific health data that you are collecting from
  the device" [A1].
- Play: the policy must "comprehensively disclose how your app accesses, collects, uses, and shares user data" [G6].
- HC policy: the policy must cover what is collected, how it is used, stored and shared, "Your data retention and
  deletion policies" and "Your security practices" [G3].

**Fix.** Add a section, with a stable anchor for P1, that covers:
- per platform, the data types read and from where (Apple Health, Health Connect, phone motion sensor / Google Play
  services);
- when the reads happen (in the app, and hourly in the background when allowed);
- what leaves the phone (daily totals only; no raw samples or locations);
- where it shows up (Today, Health, reports, website, AI coach);
- the Health Connect / Apple Health rules: no ads, no sale, no transfer except as stated;
- retention and deletion (account deletion removes `health_days` / tracking);
- how to stop it: the in-app switch (P9), system settings, Health Connect › App permissions, iOS Settings › Health.

### P3 (High on iOS, Medium on Android): steps go to a third-party AI without explicit consent

**Evidence**
- `web:src/lib/coach.ts:1308-1317`: `contextForPrompt` includes `steps ${ctx.tracking.steps}/${t.steps}` in the system
  prompt. `web:src/lib/ai.ts:48` posts it to `https://api.openai.com/v1/chat/completions`.
- `tracking.steps` is what the steps sync saves. Under v2 the winning source for most iPhone users is Apple Health
  (`shared.ts:33-50` `bestOf`; research §3.3 makes HealthKit primary). Otherwise it is CMPedometer (Motion & Fitness).
- The mobile app has no AI-sharing consent (grep: none).
- The app says "We never share personal health information without your consent." (`src/app/(app)/settings.tsx:206`,
  `account/data.tsx:152`, `account/memory.tsx:251`).

**Rules**
- 5.1.2(i): "You must clearly disclose where personal data will be shared with third parties, including with
  third-party AI, and obtain explicit permission before doing so" [A1].
- 5.1.3(i): health data from "HealthKit API, Motion and Fitness" may not be disclosed to third parties except for
  improving health management "and then only with permission" [A1].
- HealthKit: "You must not disclose any information gained through HealthKit to a third party without express permission
  from the user. Even with permission, you can only share information to a third party if they also provide a health or
  fitness service to the user" [A3].
- HC policy prohibits "Sharing health data with third parties without explicit, informed user consent" [G3].
- Play's Data safety exempts service providers [G5], but HC policy is stricter.

**Fix (pick one before the iOS submission; v2 makes it routine rather than rare)**
- (a) A one-time explicit consent before the first AI feature (chat, scan, rebalance, insights). It names the provider
  and lists the data ("your meals, targets, water and today's steps"). Store it on the server, and offer a way to
  withdraw it.
- (b) The server leaves step counts (and any synced health value) out of AI prompts for members who haven't consented.
  To do this per source, `tracking.steps` needs a source flag (`apple_health` / `health_connect` / `phone` / `manual`).
  Today it has none.
- Either way, fix the "never share … without your consent" sentence so it is true.

### P4 (Medium, both): AI-improvement opt-out covers health-derived logs

**Evidence**
- `src/app/(app)/account/preferences.tsx:177-185`: "Help improve ÖRZA's AI … Lets your conversations and logs,
  anonymized first, help make ÖRZA's AI better". It is ON by default (`ai_training_opt_out: false`,
  `web:src/components/account/options.ts:117`).
- The privacy policy repeats this (`web:…/privacy/page.tsx:158-163`).
- No training pipeline reads the flag today (web grep: it is only stored), so this is a declared practice, not an
  active one.

**Rule.** 5.1.3(i) allows uses other than health management only "with permission". An opt-out default isn't
permission [A1]. HealthKit data can't go to third parties without express permission [A3].

**Fix.** Write in the policy and in the toggle copy that data read from Apple Health, Health Connect or the phone's motion
sensors is never used to improve AI, whatever the setting. Alternatively, make the toggle opt-in on iOS. Keep it that
way in any future pipeline.

### P5 (High for HC approval, Medium on iOS): more health data requested than any feature uses

**Evidence**
- Android requests 8 read types in one sheet (`src/lib/health/bridge.android.ts:41,167`; app.json:49-56; merged:28-35).
  iOS asks for the same 8 (`bridge.ios.ts:34-43`).
- The Health screen charts only steps, sleep, resting heart rate and weight (`src/app/(app)/health.tsx:55-58`). The web
  Health page does the same (`web:src/components/care/health/HealthView.tsx`).
- `active_kcal`, `distance_km`, `avg_hr` (from **HeartRate**) and `water_ml` are read, uploaded and stored. They are
  displayed nowhere (web grep: only importers, the merge and the export use them).

**Rules**
- HC: "If your app does not require access to specific data types, then you must not request access to these data
  types". Also "For each permission requested, provide a clear and detailed justification explaining how your app uses
  the data to benefit the user" [G2][G3].
- Apple 5.1.1(iii): "only request access to data relevant to the core functionality … and should only collect and use
  data that is required" [A1].
- HIG: "Request access only to data that you actually need … make your permission requests as specific as possible"
  [A2].

**Fix**
- Remove `READ_ACTIVE_CALORIES_BURNED`, `READ_DISTANCE`, `READ_HEART_RATE` and `READ_HYDRATION`, and the HK
  `ActiveEnergyBurned`, `DistanceWalkingRunning`, `HeartRate` and `DietaryWater`. Do this from app.json, `RECORDS` /
  `READ_TYPES`, the connect card's metric list and the purpose string. Re-file the declaration ("Exclude all of the
  health features that the app no longer needs" [G2]).
- The alternative is to ship visible features first, e.g. active energy on Today's energy card, or synced water filling
  the water tracker.
- For v2 steps: the Today path requests **Steps only** (HC `READ_STEPS` + background; HK `StepCount`). Research §2/§3
  already proposes this; it is required, not optional.

### P6 (Medium-High on iOS): the pre-permission sheet uses patterns the HIG calls manipulative

**Evidence.** `src/features/today/StepsCard.tsx`:
- `:323`: the footer button is "Allow step counting";
- `:346`: a second action, "Wear a watch? Use Apple Health / Health Connect", leaves the sheet without showing the
  system alert;
- `:309`: the sheet can be dismissed (X, backdrop, swipe).

Research §4.1 counts this sheet as the compliant explanation.

**Rule** [A2], "Pre-alert screens":
- "Include only one button and make it clear that it opens the system alert … Another type of manipulation is using a
  term like 'Allow' to title the custom screen's button … Use a term like 'Continue' or 'Next'."
- "Don't provide a way for people to leave the screen or window without viewing the system alert — like offering an
  option to close or cancel."

This is enforced through 5.1.1(iv) ("not attempt to manipulate, trick, or force people to consent") [A1]. Play's
prominent-disclosure rule is compatible: the disclosure must "immediately precede" the runtime request and needs an
affirmative action [G6].

**Fix**
- One button, "Continue", which opens the system prompt (or the HealthKit sheet in v2).
- Move "Wear a watch? Use …" onto the card itself, outside the sheet.
- Make the sheet non-dismissible once it is open, except in the `blocked` state, where "Open Settings" is the only
  path.
- The same pattern exists elsewhere and should be checked in D3: `src/features/alarms/AlarmPermissionPrompt.tsx:97`
  ("Not now") and `src/features/snap/Panels.tsx:231` ("Allow access").

### P7 (Medium, both): typing steps is offered only after a refusal

**Evidence**
- `StepsCard.tsx:97`: `manual = … !counting && (!phoneAvailable || permission === 'denied' || permission === 'blocked')`.
- In the `undetermined` state the only CTA is "Count my steps automatically". No other screen opens the steps sheet
  (grep: `onLog` comes only from `StepsCard`).
- With research §3.3 on iOS, Apple Health becomes the primary source and Motion is asked only as a fallback. A member
  who switches Steps off in the HealthKit sheet (which the app can't see [A4]) and hasn't been asked for Motion gets
  "Not counted yet" with **no** Log button.

**Rules**
- 5.1.1(iv): "Where possible, provide alternative solutions for users who don't grant consent" [A1].
- 5.1.2(i): an app "may not require users to enable system functionalities … in order to access functionality" [A1].
- HC: "your app should still run, and it should perform as many tasks as it can with the permissions that the user
  granted" [G8].

**Fix**
- Show "Log steps" whenever no automatic source counts today, whatever the permission state.
- In v2 on iOS: treat "Health returned no steps today and none in the last 7 days" as no source. Offer "Log steps"
  plus, once and as a choice, "Use iPhone motion instead". Never auto-chain a second prompt after a HealthKit sheet.

### P8 (Medium, both): consent belongs to the phone, data goes to whichever account signs in

**Evidence**
- The OS permissions (Motion & Fitness, Physical activity, HealthKit, HC) are per app install, not per ÖRZA account.
  After sign-out → sign-in as member B:
  - `refreshSteps` sees `phonePermission === 'granted'` and starts at once (`sync.ts:174-182`);
  - `pendingPastDays` reads **7 past days** for B (`plan.ts:11,25-32`);
  - on iOS, CMPedometer returns the phone's last 7 days (`reader.ios.ts:78-81`), which are then saved to B's account.
- Android today clears the sampler on sign-out (`reader.android.ts:98-101`), so only "from now" leaks. But the
  Recording API keeps 10 days **per app** (research §1.1).
- Research G1 ("Read HC steps whenever `READ_STEPS` is granted, not only when 'connected'") would remove the only
  per-account gate (`sync.ts:162`). B's account would then ingest the phone owner's Health Connect steps, including a
  watch.
- ÖRZA sells household modes (Couple / Caregiver / Family), so shared phones are a realistic case.

**Rules**
- Play prominent disclosure: "Data collection cannot start until the user grants consent" [G6].
- Apple 5.1.1(ii): apps "must secure user consent for the collection" [A1].

**Fix**
- Keep a per-member consent record (`stepsConsentAt` per user id, on the phone and mirrored on the server). Nothing
  reads or saves until *this member* has gone through the Today disclosure, even when the OS permission is already
  granted. In that case the sheet's single button just records consent.
- Backfill only from `stepsConsentAt`: the first day becomes partial (the existing `partialFrom` / START-base logic).
  Never save days before consent.
- Recording API: `unsubscribe(TYPE_STEP_COUNT_DELTA)` on sign-out and account deletion ("collected data won't be
  accessible" [G9]). Subscribe again on the next member's consent.
- Keep a per-account flag for health-store steps (a steps-only "connected" record is fine). Don't infer it from the OS
  grant.

### P9 (Medium, both): no in-app way to stop automatic steps; Disconnect revokes nothing

**Evidence**
- `src/lib/health/sync.ts:243-245`: `disconnect` only sets `connected: false` locally. HC permissions stay granted.
- There is no steps switch in Settings (grep). On Android, counting stops only on sign-out or a system revoke.
- v2 adds three background paths: Recording API subscription, HealthKit background delivery and HC background read.
  Each needs an "off".

**Rules**
- 5.1.1(ii): "provide the customer with an easily accessible and understandable way to withdraw consent" [A1].
- HC: "Users must be allowed to grant or deny permissions at any time" [G1].

**Fix.** Add a "Count steps automatically" switch (Health screen and Settings › Privacy & data). Off must:
- stop reads and saves;
- stop the sampler and clear its samples;
- `unsubscribe` the Recording API;
- iOS: `clearBackgroundTypes()`, and point to Settings › Health › Data Access & Devices › ÖRZA (apps can't revoke
  HealthKit);
- Android: HC "Disconnect" calls `revokeAllPermissions()` (exported by RNHC 4.1.3, `src/index.tsx:157`).

Do the same on account deletion.

### P10 (Medium, iOS): dropping `NSHealthUpdateUsageDescription` can fail the upload

Research §3.2 / G7 recommends `"NSHealthUpdateUsageDescription": false`. App Store Connect's static check (ITMS-90683)
looks at API *references*. Developers have had uploads rejected with "Your app's code references one or more APIs that
access sensitive user data. The app's Info.plist file should contain a NSHealthUpdateUsageDescription key…" [A9]. That
thread is community evidence, not policy. `@kingstinct/react-native-healthkit` compiles its save APIs into the binary
whether or not ÖRZA calls them.

**Fix**
- Try `false` on the first EAS → TestFlight upload. If ITMS-90683 comes back, restore the key with an honest string.
  The string is never shown, because ÖRZA never requests share access.
- Keep `toShare` empty in every `requestAuthorization`. Apple: the update key is "to write data" [A3].

### P11 (Medium-Low, iOS): purpose strings don't describe the whole use

- `app.json:142` (Health): "reads steps, activity, sleep, heart rate, weight and water … to personalise your targets and
  reports". It doesn't say that daily totals are saved to the ÖRZA account and website, or that Today counts steps from
  it. After P5 it lists types that are no longer read.
- `app.json:124` (Motion): it doesn't say that totals are saved to the account.

Rule: "Ensure your purpose strings clearly and completely describe your use of the data" [A1]. The HIG asks for "a
brief, complete sentence that's straightforward, specific" [A2]. Texts are in §5.3.

### P12 (Medium, Android): the Health apps declaration must change with v2

- The declaration is mandatory for every app [G4]. It needs a justification "for each permission requested", and must
  be updated when "an existing … app … now uses a different set of data types" [G2].
- "The data type accesses are allow-listed for a package name". When a new version ships, "your app's declaration may be
  reviewed again" [G2].
- The HC policy lists `READ_HEALTH_DATA_IN_BACKGROUND` among the permissions that need justification [G3]. Plan the
  timing: production background reads depend on that approval, while dev builds may behave differently.
- Wording is in §5.2.

### P13 (Medium, Android): phase-2 `WRITE_STEPS` isn't worth its policy cost

On top of research §2.3:
- **Data safety.** "Transfers to other apps on the device are not exempt" [G5]. Fitness info becomes **shared** unless
  the toggle meets the prominent-disclosure-and-consent standard [G6].
- **Justification and test.** The manifest permission applies on every Android version, but the feature exists only on
  Android 9–13. A reviewer on an Android 14+ device can't find it, which looks like "requested but not used" [G3].
- **Read-back rule.** "if your app has read data from Health Connect, that data shouldn't be written back" (research
  §2.2). This forces the `dataOrigins` check and delete logic.
- **Recommendation.** Don't ship `WRITE_STEPS`. Tell the client that on iOS and on Android 14+ every health app already
  sees the phone's steps, so steps are synced "both ways" in effect.
- **If "both ways" must mean ÖRZA → health apps, write ÖRZA's own first-party data.** That means confirmed meals
  (dietary energy and macros), water and typed weight. HC says "Your app should write all supported first-party data"
  (research §2.2). It brings:
  - Android `WRITE_NUTRITION` / `WRITE_HYDRATION` / `WRITE_WEIGHT`;
  - a real HealthKit share request plus an accurate `NSHealthUpdateUsageDescription`;
  - 5.1.3(ii) accuracy work: write only items the member confirmed, and update or delete when the meal is edited or
    deleted [A1].

  This is a separate product decision, not part of steps v2.

### P14 (Low-Medium, Android): exact alarms for a non-user-facing step sample

`modules/orza-steps/.../StepScheduler.kt:99-101` uses `setExactAndAllowWhileIdle` for the midnight samples whenever the
member granted "Alarms & reminders" for medicine alarms. Android: "Your app should use exact alarms, and declare either
SCHEDULE_EXACT_ALARM or USE_EXACT_ALARM permission, only if a user-facing function in your app requires
precisely-timed actions" [G10]. Splitting the step day at midnight isn't such a function. Play has no declaration for
`SCHEDULE_EXACT_ALARM` today, and `USE_EXACT_ALARM` is correctly not declared. Fix: use the inexact chain the module
already has. With the Recording API primary (research §1.2) the sampler rarely runs anyway.

### P15 (Low, Android): no foreground service for step counting

The merged manifest already has `FOREGROUND_SERVICE` from WorkManager's `SystemForegroundService` (merged:118; it has no
type). A "step counter" foreground service would need the `health` type, `FOREGROUND_SERVICE_HEALTH`, the Play Console
foreground-service declaration with a video, and a permanent notification [G11]. All-day passive counting is a weak use
case for it. The Recording API is the right answer, as research says. Don't add an FGS if Recording API freshness
disappoints; use `sampleNow()` in the foreground instead.

### P16 (Low, both): health-derived numbers in backed-up storage; kept after sign-out

- The step store (`src/lib/steps/store.ts:38`) and health store (`src/lib/health/store.ts:49`) live in `Paths.document`.
- The iOS Documents directory is part of iCloud Backup. Apple excludes only purgeable directories by default, "otherwise,
  iCloud Backup may include that data" [A8].
- Android has `allowBackup="true"`, with rules that exclude only SecureStore (merged:153-158).
- The files hold per-day step counts, some read from HealthKit, and are kept for **all** users for 14 days after
  sign-out.
- 5.1.3(ii): apps "may not store personal health information in iCloud" [A1]. Apple doesn't say whether device backups
  count, so this is low risk, but cheap to avoid.
- Fix: put these files in a directory excluded from backup (iOS `isExcludedFromBackup` [A8]; Android
  `noBackupFilesDir`, which the native sampler already uses). Delete the member's records on sign-out.
- The medicine photos in `Paths.document` (`src/lib/alarms/photos.ts:33`) are the same class (out of scope; note for
  D3).

### P17 (Low, iOS): privacy manifest coverage

- `@react-native-healthkit/core/ios/BackgroundDeliveryManager.swift` (the v2 background path) and
  `@kingstinct/react-native-healthkit/ios/Constants.swift` use `UserDefaults`. Neither pod ships a
  `PrivacyInfo.xcprivacy`, and `app.json` has no `ios.privacyManifests`.
- "Starting May 1, 2024, apps that don't describe their use of required reason API in their privacy manifest file
  aren't accepted by App Store Connect" [A7].
- Fix: before the first upload, check that the prebuilt app's `PrivacyInfo.xcprivacy` declares the UserDefaults category
  with reason CA92.1 (data written and read by the app itself). Otherwise add `ios.privacyManifests` in app.json.

### P18 (Low, iOS): say "Apple Health" in the App Store description

2.5.1: apps "should use APIs and frameworks for their intended purposes and indicate that integration in their app
description … HealthKit should be used for health and fitness purposes and integrate with the Health app" [A1]. The
`app.json` description (and therefore the planned listing) doesn't mention it.

### P19 (Low, both): persistent nudge after a refusal

`StepsCard.tsx:95`: `canAsk` stays true for `denied` and `blocked`, so the full-width energy CTA or "Open Settings" stays
on Today indefinitely. This is not a clear violation. It reads as pressure, though, and 5.1.1(iv) / Play's "respect
denial" spirit apply. Add "Not now — I'll log steps" that collapses the CTA for 30 days. Settings and the Health screen
keep the way back.

### P20 (Low, Android 14+): one permission for one source

- On Android 14+ with SDK extension ≥ 20, granting `READ_STEPS` makes Health Connect itself count this phone's steps.
  "If any app has been granted the READ_STEPS permission, Health Connect starts capturing steps from the Android-powered
  device" [G7]. It also brings in watches and fitness apps.
- Research's matrix asks for Physical activity (Recording API) **and** HC steps for the same walking. Under data
  minimisation [A1 5.1.1(iii) analogue; G3 "minimum data types"], prefer one by default:
  - on 14+ / ext ≥ 20, offer "Use Health Connect (this phone + your watch)" first;
  - fall back to Physical activity only if HC is refused, unavailable or locked out after two denials.
- Weigh the UX cost: the HC sheet is heavier than a runtime dialog. Whichever wins, say in the disclosure that granting
  Health Connect steps also makes HC keep this phone's steps for other apps you allow.

---

## 3. Research claims: confirmed, corrected, open

| Research claim | Verdict |
|---|---|
| Never write steps to HealthKit (§3.2) | **Confirmed.** 5.1.3(ii) [A1]; HealthKit already records iPhone and Watch steps |
| Android 14+: don't write steps (§2.3) | **Confirmed.** HC records phone steps natively once any app holds `READ_STEPS` [G7] |
| Aggregate with no origin filter is the right read | **Confirmed** [G8]: "use `aggregate()` instead of `readRecords()` to avoid double counting" |
| Declare `READ_HEALTH_DATA_IN_BACKGROUND` | **Confirmed** [G8][G3]. Also file it in the declaration (P12) and degrade gracefully when refused [G8] |
| Recording API needs only `ACTIVITY_RECOGNITION`; no extra Play declaration documented | **Confirmed** as far as the docs go [G9]. Android 9 GMS permission still unverified (agree with research) |
| HealthKit background delivery needs only the entitlement, hourly max for steps | **Confirmed** [A5] |
| Drop `NSHealthUpdateUsageDescription` | **Qualified**: verify with an upload (P10) |
| "The Today card already explains before the system prompt" (§4.1) | **Corrected**: the explanation exists, but its form breaks the HIG (P6) |
| "Manual entry remains the fallback, and that is fine" (§4.2) | **Corrected**: not in the `undetermined` state, nor in v2 iOS after a Health denial (P7) |
| "The rationale / privacy-policy activity is added by the RNHC config plugin" (§4.1) | **Corrected**: added, but it opens the app, not the policy (P1) |
| G1: read HC steps whenever `READ_STEPS` is granted, not only when "connected" | **Rejected as written**: keep a per-account consent gate (P8) |
| Phase-2 opt-in `WRITE_STEPS` on 9–13 | **Advise against** (P13) |
| Data safety: Fitness info, collected; App privacy: Health + Fitness | **Confirmed** [G5][A6]. Add "shared" only if HC writes ship; HealthKit/HC/motion data must not feed AI improvement (P4) |
| Steps-only, just-in-time HealthKit / HC request from Today | **Confirmed and required** (P5) |

---

## 4. When every permission is denied (must stay fully usable)

| Situation | Today (code) | v2 must |
|---|---|---|
| Android: Physical activity never asked | Only CTA, **no Log** (P7) | CTA + "Log steps" |
| Android: Physical activity denied / blocked | Log steps + persistent CTA / Open Settings | Log steps; collapsible CTA (P19) |
| Android: HC missing, refused, or 2-denial lockout | Health screen hints; steps via phone only | Same; Today never blocks on HC; "Open Health Connect" only from the card / Health screen |
| Android: HC background read refused | Background HC reads return null (`bridge.android.ts:252`) | Foreground reads still work; no error UI; website updates when the app opens [G8] |
| Android: Play services missing or too old | n/a | Sampler fallback; never prompt "update Play services" more than once |
| Android: everything refused | Log steps (after refusal) | Log steps; website still works; nothing runs in the background |
| iOS: Motion never asked | Only CTA, **no Log** (P7) | CTA + "Log steps" |
| iOS: HealthKit Steps off (invisible to the app [A4]) | Today shows CMPedometer if granted, else nothing | After 7 empty days → "Log steps" + one-time "Use iPhone motion instead" offer; never claim "you denied" |
| iOS: Motion denied | Log steps | Log steps |
| iOS: background delivery not delivered (locked phone, force-quit) | n/a | Foreground refresh; BGTask; no user-visible error |
| Any: new member on a phone with permissions already granted | Counting + 7-day backfill start silently (P8) | Disclosure + per-member consent first; backfill only from consent |
| Any: AI consent declined (P3) | n/a | Chat works without health-derived numbers in the prompt |

---

## 5. Declarations for v2

### 5.1 Android manifest (via app.json / config plugins)

- **Keep:**
  - `ACTIVITY_RECOGNITION`;
  - `health.READ_STEPS`;
  - `health.READ_SLEEP`, `health.READ_RESTING_HEART_RATE`, `health.READ_WEIGHT` (shown on Health);
  - `RECEIVE_BOOT_COMPLETED` (alarms + sampler fallback);
  - `uses-feature android.hardware.sensor.stepcounter required=false`.
- **Add:** `health.READ_HEALTH_DATA_IN_BACKGROUND`, and the P1 rationale activity.
- **Remove (P5):** `health.READ_ACTIVE_CALORIES_BURNED`, `health.READ_DISTANCE`, `health.READ_HEART_RATE`,
  `health.READ_HYDRATION`, unless a visible feature ships.
- **Don't add:** `health.WRITE_STEPS` (P13), `FOREGROUND_SERVICE_HEALTH` (P15), `HIGH_SAMPLING_RATE_SENSORS`,
  `READ_HEALTH_DATA_HISTORY` (30 days is enough).
- **After adding `play-services-fitness`,** diff the merged manifest. Strip any permission it adds that ÖRZA doesn't need
  (`tools:node="remove"` through a plugin). Add the GMS `ACTIVITY_RECOGNITION` only if Android 9 testing needs it.

### 5.2 Play Console

**Health apps declaration** [G4][G2]:
- Features: Activity and fitness; Nutrition / weight management; Sleep; Medication and treatment management (medical).
- Justifications (concrete, user-facing):
  - `READ_STEPS`: "Today shows the member's daily steps toward their step goal without typing. ÖRZA reads the day's
    aggregated, de-duplicated step total (phone, watches, fitness apps), saves only the daily total to the member's
    account and shows it on Today, the Health trends screen and weekly reports."
  - `READ_HEALTH_DATA_IN_BACKGROUND`: "Keeps today's step total on the member's account current while ÖRZA is closed,
    so the step goal, website dashboard and weekly report are up to date without opening the app. Runs at most about
    hourly and reads only aggregated step totals for today and the previous 7 days."
  - `READ_SLEEP` / `READ_RESTING_HEART_RATE` / `READ_WEIGHT`: name the Health screen chart or weight tracker each one
    feeds.

**Privacy policy URL** = the page P1 opens, with the P2 section.

**Data safety** [G5]:
- Health and fitness › **Fitness info** (steps; plus sleep if you classify it there) and **Health info** (resting heart
  rate, weight).
- Collected: yes. Shared: no (service providers are exempt; HC writes would change this).
- Purposes: App functionality, Personalization. Encrypted in transit; deletable.
- Processing that stays on the phone (sampler raw samples, Recording API buckets) is not collection.

### 5.3 iOS

- **Entitlements:** `com.apple.developer.healthkit`; `com.apple.developer.healthkit.background-delivery` (plugin
  `background: true`) [A5]; no `healthkit.access`. `UIBackgroundModes`: only `processing` (expo-background-task); add
  none for HealthKit.
- **`NSHealthShareUsageDescription`** (after P5): "ÖRZA reads your steps, sleep, resting heart rate and weight from Apple
  Health to fill in Today and your Health trends. Only daily totals are saved to your ÖRZA account."
- **`NSMotionUsageDescription`:** "ÖRZA uses your iPhone's motion data to count your steps when Apple Health has none,
  and saves each day's total to your ÖRZA account."
- **`NSHealthUpdateUsageDescription`:** see P10. If kept: "ÖRZA doesn't save anything to Apple Health. If that ever
  changes, it will ask you first."
- **Pre-alert sheet (P6):** title "Count your steps automatically"; points:
  - what is read;
  - that only the daily total is saved to the account and shown on the website (and in the coach, if P3a is
    consented);
  - "never where you go";
  - single button "Continue".
- **App Store Connect privacy** [A6]: Health & Fitness › **Health** (HealthKit) and › **Fitness** (Motion & Fitness),
  linked to the user, App Functionality (+ Product Personalization); not tracking. Privacy policy URL as in P2.
- **Privacy manifest:** P17.
- **Review notes:**
  - Steps on Today count automatically from Apple Health / iPhone motion, and the Health screen shows trends.
  - Everything works with all permissions denied (Log steps).
  - Background delivery is hourly at most.
  - Provide a demo account.
- **Listing:** mention Apple Health (P18).

---

## Sources

- [A1] App Review Guidelines (2.5.1, 5.1.1, 5.1.2(i) "including with third-party AI", 5.1.3): https://developer.apple.com/app-store/review/guidelines/
- [A2] Human Interface Guidelines, Privacy (best practices, purpose strings, pre-alert screens): https://developer.apple.com/design/human-interface-guidelines/privacy
- [A3] HealthKit, Protecting user privacy (third-party disclosure, privacy policy, read denial hidden, usage keys): https://developer.apple.com/documentation/healthkit/protecting-user-privacy
- [A4] HealthKit, Authorizing access to health data (per-type, request when needed, denied read indistinguishable): https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data
- [A5] `enableBackgroundDelivery(for:frequency:withCompletion:)` (entitlement, hourly max for stepCount): https://developer.apple.com/documentation/healthkit/hkhealthstore/enablebackgrounddelivery(for:frequency:withcompletion:)
- [A6] App privacy details (Health, Fitness, "collect", on-device processing): https://developer.apple.com/app-store/app-privacy-details/
- [A7] Describing use of required reason API: https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api
- [A8] Optimizing your app's data for iCloud Backup (`isExcludedFromBackup`): https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup
- [A9] Apple Developer Forums, ITMS-90683 missing NSHealthUpdateUsageDescription (community evidence, not policy): https://developer.apple.com/forums/thread/695864
- [G1] Health Connect, Get started (privacy-policy activity, rationale intent, alias, permissions at any time): https://developer.android.com/health-and-fitness/health-connect/get-started
- [G2] Health Connect, Publish (declaration steps, per-type justification, same privacy policy, re-review, allow-list per package): https://developer.android.com/health-and-fitness/health-connect/publish
- [G3] Play Console Help, Health Connect policy (minimum scope, limited use, consent for third parties, background/history permissions): https://support.google.com/googleplay/android-developer/answer/12991134
- [G4] Play Console Help, Health apps declaration: https://support.google.com/googleplay/android-developer/answer/14738291
- [G5] Play Console Help, Data safety (Fitness/Health info, collection, sharing, exemptions, on-device): https://support.google.com/googleplay/android-developer/answer/10787469
- [G6] Play Console Help, User Data policy (prominent disclosure and consent, privacy policy content): https://support.google.com/googleplay/android-developer/answer/10144311
- [G7] Health Connect, Track steps (on-device steps on READ_STEPS grant, SDK ext 20/22, SPN, Recording API for ≤ 13): https://developer.android.com/health-and-fitness/health-connect/features/steps
- [G8] Health Connect, Read data (background reads, degrade gracefully, aggregate vs double counting, 30-day limit): https://developer.android.com/health-and-fitness/health-connect/read-data
- [G9] Recording API on mobile (ACTIVITY_RECOGNITION, 10 days, unsubscribe makes data inaccessible): https://developer.android.com/health-and-fitness/guides/recording-api
- [G10] Schedule alarms (exact alarms only for user-facing precisely-timed functions): https://developer.android.com/develop/background-work/services/alarms/schedule
- [G11] Foreground service types and Play FGS declaration: https://developer.android.com/develop/background-work/services/fgs/service-types ; https://support.google.com/googleplay/android-developer/answer/13392821
- [G12] Android Developers Blog, Privacy protections for physical activity (Recording API step types need activity recognition): https://android-developers.googleblog.com/2019/11/privacy-protections-for-physical.html
