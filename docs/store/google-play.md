# Google Play — audit and Play Console answers (ÖRZA for Android)

Package `in.co.ylo.orza` · version 1.0.0 · minSdk 26, targetSdk 36 · nothing released yet.
Written 2026-11-13 (D3). Every policy below was re-read on 2026-11-13; links are in §8. Updated the same day with the
user's answers (§0; the same decisions as `app-store.md` §0).

**What was read**
- `app.json`: `android.permissions` and `blockedPermissions`.
- Both local modules' `AndroidManifest.xml` (`modules/orza-alarms`, `modules/orza-steps`).
- The manifests of the libraries, through the **merged release manifest** and the merger blame report of the last
  Android build. That is the release-type test build of `16e8cf8` in `E:\aylo\orza-mobile-build`, from 12 Nov.
- The release APK of that build, for 16 KB page alignment.
- `npx expo config --type introspect`, after this step's fix.
- The code paths behind each permission, and the live privacy policy and terms in `E:\aylo\orza-backend`.

No build, no device, no server, and no AI calls were used.

---

## 0. On one screen

**Adversarial review (2026-11-13, after `fb431a7`).** Every Data safety row, permission and justification was checked
again against the code, the web routes and the live policy. One correction: **App activity › App interactions** is now
declared (the credit ledger and the device's last-seen time; it had been listed as "not collected"). The `a478b71`
blocks hold: expo-secure-store calls androidx.biometric only for `requireAuthentication` items (none in ÖRZA), and
Android never asks for the photo library (the picker needs no storage permission). Listing fixes are in `listing.md`.

**Fixed in this step** (commit `a478b71`, `app.json` only). These are added to `android.blockedPermissions`, so they
are gone from the next Android build:

| Permission | Came from | Why it goes |
|---|---|---|
| `READ_EXTERNAL_STORAGE` (≤ API 32) | expo-file-system, expo-image-picker | Never asked for. On Android, photos are chosen with the system Photo Picker (`PickVisualMedia`), and the library permission is asked on iPhone only (`src/lib/image.ts`). |
| `USE_BIOMETRIC`, `USE_FINGERPRINT` | androidx.biometric (expo-secure-store) | Only used when an item is stored with `requireAuthentication`, which ÖRZA never sets. This matches iOS, which has no Face ID string. |
| `USE_EXACT_ALARM` | nothing today | A guard. Play allows it only for alarm-clock, timer and calendar apps. ÖRZA uses the user-granted `SCHEDULE_EXACT_ALARM`. The guard stops a future library from adding it. |
| `com.google.android.gms.permission.AD_ID` | nothing today | A guard. There are no ads and no advertising ID, so the "Advertising ID" answer stays **No**. |

Kept on purpose:
- `WRITE_EXTERNAL_STORAGE` (≤ API 32): expo-image-picker's camera refuses to open without it on Android 8–9.
- `FOREGROUND_SERVICE`: from WorkManager. No service has a type and none is ever started, so there is no Play form.

**Already correct**
- Exact alarms: `SCHEDULE_EXACT_ALARM` only.
- Photos: Photo Picker; `READ_MEDIA_*` are blocked.
- No `SYSTEM_ALERT_WINDOW`, no `QUERY_ALL_PACKAGES`, no `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`, no typed foreground
  service.
- Health Connect: exactly 4 read types plus background reading. No write, no history.
- In-app AI report; AI consent naming OpenAI before the first AI request.
- In-app account deletion.
- Target API 36, as required since 31 Aug 2026.
- All 26 arm64 libraries are 16 KB aligned (79/79 LOAD segments at `0x4000`, and zipalign `-P 16` passes).

**Decided by the user (2026-11-13, "OK to all"; the same answers as `app-store.md` §0)**

| Item | Decision | Status |
|---|---|---|
| Developer account | **Individual accounts.** Play: FatafatDecor's existing account (its type and creation date aren't known yet). | Play says health apps "such as Medical apps" must come from an **Organization** account, and ÖRZA declares **Medication and treatment management**, a Medical category. Risk accepted: if Play refuses the health declaration or the release for it, the answer is an Organization account (D-U-N-S). If the account is personal and was made after 13 Nov 2023, the 12-tester, 14-day closed test comes first (§5 step 8). |
| Minimum age | **18 everywhere** (D1). | Done: web `d3-web` (onboarding `src/lib/onboarding.ts`, profile `components/account/options.ts`, the goal planner) and the app (`src/features/settings/options.ts` `age.min: 18`, Goals). Ages already saved are left as they are; the local test data has none under 18. Target audience 18+ (§3.5). |
| Privacy policy developer information | **Name who is responsible for ÖRZA and a grievance contact** (D3, India DPDP), plus the service-provider sentence and "never reads your phone's location". | Done on web `d3-web` with one constant each (`PRIVACY_CONTROLLER_NAME` = "Kunal Patil", `PRIVACY_GRIEVANCE_EMAIL` = support@orza.app), to be confirmed with the user before the web push. See the open question below on the Play developer name. |
| Support email | **support@orza.app** receives mail. | Store contact, IARC email, policy contact. |
| Full-screen intent | **Option B: not declared** for default access; members allow it in the app. | §3.8. |
| Countries | **India first.** No EU until the trader details are decided. | §5 step 7. |
| WhatsApp | **Off** in production until Meta's verification, so **no phone number** is declared now. | Pre-launch checklist (`listing.md` §0): update Data safety here and App Privacy on Apple **before** switching WhatsApp on. |
| Approximate location | **Declared** (the state picked at sign-up). | §3.10; the policy says "never reads your phone's location" (D3). |
| App interactions | **Declared** (the credit ledger, the device's last-seen time). | §3.10. |
| AI credits | **Free at launch** (members request, admins grant). | Later, if ÖRZA sells credits on Android (Razorpay was the plan): digital goods need **Google Play Billing**, or Google's **alternative billing program for India** (user choice billing, which offers Play Billing next to the other method; check its current terms and enrol first). A plain Razorpay checkout inside the app, or a link to one, isn't allowed. iPhone: IAP (`app-store.md` 3.1.3). |
| Category | **Health & Fitness** (App Store: Health & Fitness + Food & Drink). | §3.9. |
| Demo account | **The user creates it** on production; the password stays with the user. | Pre-launch checklist; §3.2. |
| Copy | The listing and the D3 audit copy are **approved**. | `listing.md`; the new D3-decision strings are in `app-store.md` §4.2. |

**Still blocking a Play release**

1. **A public account-deletion web page.**
   - Play requires a URL where people can ask for deletion without the app.
   - The website only has Delete inside the signed-in Settings.
   - A draft page is in §4. It needs a website change, the user's OK and a deploy.
2. **The demo account on production** for App access and the pre-launch report (the user, checklist).
3. **The web push** of `d3-web` (policy developer details, 18+, opt-in AI improvement, the hidden menu for app pages),
   after the user confirms the name and contact.

**Open questions**
- **Play developer name.** The listing shows the Play account's developer name under ÖRZA (FatafatDecor's account
  today). Play's User Data policy asks the privacy policy for "developer information", and the policy will name
  "Kunal Patil". If the account's developer name is the company's, either name that company in the policy too
  (`PRIVACY_CONTROLLER_NAME`) or change the developer name, so the two match.
- **Account-deletion page** (§4): OK to publish it, and are 7 days and "no backups keep deleted data" right?

---

## 1. Audit — policy by policy

Verdicts: ✅ meets it · ⚠️ needs an answer or a small change · ⛔ blocks the release.

| Area | What Play asks | What ÖRZA does | Verdict |
|---|---|---|---|
| **Health apps declaration** | Every app on any track must complete it. Declare every health feature. Health Connect apps justify each data type. Ask only for what a user-facing feature needs. Re-file when the types change. | Features: Activity and fitness, Nutrition and weight management, Sleep management, Medication and treatment management. Four HC read types plus background, each tied to a screen (§3.7). | ✅ answers ready |
| **Organization account** | Health apps "such as Medical apps" need an Organization account (D-U-N-S). | Medication management is in the Medical group of the form. Decision: FatafatDecor's existing account (individual accounts, §0); its type is still to check. | ⚠️ risk accepted (§0) |
| **Health Connect: Limited Use** | No ads, no sale, no transfer except to provide the feature, with explicit consent. The privacy policy must be the same page Health Connect opens. | The AI consent sheet names OpenAI and says steps and weight go with chats. Without consent, the server leaves HC data out (ai-consent.md R1/R2). Privacy `#phone-app`: never sold, never for ads, never used to improve AI. `HealthPrivacyActivity` opens `https://orza-nine.vercel.app/privacy#phone-app`, the same page as the Console URL. | ✅ |
| **`READ_HEALTH_DATA_IN_BACKGROUND`** | A justification in the HC section of the form. | Steps only, about hourly (WorkManager), today plus the last few days. Asked in Health Connect's own screen, after the steps sheet or Health sync's Connect (V2 fix B1). | ✅ text in §3.7 |
| **`READ_HEALTH_DATA_HISTORY`** | Only if needed. | Not declared. The 30 days before the first grant need no history permission. | ✅ |
| **Data safety** | Every type collected or shared, with optional/required, purposes, encryption in transit and deletion. It must match the privacy policy. | 14 types (App interactions added in review; approximate location declared; no phone number while WhatsApp is off), collected and not shared (OpenAI, hosting and email are service providers). Encrypted in transit; deletion in the app and on the web. | ⚠️ ready (§3.10). Needs the deletion URL (§0, still blocking). |
| **Exact alarms** | `USE_EXACT_ALARM` is restricted to alarm / timer / calendar apps. Others use `SCHEDULE_EXACT_ALARM`, which the user grants, and must check `canScheduleExactAlarms()`. | `SCHEDULE_EXACT_ALARM` only: `setAlarmClock` for doses, `setExactAndAllowWhileIdle` for reminders, inexact fallback, a re-plan on `SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED`. The first-run sheet asks for "Alarms & reminders". Steps uses inexact alarms only. `USE_EXACT_ALARM` is now blocked. | ✅ no form |
| **Full-screen intent** (Android 14+) | Default access only for apps whose core function is setting an alarm or taking calls (declaration on App content). Others must ask the user and work without it. | The permission is declared. `canUseFullScreenIntent()` is read, and "Full-screen alarms are off" + Allow (`ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT`) shows on Alarms on this phone, on Reminders and on Medicines. Without it, an alarm is a ringing heads-up notification. Decision: option B, default access not declared (§3.8). | ✅ |
| **`ACTIVITY_RECOGNITION`** | Health-related and sensitive: a prominent in-app disclosure right before the request, and an affirmative tap. | The "Count your steps automatically" sheet: one "Continue", then the system prompt. Back or close is "no". | ✅ |
| **`RECEIVE_BOOT_COMPLETED`** | No form. | Re-arms medicine alarms and the step sampler after a reboot, an update or a time change. | ✅ |
| **Foreground services** | Apps targeting 34+ declare each FGS type they use. | None. WorkManager's `SystemForegroundService` has no type and is never started (no `setForeground` anywhere). | ✅ no form |
| **Photos and videos** | `READ_MEDIA_IMAGES/VIDEO` only for core photo-library use; otherwise the Photo Picker. | `READ_MEDIA_*` and `ACCESS_MEDIA_LOCATION` are blocked. expo-image-picker uses `PickVisualMedia` (backport through the Play services `photopicker_activity` module). The camera asks only on "Take photo". | ✅ no form |
| **Calendar** | A runtime permission. Health apps disclose in context. | Asked only on "Add to my calendar" (Calendar › Add ÖRZA to my phone calendar), after a card that says what it writes. It writes doses and reminders into its own "ÖRZA" calendar under a local account. It reads only that calendar's events (to update them). Nothing leaves the phone. | ✅ |
| **Notifications** | `POST_NOTIFICATIONS` at run time on 13+. | Asked from the "Let your medicine alarms ring" sheet after the first alarm medicine. Reminders work without it. | ✅ |
| **Camera, microphone** | Runtime, in context. | Camera on "Take photo" (meals, medicines, prescriptions). Microphone on the mic button. The phone's own speech service turns speech into text, and no audio reaches ÖRZA. | ✅ |
| **Other permissions** | Ask only for what you use. | Normal permissions: INTERNET, ACCESS_NETWORK_STATE, WAKE_LOCK, VIBRATE, the FCM `c2dm.RECEIVE` (expo-notifications, unused, no `google-services.json`), the install referrer (expo-application, never read), and ShortcutBadger's launcher badge permissions. Normal, with no form, but they show on the listing's permission details. | ✅ (kept) |
| **AI-Generated Content** | Apps whose chatbot is central must let people report or flag offensive AI output inside the app. | Report on every Ask ÖRZA reply (a flag, or long press › Report this reply), AI recipes, rebalance plans, the Snap result and AI meals. The reports go to the admin console (`ai-report.md`). The web endpoint is live (`ee25fb9`). The phone's device check is still to do. | ✅ |
| **User Data: third-party AI** | Prominent disclosure and consent before data goes to an AI provider. The privacy policy names it. | One consent sheet naming OpenAI before the first AI request. Not now, back and close all mean no. The server refuses every client without consent. Privacy "AI processing" names OpenAI. | ✅ |
| **Health Content: disclaimer** | Health apps that aren't regulated devices must say in the **description** that the app "is not a medical device and does not diagnose, treat, cure, or prevent any medical condition", and remind users to consult a healthcare professional. | In the app: "Wellness guidance, not medical advice. For medical concerns, please consult your doctor." on Today, Ask, Goals, Recipes, Rebalance, Snap, the prescription review, the alarm and sign-up. In the store: the sentence is in both Play descriptions (`listing.md`). | ✅ |
| **Health misinformation / medical device** | No claims against medical consensus. A regulated device must say so. | Wellness guardrail in every AI prompt. The prescription scan "copies what's written and never changes a dose". No diagnosis, no dosing advice. Not declared as a medical device. | ✅ (CDSCO status is the user's legal call) |
| **Account deletion** | An in-app path, and a web link that works without the app, naming the app or developer. Deactivation doesn't count. | In the app: More › Settings › Privacy & data › Delete account (type DELETE). It deletes every collection, the AI reports, the devices and the sessions (web `api/account`). On the web: Settings › Delete account…, signed in only. | ⛔ the web page is needed (§0) |
| **Privacy policy** | Public, not a PDF, labelled as a privacy policy, linked in the app and the listing. Developer information and a contact; data, uses, sharing, security, retention, deletion. | Public `/privacy`, linked in sign-up and Settings. Data, AI, Health Connect, sharing, security, retention and deletion are all covered. Web `d3-web` adds who is responsible for ÖRZA and a grievance contact (D3). | ⚠️ live after the web push; the developer-name question in §0 |
| **Target audience / Families** | Pick the age groups. Under-13s bring the Families policy. | 18+ in the terms and policy, and onboarding and Settings refuse a new age under 18 (D1). | ✅ |
| **Content rating** | Unrated apps are not allowed (clarified 15 Jul 2026). | IARC answers in §3.4. | ✅ answers ready |
| **Ads** | Declare. | No ad SDK and no `AD_ID` (now blocked). | ✅ |
| **Target API / 16 KB pages** | New apps target API 36 (from 31 Aug 2026). 64-bit libraries need 16 KB pages. | targetSdk 36; 16 KB checked on the test build's APK. | ✅ |
| **App access** | Credentials for anything behind sign-in. | Everything is behind sign-in, so the demo account is needed; the user creates it (checklist). | ⚠️ §0 |
| **App registration** (developer verification, 2026) | Play apps must be registered in Play Console. | A new app created in Play Console is registered there. | ✅ |
| **Payments** | Google Play Billing for digital goods. | No purchases. AI credits are free at launch, granted by the team and requested in the app, with no prices and no payment links. Website pages opened from the app hide the site menu and pricing links (`from=app`, D5). Selling credits later needs Play Billing or the India alternative billing program (§0). | ✅ |

---

## 2. The release manifest, permission by permission

This is the merged release manifest of the `16e8cf8` test build, plus this step's blocks. Re-check it on the next
build:
```
aapt2 dump permissions app-release.apk
```

| Permission | Added by | Used for | Play form | Status |
|---|---|---|---|---|
| `INTERNET`, `ACCESS_NETWORK_STATE` | template, expo-image (Glide) | the API, images | — | keep |
| `CAMERA` | app.json, expo-image-picker | Snap & Know, medicine photos, prescriptions | — | keep |
| `RECORD_AUDIO` | app.json | voice meals and chat (speech to text on the phone) | — | keep |
| `POST_NOTIFICATIONS` | app.json, orza-alarms, expo-notifications | medicine alarms and reminders | — | keep |
| `SCHEDULE_EXACT_ALARM` | app.json, orza-alarms | doses at the minute | none | keep |
| `USE_FULL_SCREEN_INTENT` | app.json, orza-alarms | the alarm over the lock screen | **FSI declaration** | keep (§3.8) |
| `VIBRATE`, `WAKE_LOCK` | app.json, orza-alarms, WorkManager | alarm vibration; delivering the alarm | — | keep |
| `RECEIVE_BOOT_COMPLETED` | app.json, both modules, expo-notifications | re-arm after reboot / update | — | keep |
| `ACTIVITY_RECOGNITION` | app.json, orza-steps, expo-sensors | the phone's step counter and the Recording API | — (disclosure in the app) | keep |
| `READ_CALENDAR`, `WRITE_CALENDAR` | app.json | the "ÖRZA" calendar on the phone | — | keep |
| `health.READ_STEPS`, `READ_SLEEP`, `READ_RESTING_HEART_RATE`, `READ_WEIGHT` | app.json | Today, Health, Goals | **Health apps** | keep |
| `health.READ_HEALTH_DATA_IN_BACKGROUND` | app.json | the hourly steps save | **Health apps** | keep |
| `WRITE_EXTERNAL_STORAGE` (≤ 32) | expo-image-picker, expo-file-system | camera on Android 8–9 | — | keep |
| `FOREGROUND_SERVICE` | WorkManager 2.9.1 | nothing (no typed FGS) | none | keep |
| `c2dm.permission.RECEIVE` | firebase-messaging (expo-notifications) | nothing yet (no push) | — | keep |
| `BIND_GET_INSTALL_REFERRER_SERVICE` | installreferrer (expo-application) | never read | — | keep |
| ShortcutBadger launcher permissions (Samsung, HTC, Sony, Huawei, OPPO …) | expo-notifications | launcher badges | — | keep |
| `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION` | androidx.core | signature-level, internal | — | keep |
| `READ_EXTERNAL_STORAGE` | expo-file-system, expo-image-picker | — | — | **blocked now** |
| `USE_BIOMETRIC`, `USE_FINGERPRINT` | androidx.biometric | — | — | **blocked now** |
| `USE_EXACT_ALARM`, `gms.permission.AD_ID` | — (guards) | — | — | **blocked now** |
| `READ_MEDIA_IMAGES/VIDEO/AUDIO`, `ACCESS_MEDIA_LOCATION`, `SYSTEM_ALERT_WINDOW` | template / libraries | — | — | blocked before |

**Exported components** (all intended)
- `MainActivity`: launcher and deep links.
- `HealthPrivacyActivity` and its `VIEW_PERMISSION_USAGE` alias: Health Connect's privacy link. The alias is guarded
  by `START_VIEW_PERMISSION_USAGE`.
- `BootReceiver` and `StepBootReceiver`: system broadcasts. They read only the action.
- `<queries>` names only the Health Connect app, Google's speech services and seven makers' battery screens. There is
  no `QUERY_ALL_PACKAGES`.

---

## 3. Play Console answers, ready to paste

App content is under **Policy and programs → App content** (also reached from Monitor and improve).

### 3.1 Privacy policy
`https://orza-nine.vercel.app/privacy`

This is the same page Health Connect opens (`…/privacy#phone-app`; the app's WebView adds `from=app`, which only
hides the website's menu). Its developer information (who is responsible for ÖRZA, a grievance contact) goes live
with the web push of `d3-web` (D3).

### 3.2 App access
**All or some functionality is restricted.** Add one set of instructions:
- Name: `Demo account`
- Username: `<demo email — the user creates it on production>`
- Password: `<demo password>`
- Any other information:

```
All of ÖRZA needs a free account. This demo account has finished onboarding, has AI credits, and has sample meals and medicines.
- AI features (Ask ÖRZA, Snap & Know, typed or spoken meals, recipes, rebalance plans, prescription scan) ask once for permission to use OpenAI: tap "Allow". Settings > Privacy & data > AI features turns it off; everything else keeps working.
- Report an AI answer: tap the flag under any Ask ÖRZA reply, or long-press the reply > "Report this reply". Recipes, plans, the Snap result and AI meals have "Report" too.
- Medicine alarms: Medicines > add a medicine with a time 2 minutes ahead, then allow notifications and "Alarms & reminders". Or More > Reminders > Alarms on this phone > "Test alarm" (rings in 10 seconds). Full-screen alarms over the lock screen need "Full-screen alarms" allowed (Allow on the same card, Android 14+).
- Health Connect: More > Health sync > Connect (steps, sleep, resting heart rate, weight). Steps: Today > "Count steps automatically". Health Connect > App permissions > ÖRZA > Privacy policy opens our policy.
- Every permission can be refused: steps can be typed ("Log steps"), meals picked from the food list, medicines entered by hand.
- Account deletion: More > Settings > Privacy & data > Delete account (please keep this demo account).
```

Use the same email and password in **Test and release → Pre-launch report → Settings → Credentials**, so the test
robot can sign in.

### 3.3 Ads
**No, my app does not contain ads.**

### 3.4 Content ratings (IARC)

The labels below are the questionnaire's topics. Check them against the live form wording.

- **Email** for IARC: the support inbox.
- **Category:** the non-game "all other app types" / utility category. Not Game, not Social networking, not News or
  Educational.

| Question (topic) | Answer | Why |
|---|---|---|
| Violence, blood, fear / horror | No | — |
| Sexuality, nudity | No | — |
| Language (profanity, crude humour) | No | The AI coach runs with the wellness guardrail. |
| Controlled substances: references to drugs, alcohol or tobacco | **Yes — references to alcohol only.** No depiction of use; it doesn't encourage use; nothing is sold. | The food list has beer, wine and spirits with their calories (so drinks can be logged). The coach may talk about drinking in a wellness context. Prescription medicines are legal medicines in a reminder context. |
| Gambling, simulated gambling, contests | No | — |
| Users can interact or exchange content with each other | No | The chat is with ÖRZA's AI, not with people. Household sharing hasn't launched. |
| Shares the user's location with other users | No | — |
| Digital purchases | No | No purchases. AI credits are free and granted by the team. |
| Unrestricted internet / web browser | No | It opens only ÖRZA's own pages (privacy, terms, trust). |
| Generative AI content (if the form asks) | Yes: AI chat, recipes, plans, meal and prescription reading; in-app reporting | — |

Expect a low rating, possibly a step up for the alcohol references. That is fine for an 18+ audience.

### 3.5 Target audience and content
- **Target age groups:** **18 and over** only (D1: the app and the website refuse a new age under 18).
- **Could the listing unintentionally appeal to children?** No.
- No Families program and no teacher-approved programme.

### 3.6 Other App content declarations

| Declaration | Answer |
|---|---|
| News app | No |
| COVID-19 contact tracing / status | No (not a COVID app) |
| Government app | No |
| Financial features | "My app doesn't provide any financial features" |
| Advertising ID | **No** (no `AD_ID`; now blocked) |
| Data safety | §3.10 |
| Health apps | §3.7 |
| Full-screen intent | §3.8 |
| Foreground services / exact alarm / photo and video permissions | No form expected (§1). If one shows up, answer that ÖRZA has no typed foreground service and uses neither `USE_EXACT_ALARM` nor `READ_MEDIA_*`. |

### 3.7 Health apps declaration

**Page 1: health features.** Tick only these:
- Health and fitness:
  - ☑ **Activity and fitness** — daily steps toward a step goal.
  - ☑ **Nutrition and weight management** — meal logging, calorie and macro targets, weight goal and trend.
  - ☑ **Sleep management** — a sleep chart from Health Connect.
- Medical:
  - ☑ **Medication and treatment management** — medicine schedules, photo alarms, stock and refill alerts,
    prescription scan → alarms.
- Leave everything else unticked: Medical device apps, Diseases and conditions management, Clinical decision support,
  Human subjects research, and the rest. ÖRZA isn't regulated, doesn't diagnose and doesn't manage a disease.

**Page 2: Health Connect data types.** One text box per permission. Paste these:

**Steps (`READ_STEPS`)**
```
Today shows the member's daily steps against their own step goal, without typing. After the member turns on "Count steps automatically" in ÖRZA and allows Steps in Health Connect, ÖRZA reads the day's aggregated step total (this phone plus any watch or fitness app that shares steps with Health Connect) for today and up to the last 30 days, and saves one total per day to the member's ÖRZA account. The totals are shown on Today, the Health screen, the weekly report and the member's ÖRZA website dashboard. Only if the member has allowed ÖRZA's AI features (run by OpenAI, explained in the app before asking), today's step count is part of the context the AI coach uses to answer the member's own chat messages. Steps are never used for ads, never sold, never shared with data brokers and never used to train or improve AI. Turning the feature off stops all reads.
```

**Read health data in the background (`READ_HEALTH_DATA_IN_BACKGROUND`)**
```
Keeps the member's step total current while ÖRZA is closed, so the step goal on Today, the website dashboard and the weekly report are up to date without opening the app. About once an hour (an Android WorkManager job), ÖRZA reads only daily step totals for today and the previous few days (watches often sync late) and saves one total per day to the member's account. No other data type is read in the background. Health Connect asks the member separately on its own screen; if they refuse, steps are saved only while ÖRZA is open, and the app says so.
```

**Sleep (`READ_SLEEP`)**
```
Shows the member's nightly sleep time on the Health screen's sleep chart and on their ÖRZA website, next to what they eat. After the member connects Health Connect on ÖRZA's Health screen, ÖRZA reads each night's total sleep for up to the last 30 days, when the app is opened (at most every few hours) or when the member taps "Sync now", and saves one total per day to the member's account. Sleep is never sent to AI providers, never used for ads and never sold.
```

**Resting heart rate (`READ_RESTING_HEART_RATE`)**
```
Shows the member's daily resting heart rate as a trend chart on the Health screen, next to their meals and activity. Read only after the member connects Health Connect, for up to the last 30 days, when the app is opened (at most every few hours) or on "Sync now"; one value per day is saved to the member's account. It is never sent to AI providers, never used for ads and never sold. ÖRZA does not diagnose or monitor any condition.
```

**Weight (`READ_WEIGHT`)**
```
Fills the member's weight trend and the Goals weight tracker with weigh-ins from a smart scale or another app, so they don't have to type them. Read only after the member connects Health Connect, for up to the last 30 days, when the app is opened (at most every few hours) or on "Sync now"; one value per day is saved to the member's account and shown as progress toward the member's own weight goal. Only if the member has allowed ÖRZA's AI features (OpenAI), their tracked weight may be part of what the AI coach uses to answer their own chat messages. Never used for ads, never sold and never used to train or improve AI.
```

If the form asks for the privacy policy, give the §3.1 URL. It is the page Health Connect's "Privacy policy" link
opens: `HealthPrivacyActivity`, `PRIVACY_URL`.

Re-file this form whenever a Health Connect type is added or dropped (`steps-v2.md` §4.2 lists the "never add" types).

### 3.8 Full-screen intent

The Android 14+ declaration is on App content. Its exact option labels couldn't be confirmed from public pages on
2026-11-13. Choose by meaning. **Decision (2026-11-13): option B.**

- **Option B: chosen for the first release.**
  - Answer that ÖRZA does **not** need default (automatic) access: it isn't an alarm-clock or calling app.
  - Nothing needs review, so nothing can be rejected. ÖRZA keeps the permission. On new Android 14+ installs it starts
    off, and the app already shows "Full-screen alarms are off" + Allow.
  - Without it, a dose still rings as an insistent heads-up notification with its photo and Take / Snooze / Skip. It
    just doesn't fill the locked screen.
  - Optional follow-up: add full-screen as a third step of the "Let your medicine alarms ring" sheet on Android 14+,
    so new members are asked in the flow and not only on the cards. Not built; this would be new copy.
- **Option A (not chosen).**
  - Declare the core use case **setting alarms**: user-set medicine alarms that ring at the dose time with a full-screen
    alarm screen showing the medicine's photo. This would match the store title "Meals, Meds & AI Coach".
  - Google decides whether medicine alarms count as "core". Other apps' declarations have been rejected, which then
    blocks the release until it's changed.

### 3.9 Store settings (Grow users → Store presence → Store settings)
- **App or game:** App.
- **Category:** **Health & Fitness**, not Medical.
- **Tags:** pick from Play's list, up to five, closest to "Nutrition", "Diet", "Calorie counter", "Medication
  reminder" and "Fitness tracking".
- **Contact details:**
  - Email: `support@orza.app` (it receives mail).
  - Website: `https://orza-nine.vercel.app`.
  - Phone: optional.
- **External marketing:** your choice.

### 3.10 Data safety

**Overview questions**

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS only; release builds allow no cleartext) |
| Which methods of account creation does your app support? | **Username and password** (email and password); no other sign-in |
| Delete account URL | `https://orza-nine.vercel.app/delete-account`. **This page must exist first** (§4). |
| Can users request that some or all of their data is deleted, without deleting their account? | **Yes** (§4 has the second half; the URL is optional) |
| Independent security review | No |

**Data types.** For every type: shared = **No**. OpenAI (AI features), hosting and database, and email delivery
process data for ÖRZA as service providers. WhatsApp reminders and calendar feeds are sent only because the member
turns them on.

| Category › type | Collected | Ephemeral | Required / optional | Purposes | What it is in ÖRZA |
|---|---|---|---|---|---|
| Personal info › **Name** | Yes | No | Required | App functionality, Account management, Personalization | name at sign-up; the first name goes with AI chat and rebalance plans |
| Personal info › **Email address** | Yes | No | Required | App functionality, Account management, Developer communications, Fraud prevention, security and compliance | sign-in, account emails, replies to credit requests |
| Personal info › **User IDs** | Yes | No | Required | App functionality, Account management | the ÖRZA account ID |
| Personal info › **Other info** | Yes | No | Required | App functionality, Personalization | age, sex, preferred language, diet preference, household mode |
| Location › **Approximate location** | Yes | No | Required | App functionality, Personalization | the Indian state (or "Outside India") picked at sign-up, for regional food (decided below); there is no location permission and no GPS |
| Health and fitness › **Health info** | Yes | No | Required | App functionality, Personalization | height, weight and target weight, allergies, health notes; medicines (name, strength, dose, schedule, stock, who it's for), dose history, prescriptions; resting heart rate and weight from Health Connect |
| Health and fitness › **Fitness info** | Yes | No | Required | App functionality, Personalization | goal, activity level, meals and nutrition, water, step goal and steps (Health Connect or the phone's sensor), sleep (Health Connect) |
| Messages › **Other in-app messages** | Yes | No | Optional | App functionality, Personalization | Ask ÖRZA chats (your messages and ÖRZA's replies) |
| Photos and videos › **Photos** | Yes | No | Optional | App functionality | meal photos for Snap & Know (analysed and not kept), medicine photos and prescription photos (kept) |
| Calendar › **Calendar events** | Yes | No | Optional | App functionality | only if the member connects their own calendar's iCal address (ÖRZA's server reads its events to show them). Events written to the phone's ÖRZA calendar stay on the phone. |
| App activity › **In-app search history** | Yes | No | Optional | App functionality | food-list searches (not stored by ÖRZA; hosting request logs may keep them briefly) |
| App activity › **Other user-generated content** | Yes | No | Optional | App functionality, Personalization | what ÖRZA remembers, lifestyle notes, reminder texts, recipe and rebalance requests, reports of AI answers, credit-request notes |
| App activity › **App interactions** | Yes | No | Required | App functionality | added in review (2026-11-13): the credit ledger, one row per AI use with the feature and the time (web `lib/credits.ts`), and the time this phone last opened ÖRZA in its device record (`lib/device.ts`, web `lib/devices.ts`), used for the balance and so medicine alarms don't ring twice |
| Device or other IDs | Yes | No | Required | App functionality, Account management | this phone's ÖRZA device record (an ID ÖRZA's server gives it, the device name or model, platform, app version, time zone), so medicine alarms don't ring twice and the member can see their signed-in phones |

**Not collected:** Phone number (while WhatsApp is off, above); Address; Race and ethnicity; Political or religious beliefs (the "Jain" diet is a food preference
and ÖRZA asks no religion question); Sexual orientation; all Financial info (no payments; credits aren't money);
Precise location; Emails; SMS; Videos; Audio (the phone's own speech service turns speech into text, and ÖRZA receives
only the text); Files and docs (exports are made on the phone and shared by the member); Contacts;
Installed apps (the `<queries>` checks stay on the phone); Other actions; Web browsing; Crash logs, Diagnostics and
other performance data (no crash or analytics SDK); Advertising ID.

Data that never leaves the phone is not "collection": step-sensor samples, Recording API buckets, the photo cache and
the alarm plan.

**Decided for this form (2026-11-13)**
- **Approximate location: declared.**
  - It is the member's state of residence, an area much larger than 3 km².
  - The privacy line in `#phone-app` now reads "…never reads your phone's location" (web `d3-web`, D3; it said
    "…never collects your location"). The profile list already names "region".
- **Phone number: not declared** while WhatsApp reminders are off in production (until Meta's verification).
  - The server can show the WhatsApp card without an app update, so **before WhatsApp is switched on**, add
    Personal info › **Phone number** (Yes, not ephemeral, Optional, App functionality: "only if the member turns on
    WhatsApp reminders") here and Contact Info › Phone Number on Apple. It is on the pre-launch checklist
    (`listing.md` §0).
- **No "Analytics" purpose for chats.** "Help improve ÖRZA's AI" is opt-in and off by default (D2), and no code uses
  it today (`ai_training_opt_out` is only stored). Anonymised data isn't user data. Re-file before any such work
  starts.

---

## 4. Account deletion page for the website (draft — needs the user's OK and a web deploy)

This is a new public page `/delete-account` on the website (web repo, `(site)` group, like `/privacy`). Link it from
the privacy policy's "Your rights" › Deletion, and use its URL in Data safety.

The `{developer name}` placeholder is the Play developer name. `{support email}` is the live support inbox.

> **Delete your ÖRZA account**
>
> ÖRZA is made by {developer name}. You can delete your ÖRZA account and all of its data at any time. Deleting is
> permanent and can't be undone.
>
> **In the ÖRZA app (Android or iPhone):** More › Settings › Privacy & data › Delete account. Type DELETE and tap
> Delete forever.
>
> **On the website:** sign in, open Settings › Privacy & data, choose Delete account… and type DELETE.
>
> **Can't sign in?** Email {support email} from your account's email address with the subject "Delete my account".
> We'll check it's you and delete your account within 7 days.
>
> **What is deleted:** your profile and account, meals and scans, conversations, goals, plans, recipes, medicines and
> their photos, prescriptions, dose history, reminders, step counts and other health data, connected phones and
> notification addresses, credit history and requests, and reports you sent about AI answers. You are signed out
> everywhere.
>
> **What is kept:** nothing from your account. If you also joined our updates list or a plan waitlist, that email
> address stays until you ask us to remove it.
>
> **Delete some data and keep your account:** delete any meal, medicine or chat in the app; change or remove what ÖRZA
> remembers in Settings › What ÖRZA remembers. To delete the health data your phone sent (steps, sleep, resting heart
> rate, weight) and keep your account, email {support email} with the subject "Delete my phone health data".

**Check before publishing**
- Does the database have backups that keep deleted data for a while? If so, add one line saying for how long.
- Is 7 days the right promise for email requests?

---

## 5. Your step-by-step (Play Console)

Do the shared pre-launch checklist first (`listing.md` §0).

1. **The account: FatafatDecor's existing one** (decided, §0).
   - Check its type and creation date. A personal account made after 13 Nov 2023 must run a closed test with ≥ 12
     testers opted in for 14 days in a row before it can ask for production (step 8).
   - If Play asks for an Organization account for the health declaration: it needs a D-U-N-S number matching the
     company; Google verifies it, which takes days.
2. **Create the app:** Play Console → **Create app**.
   - Name `ÖRZA`.
   - Default language: English (India) or English (United States).
   - **App**, **Free**.
   - Tick the Developer Program Policies and US export laws boxes.
3. **Build the AAB** from `main` after the D3 commits:
   ```
   eas build --platform android --profile production
   ```
   - The `production` profile makes an app bundle with `autoIncrement`.
   - The first Android build asks to **generate a new Android keystore**. Say yes; EAS keeps the upload key.
   - The version code is remote and starts from `versionCode` 1 in `app.json`.
   - Run it in your own terminal (it asks questions).
   - Download the `.aab` from the build page.
4. **First upload: do it by hand.**
   - Test and release → Testing → **Internal testing** → Create new release.
   - Play App Signing: accept **Google-generated key**.
   - Upload the `.aab`. Release name `1.0.0 (1)`. Notes: "First internal test."
   - Save → Review → **Start rollout to Internal testing**.
   - Testers tab: create an email list and add your Google account(s). Copy the **opt-in link** and open it on the
     Android phone to install.
   - Internal testing doesn't need the store listing or the forms first.
   - About EAS:
     - The older rule (and this task's brief) is that EAS Submit can't do the very first upload, because the Google
       Play API can't create the first release.
     - Expo's docs, checked 2026-11-13, now say `eas submit` can make the first internal-testing release once the
       app exists in Play Console and EAS has a Google service-account key. The app stays "draft" until setup is
       done, so use `releaseStatus: "draft"`.
     - The manual upload is simpler and needs no service account, so use it for the first one.
5. **Fill App content** (§3.1–3.10). Do the **Health apps** form early: Health Connect's review can take some days.
   Don't submit Data safety until the deletion page (§4) and the privacy-policy developer details are live.
6. **Store listing** (Grow users → Store presence → Main store listing): the texts, icon, feature graphic and
   screenshots from `listing.md`.
7. **Store settings** (§3.9). **Countries:** India only for now (decided). If the EU is ever added: check the Play
   Console's EU Digital Services Act **trader status** (account details) first. A trader's address, phone and email
   are shown to EU users. Apple's equivalent is confirmed (`app-store.md` §3 step 5); Google's own help page for it
   wasn't found on 2026-11-13, so check the Console.
8. **Closed testing** (only if step 1 says so).
   - Testing → Closed testing → create a track.
   - At least 12 testers, opted in for 14 days in a row, actually using the app.
   - Then Dashboard → **Apply for production** (Play asks about the test).
9. **Production:**
   - Production → Create new release → promote the tested build, or upload a new one.
   - Turn on **Managed publishing** (Publishing overview) so you choose when it goes live after review.
   - The first review usually takes a few days. Health and full-screen declarations may add time.
10. **Later — EAS Submit:**
    - Make a Google Cloud service account with the Play Console release permissions.
    - Add its JSON key with `eas credentials --platform android` (Google Service Account Key).
    - Add `"android": { "track": "internal", "releaseStatus": "draft" }` under `submit.production` in `eas.json`.

---

## 6. Re-check on the next Android build (add to the device list)

- `aapt2 dump permissions`: no `READ_EXTERNAL_STORAGE`, `USE_BIOMETRIC`, `USE_FINGERPRINT`, `USE_EXACT_ALARM` or
  `AD_ID`. Everything in §2 marked "keep" is present.
- Choose a photo from the library (meal, medicine, prescription) on Android 13+ and, if possible, on 10–12: the Photo
  Picker opens with no storage prompt.
- Take a photo on Android 8–9, if a device is available: the camera still opens (`WRITE_EXTERNAL_STORAGE` is kept).
- Sign in and sign out, and restart while signed in (secure store without biometrics).
- The Play pre-launch report signs in with the demo account and shows no crash.
- Health Connect › App permissions › ÖRZA › Privacy policy, and Settings › Privacy policy / Terms of service: the
  policy opens without the website's menu or pricing links, and following a link inside it keeps them hidden (D5).
- Then open `orza-nine.vercel.app` in Chrome itself: a normal visit still shows the website's menu (the website keeps
  "opened from the app" in the in-app tab's own storage, not in a cookie, because Custom Tabs share Chrome's cookies).

---

## 7. What changed in the repo
- `app.json` `android.blockedPermissions` (+5), commit `a478b71`.
- The D3 decisions (2026-11-13): 18+ in Settings and Goals, "Help improve ÖRZA's AI" opt-in, `from=app` on every
  website page the app opens (`src/lib/web.ts`; also the Health Connect privacy WebView, a native change in
  `modules/orza-steps`, so the next Android build carries it), iPhone-only calendar wording.
- This file and `docs/store/listing.md`.

## 8. Sources (all checked 2026-11-13)
- Permissions and APIs that access sensitive information (exact alarm, full-screen intent, Health Connect):
  https://support.google.com/googleplay/android-developer/answer/16558241
- Foreground service and full-screen intent requirements (FSI dates, default grant only for alarm and calling apps,
  FGS types): https://support.google.com/googleplay/android-developer/answer/13392821 and
  https://support.google.com/googleplay/android-developer/answer/16965181
- Schedule alarms (`SCHEDULE_EXACT_ALARM` vs `USE_EXACT_ALARM`):
  https://developer.android.com/develop/background-work/services/alarms/schedule
- Health Content and Services (declaration, disclaimer wording, medical devices, misinformation):
  https://support.google.com/googleplay/android-developer/answer/16679511
- Health apps declaration form: https://support.google.com/googleplay/android-developer/answer/14738291
- Health app categories: https://support.google.com/googleplay/android-developer/answer/13996367
- Declare Health Connect access:
  https://developer.android.com/health-and-fitness/guides/health-connect/publish/declare-access
- Health Connect policy FAQs: https://support.google.com/googleplay/android-developer/answer/12991134
- Developer account requirements (Organization account for health apps):
  https://support.google.com/googleplay/android-developer/answer/10788890
- Testing requirements for new personal accounts (12 testers, 14 days):
  https://support.google.com/googleplay/android-developer/answer/14151465
- Data safety section (types, collection, sharing, service providers, ephemeral):
  https://support.google.com/googleplay/android-developer/answer/10787469
- User Data policy (privacy policy contents, account deletion, prominent disclosure, third-party AI):
  https://support.google.com/googleplay/android-developer/answer/10144311
- Account deletion requirements: https://support.google.com/googleplay/android-developer/answer/13327111
- AI-Generated Content: https://support.google.com/googleplay/android-developer/answer/13985936
- Policy announcement, 15 Jul 2026 (third-party AI clarification, unrated apps, app registration):
  https://support.google.com/googleplay/android-developer/answer/17134731
- Content ratings: https://support.google.com/googleplay/android-developer/answer/9898843 and
  https://support.google.com/googleplay/android-developer/answer/188189
- Target API level: https://support.google.com/googleplay/android-developer/answer/11926878
- Store listing assets: https://support.google.com/googleplay/android-developer/answer/9866151
- EAS Submit for Android (first submission): https://docs.expo.dev/submit/android/
- Earlier store checks reused here: `docs/notes/ai-consent.md` §1 (2026-11-10), `docs/notes/ai-report.md` §1,
  `docs/notes/steps-v2.md` §9.
