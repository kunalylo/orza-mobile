# ÖRZA for iPhone: App Store review pack (D3)

Checked on **2026-11-13** against the App Review Guidelines (page last updated **16 October 2026**) and the
Apple pages listed under Sources. Audited code: `main` at `2b1cf48` (this step's fixes included). TestFlight
build 2 (`9b64238`) works on the user's iPhone. It doesn't have these fixes yet, so **the App Store submission
needs build 3** from main. Updated the same day with the user's answers (§0): the app changes are on `main` after
`ab3e370`, the website changes on the web branch `d3-web` (not pushed yet).

Bundle `in.co.ylo.orza` · App Store Connect app id `6833346228` · version 1.0.0 (EAS remote build numbers) ·
iPhone only (`supportsTablet: false`) · developer team "Kunal Patil (Individual)" · no in-app purchases · no
social logins · AI credits are free.

**Summary.** The app itself is in good shape: in-app account deletion that really deletes, the AI consent, the AI
report, read-only Apple Health use, permissions asked only when used, and disclaimers on the health screens. This
step fixed 11 findings in code (§1, "FIXED"). The user answered every question on 2026-11-13 ("OK to all", §0), and
the answers are applied in the app and on the web branch `d3-web`. What is left before submitting is in the
pre-launch checklist (`listing.md` §0): the web push, build 3, the demo account and the individual-account risk.

**Adversarial review (2026-11-13, after `fb431a7`).** The code commits since `3a6f9f3` hold up (no regression, nothing
iOS-only reaches Android or the reverse). Corrected here: App Privacy now declares **Usage Data › Product Interaction**
(the credit ledger and the device's last-seen time were declared nowhere), the **Phone Number** answer follows the
same WhatsApp rule as Play (the server can show the card on iPhone without an update), and Coarse Location points at
the privacy sentence that contradicts it. Found: medicine events written into the member's **iCloud** calendar
(5.1.3(ii), §1; fixed by D4), the EU Digital Services Act **trader status** (§3 step 5), and Apple's **required**
Dynamic Island medium screenshot set (`listing.md` §4.2). Review notes: Settings paths start at More. Listing fixes
are in `listing.md`.

## 0. Decisions (the user, 2026-11-13)

| # | Decision | Where it is applied |
|---|---|---|
| D1 | **Minimum age 18 everywhere.** Onboarding and Settings refuse a new or changed age under 18; ages already saved are left as they are (none under 18 in the local test data). | Web `d3-web` (onboarding, profile, goal planner); app `PROFILE_LIMITS.age.min` 18 (Settings › Profile, Goals). Age rating: override to 18+ (§2.2). |
| D2 | **"Help improve ÖRZA's AI" is opt-in, off by default.** On only if the member turns it on; accounts that never chose are off; nothing uses it today. | App `aiImprovementOn` (`ai_training_opt_out === false` is on; missing or `true` is off); web `src/lib/ai-improvement.ts` (new accounts store off, every `{user}` answer carries the effective value, finishing onboarding keeps it). |
| D3 | **Privacy policy:** service providers "may use it only to provide their service to ÖRZA and must protect it at least as well as this policy does"; "never reads your phone's location"; who is responsible for ÖRZA and a grievance contact (India DPDP). | Web `d3-web`. The name and contact ("Kunal Patil", support@orza.app) are confirmed with the user before the web push. |
| D4 | **iPhone calendar events don't name the medicine** ("💊 Medicine time · ÖRZA"), because the ÖRZA calendar usually syncs to iCloud. Android unchanged. | App `features/calendar/phoneEvents.ts` (§1 5.1.3(ii)). |
| D5 | **Website pages opened from the app hide the site menu** (no route to Pricing): the app adds `from=app` to every website address it opens. | App `lib/web.ts` `openWebsite`; web `d3-web` (hidden for the rest of that in-app browser tab's visit). |
| D6 | **Account and business answers:** individual accounts on both stores (Apple "Kunal Patil (Individual)"); support@orza.app receives mail; AI credits free at launch (members request, admins grant; selling credits later needs IAP on iOS); India first, no EU until the trader details are decided; WhatsApp off, so no phone number declared; the user creates the demo account; Coarse Location and Product Interaction declared; category Health & Fitness + Food & Drink; the new copy approved. | This file, `google-play.md`, `listing.md`. |

---

## 1. Audit (strict reviewer)

Status: **PASS**: meets the rule as written. **FIXED**: fixed in `2b1cf48`, or by a D3 decision (§0) where it says
so. **RISK**: could still be rejected; the user accepted it or it waits for a step in the checklist. **USER**:
something to do in App Store Connect.

| Guideline | Status | Evidence / fix |
|---|---|---|
| **1.4.1** Medical: accuracy claims, "check with a doctor" | PASS + FIXED | The app makes no measurement claims of its own. Steps, sleep, heart rate and weight come from Apple Health or CMPedometer. Calorie estimates are labelled ("Calorie estimates are approximate", "Estimates for wellness guidance, not medical advice"). The doctor line ("Wellness guidance, not medical advice. For medical concerns, please consult your doctor.") is on Today, More, Ask ÖRZA, Goals, Recipes and recipe, Rebalance and plan, Reports (daily and weekly), the logged-meal card, Snap, onboarding and sign-up. The medicines tab says "…it never changes doses. Always follow your doctor's advice." The alarm screen says "Unsure about a dose? Check with your doctor or pharmacist." **FIXED:** the Health screen (heart rate, sleep and weight charts) had no doctor line; it now has the app-wide one. |
| **1.4.1 / 1.4.2** Prescription scans, dosing | PASS + FIXED | ÖRZA calculates no doses. A scan is a review screen ("Compare each line with your prescription… nothing is saved until you tap Create alarms"), and its footer says "ÖRZA copies what's written and never changes a dose. If anything differs from your prescription, trust the prescription and ask your doctor or pharmacist." The server AI guardrail (`WELLNESS_GUARDRAIL`) forbids diagnosing, prescribing or changing medication, and sends emergencies to a doctor or emergency services. **FIXED:** the scan screen said "ÖRZA reads **every** medicine", an accuracy claim. It now says "…reads the medicines… and you check each one before any alarm is set." |
| **1.2** UGC / AI content creation | PASS | Not a UGC app: nothing is distributed to other users. The AI output still has a filter (the system guardrail), in-app reporting (Report on every Ask ÖRZA reply, AI recipe, rebalance plan, Snap result and AI meal; the admin console lists reports), and a contact (FIXED, see 1.5). |
| **1.5** Developer information | FIXED | The sign-in screen said "Contact ÖRZA support" with no way to do it, and Settings had no contact. **FIXED:** Settings › **Help** › "Contact support" opens a mail to the support address (toast with the address when there is no mail app), plus "Terms of service". The sign-in line now links the address. The address is the website's (`support@orza.app` by default; `EXPO_PUBLIC_SUPPORT_EMAIL` overrides it). The user confirmed `support@orza.app` receives mail (D6). Support URL: `https://orza-nine.vercel.app/faq` (§3 step 3). |
| **2.1(a)** Completeness | PASS + FIXED + USER | No "coming soon", placeholder or lorem text, and no empty handlers (searched every screen). WhatsApp reminders appear only when the server has them configured, which is off in production. The admin notice only shows for staff accounts. **FIXED:** the iPhone Health screen pointed to website-only importers ("Use the importers on the ÖRZA website", "More ways to connect"). The iPhone reads Apple Health itself, so the website detour is gone on iOS (Android keeps it). **USER:** the user creates the demo account, with AI switched on in production and enough credits for the demo (§3 step 2). |
| **2.1(b)** IAP complete | PASS | No in-app purchases are configured. |
| **2.3** Accurate metadata | PASS + USER | Privacy answers (§2.1) match the code. The description must mention Apple Health (2.5.1), and screenshots must show the app in use (`docs/store/listing.md`). Don't mention prices, Premium or the website's plans in the listing. |
| **2.3.10** Other platforms | FIXED | The iPhone said "Health Connect" (Android's health service) in Preferences › "Help improve ÖRZA's AI". On iOS it now names Apple Health and the iPhone's motion sensor only. Other Health Connect, Google Play and Android copy only shows on Android (checked: steps card, Health sync, AI consent per platform). |
| **2.5.1** HealthKit for health, integrated with the Health app | PASS + USER | Four read types (steps, sleep, resting heart rate, weight), used for Today and Health trends. **USER:** name Apple Health in the description. |
| **2.5.4** Background modes only as used | FIXED | Resolved `UIBackgroundModes` was `fetch` + `processing`. expo-task-manager's automatic plugin always adds `fetch` (background app refresh), which ÖRZA never uses. The hourly alarm re-plan is expo-background-task, a BGProcessingTask under `processing`, and Apple Health background delivery needs only its entitlement. **FIXED:** `plugins/withUsedBackgroundModes.js` removes `fetch`. `npx expo config --type introspect` now shows `["processing"]` and `BGTaskSchedulerPermittedIdentifiers: ["com.expo.modules.backgroundtask.processing"]`. No `audio`, `location`, `voip` or `remote-notification`. |
| **2.5.14** Recording indication | PASS | The microphone runs only while dictating, with a visible "Listening · English" and a pulsing dot (plus the system orange dot). Nothing records in the background. |
| **2.5.2** Self-contained | PASS | No downloaded code and no `expo-updates`. |
| **3.1.1 / 3.1.3** Digital goods, credits | PASS + FIXED | The app has no prices, purchase links or buy buttons. Credits are granted free at launch (D6): 100 at sign-up, more through "Request more credits", a message the team answers by adding credits. **FIXED:** wording that read like buying: "AI credits · Free plan" (suggests paid plans) became "AI credits · Free". "Balance, history and top-ups", "we'll top you up" and "Running low — top up" now say "request more" / "add more". **FIXED (D5):** the website pages the app opens (privacy policy, terms, trust, the AI section, the Android health importers, the admin console, website links in replies) carry `from=app` (one helper, `lib/web.ts` `openWebsite`; `npm run test:links`), and the website then hides its menu and its links to the marketing and pricing pages for the rest of that tab's visit, so **Pricing** (Premium ₹299/month, "Join the waitlist") can't be reached from the app. **Review fix:** the app never opens the website's home page or Pricing (`openWebsite` refuses them, and a link to one in an ÖRZA reply shows as plain text, `npm run test:links` L5), and Sign out or Delete account on a page the app opened lands on the website's sign-in page, not its home page (web `pathAfterLeaving`). The Terms still mention "AI top-up packs" in text, with nothing to buy. **Later:** if credits are ever sold, iOS sells them through IAP (3.1.3(b)) and the review notes' "free" sentences change (§2.7). |
| **4.2** Beyond a web wrapper | PASS | Native throughout (React Native; no WebView screens). It has local medicine alarms with photos and actions, Apple Health, CMPedometer, camera scans, on-device speech, a phone calendar, a background task and haptics. The in-app browser only opens the website's legal pages, website links in ÖRZA's replies (never its home page or Pricing) and, for staff, the console. |
| **4.5.4** Notifications | PASS | Notifications aren't needed to use the app: the alarms card shows "Off" with a fix and nothing else is locked. All are local, with no remote push (no APNs token is sent). There is no marketing; reminders are the member's own. **Time Sensitive** (`com.apple.developer.usernotifications.time-sensitive`) is used only for medicine doses and their snoozes (`interruptionLevel: item.ring ? 'timeSensitive' : 'active'`); reminders and refill alerts are `active`. This entitlement needs no Apple approval. No critical alerts. |
| **4.8** Login services | PASS | Email and password only (ÖRZA's own accounts), so Sign in with Apple isn't required. |
| **5.1.1(i)** Privacy policy link in the app | PASS + FIXED (web, D3) | Linked at sign-up, in Settings › Privacy & data › Privacy policy, in Privacy & data › Policies, from the AI consent sheet (`/privacy#ai-processing`) and in Preferences. The policy covers what is collected and why, OpenAI, Apple Health and motion data, retention and deletion, revoking consent and contact. It didn't *confirm that third parties give the same or equal protection*, which Apple often cites in rejections, nor name who is behind "ÖRZA". **FIXED on web `d3-web` (D3):** "With service providers" adds "They may use it only to provide their service to ÖRZA and must protect it at least as well as this policy does.", and the policy names who is responsible for ÖRZA and a grievance contact (`PRIVACY_CONTROLLER_NAME`, `PRIVACY_GRIEVANCE_EMAIL`). Live after the web push; the name is confirmed with the user first (checklist). |
| **5.1.1(ii)** Consent and withdrawal; purpose strings | PASS + FIXED | AI: explicit consent, withdrawn in Settings › Privacy & data › AI features. Steps: a disclosure, then a switch in Settings and Health. **FIXED purpose strings:** Calendar said "…and shows your day's plans" (ÖRZA reads only the events it added); Reminders claimed a Reminders feature that doesn't exist (EventKit references reminders, so the key stays, with an honest text like the approved Health Update one). **FIXED (D2):** "Help improve ÖRZA's AI" was on by default (opt-out) for chats and logs. It is now **opt-in**: off for new accounts and for every account that never chose (only the member's own "on", stored as `ai_training_opt_out: false`, counts), with "It’s off unless you turn it on." in its description. Nothing on the server uses it today. |
| **5.1.1(iii)** Minimisation | PASS | Photos use the system picker (PHPicker, no library permission; the permission is asked only on old iOS as a fallback). HealthKit: 4 read types, no write. Calendar: full access is needed because write-only access can't create the ÖRZA calendar; the code only lists and changes its own calendar's events. No location, contacts, tracking, IDFA or analytics SDKs (checked `package.json`). |
| **5.1.1(iv)** Respect choices; HIG pre-alerts | FIXED | The medicine-alarm sheet, shown on its own after the first medicine with times, was a pre-alert with "Allow notifications" and "Not now". HIG says "use a term like Continue… don't provide a way… to leave the screen… without viewing the system alert", a common 5.1.1 rejection. **FIXED (iOS):** one "Continue →" button, no Not now or close while the prompt can still be shown; any answer closes the sheet (a refusal is not asked again here). After a refusal the card offers Settings. The "Alarms on this phone" buttons now say "Turn on notifications" / "Turn on" instead of "Allow". The steps disclosure already followed the pattern ("Continue", not dismissible on iPhone). The AI consent sheet is a legal consent, not a pre-alert, so Allow / Not now is correct there. |
| **5.1.1(iv)** Usable when denied | PASS | Camera denied: gallery, typing, the food list; Rx can type medicines; medicines use the gallery. Microphone or speech denied: typing. Notifications denied: the app works and the card shows how to fix it. Apple Health or Motion denied: "Log steps", weight by hand. Calendar denied: the in-app calendar and the subscribe link. AI declined: food list, manual Rx, saved recipes and plans. |
| **5.1.1(v)** Login and account deletion | PASS | An account is justified: data syncs with the website and AI runs on the server. Deletion is in the app: Settings › Privacy & data › Delete account → type DELETE → "Delete forever". The server (`DELETE /api/account`) deletes the member's data in all 20 data collections, their credit requests and the user record, and ends every session. The phone cancels alarms, photos, the steps cache and Apple Health background delivery. Profile fields (age, sex, height, weight) feed the calorie targets (core). |
| **5.1.1(ix)** Regulated field, individual developer | **RISK (accepted)** | Medicine alarms and prescription scans put ÖRZA near "healthcare". Apple expects such apps from a legal entity, not an individual. Team = "Kunal Patil (Individual)". **Decision (D6):** submit as the individual account. If Apple rejects for 5.1.1(ix), the answer is an Organization account (D-U-N-S) and an app transfer (§3 step 1). |
| **5.1.2(i)** Third-party AI | PASS | Done (`docs/notes/ai-consent.md`). The sheet names OpenAI before the first AI request, the server refuses AI without consent from every client, and AI health data (steps, weight) is sent only after consent. |
| **5.1.2(vi), 5.1.3(i)** HealthKit and Motion data use | PASS | Used only for the member's own wellness: no ads, marketing or data mining. It reaches OpenAI only inside Ask ÖRZA, after consent (the purpose strings say so). The specific types are named in the purpose string and on the Health card before connecting. |
| **5.1.3(ii)** No false HealthKit writes; no health data in iCloud | PASS + FIXED (D4) | No HealthKit writes (read-only; `NSHealthUpdateUsageDescription` says so). No iCloud APIs (CloudKit, iCloud Drive, KVS). On the phone, HealthKit-derived step counts are kept only in the cache folder (`orza-steps-days.json`), which isn't backed up. Note: the alarm engine's medicine cache and photos sit in Documents, which a device iCloud *backup* includes. That isn't HealthKit data and not "iCloud storage" as the rule means it, but they could move out of backups later (native work, §5 Q1). **Found in review:** "Add to my calendar" creates the ÖRZA calendar in the **default calendar's source first** (`features/calendar/deviceCalendar.ts` `createOwnCalendar`), which on most iPhones is **iCloud**, and its events carried the medicine name and dose ("💊 Metformin — 500 mg"). **FIXED (D4):** on iPhone every dose event is "💊 Medicine time · ÖRZA" with no medicine name, strength, timing or person; the notes keep only "Marked as taken / skipped", "Open ÖRZA to see which medicine it is and mark the dose." and the links back (`features/calendar/phoneEvents.ts`, `npm run test:calendar`). The event's `orza://alarm` link opens the dose in the app with its name and photos. The Calendar card says why on iPhone. A changed event text changes its signature, so the next sync rewrites the upcoming events an older build (TestFlight builds 1–2) wrote with names; events that already passed keep them until the member taps Remove (it deletes the whole ÖRZA calendar). Android is unchanged (a local calendar that syncs nowhere). |
| **HealthKit HIG** (icon, wording) | FIXED | The Apple **logo** glyph (`mci:apple`) stood for Apple Health on the Connect button, the connected status and the steps sheet. Apple: "Use only the Apple-provided icon", "Don't use the Apple Health icon as a button". **FIXED:** a neutral heart icon everywhere. The UI never says "HealthKit"; it says "Apple Health". |
| **Privacy manifest / required-reason APIs** | PASS | See §2.8. Every SDK that touches a required-reason API was checked. React Native's pod-install step combines all pod manifests into the app's `PrivacyInfo.xcprivacy`. Build 1.0.0 (2) passed Apple processing with no ITMS-91053 / 91061. |
| **Info.plist strings** | PASS + FIXED | See §2.8. Each one is specific, says why, is asked in context, and matches the code. |
| **ATS** | PASS | Prebuild template: `NSAllowsArbitraryLoads` false, `NSAllowsLocalNetworking` true. Release builds talk only to `https://orza-nine.vercel.app`. The dev-launcher local-network key is stripped from non-Debug builds by its own build phase. |
| **Age rating vs terms** | FIXED (D1) + USER | The Terms said 18+ but onboarding accepted 13+. **FIXED (D1):** 18 is the minimum age everywhere: onboarding (server, web `d3-web`), Settings › Profile and the goal planner (app `PROFILE_LIMITS.age.min` 18, web). Ages already saved are left as they are. Apple: if a EULA's minimum age exceeds the calculated rating, "you must override". **USER:** override to 18+ (§2.2). |

---

## 2. App Store Connect answers (ready to paste)

### 2.1 App Privacy

Privacy Policy URL: `https://orza-nine.vercel.app/privacy` (or the custom domain once set).
**Do you or your third-party partners collect data from this app? Yes.**
Tracking: **No** for every type. ÖRZA has no ads, no data brokers and no linking with third-party data; OpenAI processes
requests for ÖRZA only. Every type below is **linked to the user** (account-based).

| Category › Data type | Collected | What it is in ÖRZA | Purposes |
|---|---|---|---|
| Contact Info › **Name** | Yes | Name at sign-up; the coach uses the first name | App Functionality, Product Personalization |
| Contact Info › **Email Address** | Yes | Sign-in, replies to credit requests and support | App Functionality |
| Contact Info › Phone Number | **No** (D6: WhatsApp off) | Only for WhatsApp reminders, which stay off in production until Meta's verification. The iPhone shows the WhatsApp card (`features/reminders/WhatsAppCard.tsx`) as soon as the server reports WhatsApp configured (`GET /api/integrations`), **with no app update**, so **before WhatsApp is switched on**, change this answer to **Yes**, App Functionality (labels can change any time without a build), and Play's Data safety the same way (pre-launch checklist, `listing.md` §0). | n/a until then |
| Health & Fitness › **Health** | Yes | Meals and nutrition, water, weight, allergies, health notes; medicines, doses, refills, prescriptions; resting heart rate, sleep and weight from Apple Health | App Functionality, Product Personalization |
| Health & Fitness › **Fitness** | Yes | Daily steps (Apple Health / Motion & Fitness), activity level | App Functionality, Product Personalization |
| Location › **Coarse Location** | **Yes** (D6) | The state the member picks at sign-up (regional food) and the device time zone. No device location is read. The policy's `#phone-app` line now says "…and ÖRZA never reads your phone's location" (web `d3-web`, D3; it said "never collects your location", which contradicted this answer). | App Functionality, Product Personalization |
| Location › Precise Location | No | n/a | n/a |
| Sensitive Info | No | Not asked. Free-text health notes are declared under Health. | n/a |
| User Content › **Photos or Videos** | Yes | Medicine and prescription photos (stored); meal photos (sent for analysis, kept by OpenAI up to 30 days for abuse checks) | App Functionality |
| User Content › Audio Data | No | Speech is turned into text by Apple's speech service; ÖRZA gets only text (Apple's own collection isn't ours to declare). | n/a |
| User Content › **Customer Support** | Yes | "Request more credits" messages, AI reports and their notes, support emails | App Functionality |
| User Content › **Other User Content** | Yes | Ask ÖRZA chats, typed or spoken meal text, remembered facts, recipe and rebalance requests, reminders, the external calendar address the member connects | App Functionality, Product Personalization |
| User Content › Emails or Text Messages | No | The in-app chat is with ÖRZA, not messages to people | n/a |
| Identifiers › **User ID** | Yes | Account id | App Functionality |
| Identifiers › Device ID | No | No IDFA or IDFV. The device registry sends only platform, model, app version and time zone (see Other Data). | n/a |
| Purchases, Financial Info, Contacts, Browsing History, Search History | No | No payments. Food searches aren't stored. | n/a |
| Usage Data › **Product Interaction** | **Yes** (corrected in review, 2026-11-13; D6) | Apple: "app launches, taps… or other information about how the user interacts with the app". The server keeps the **credit ledger**: every AI use as a row with the feature (`action`: scan, chat, recipe…) and its time (web `lib/credits.ts`), and the phone's device record holds its **last-seen time**, refreshed on launch and return to the app (`lib/device.ts`, web `lib/devices.ts`). Both are functional (balance, alarm de-duplication), but they are records of how the member uses the app, and the first pass's "already declared above" wasn't true: no other type covers them. Dose history is Health (above). | App Functionality |
| Usage Data › Advertising Data, Other Usage Data; Diagnostics | No | No analytics, ads or crash SDKs; the phone sends no crash or error reports. | n/a |
| Other Data › **Other Data Types** | Yes | Age, sex, height, goal, diet, language, household mode, lifestyle; device model and app version (alarm de-duplication) | App Functionality, Product Personalization |

"Help improve ÖRZA's AI" is opt-in and off by default (D2), and nothing uses it today, so no purpose is declared for
it. Before the team ever uses chats or logs to improve the AI (only for members who turned it on), add **Other
Purposes** to Other User Content and Health, and re-check Play's Data safety.

### 2.2 Age rating (App Information › Age Ratings)

| Section | Item | Answer |
|---|---|---|
| In-App Controls | Parental Controls / Age Assurance | None / No |
| Capabilities | Unrestricted Web Access | No. The in-app browser opens ÖRZA's own pages and links in replies, with no address bar. |
| | User-Generated Content | No. Nothing is shared with other users. |
| | Social Media / Messaging and Chat | No (the chat is with the AI, not between people) |
| | Advertising | No |
| Mature Themes | Profanity or Crude Humor; Horror/Fear | None |
| | Alcohol, Tobacco, or Drug Use or References | **Infrequent** (beer, wine and spirits are in the food list for logging) |
| Medical or Wellness | Medical or Treatment Information | **Infrequent** (medicine reminders and prescription transcription; no medical guidance) |
| | Health or Wellness Topics | **Yes** (calorie tracking, diet, steps) |
| Sexuality or Nudity / Violence | all | None |
| Chance-Based Activities | Gambling, Simulated Gambling, Contests, Loot Boxes | None / No |
| Age Categories and Override | **Override to Higher Age Rating → 18+** | The Terms require 18+ and the app refuses a new age under 18 (D1); Apple says a EULA's higher minimum age must be followed. Not "Made for Kids". |

### 2.3 Export compliance

`ITSAppUsesNonExemptEncryption = false` is in the build (`ios.config.usesNonExemptEncryption: false`), so App Store
Connect won't ask per build. If asked: the app uses only the encryption built into iOS (HTTPS through URLSession,
Keychain) → "None of the algorithms mentioned above" / exempt. No French declaration and no CCATS.

### 2.4 Content rights

"Does your app contain, show, or access third-party content?" → **Yes, and I have the necessary rights.** It shows
AI output the team licenses from OpenAI, the member's own Apple Health data, and open-licensed fonts and icons
(Playfair Display, Figtree and JetBrains Mono under the SIL Open Font License; the Feather and Material Design
Icons sets). No third-party media.

### 2.5 Category

**Primary: Health & Fitness.** Secondary: **Food & Drink** (decided, D6).
Apple defines Health & Fitness as "healthy living… weight loss…". ÖRZA's core is food logging, calorie targets,
weight goals and steps, which is where members look and where similar apps sit. **Medical** ("medical education,
information management, or health reference… medical record-keeping") would invite closer 1.4.1 review, and it
adds weight to the 5.1.1(ix) question for an individual account. The medicine reminders don't need it. Food & Drink
fits the recipes and the meal scanner.

### 2.6 Regulated Medical Device (App Information › App Store Regulations & Permits)

This is asked because the category is Health & Fitness, in each of the **US, UK and EU/EEA** where the app is
offered. ÖRZA launches in **India only** (D6), so nothing appears now. When the US, UK or EU are added later, answer
**No** for each: ÖRZA is a wellness app, not a regulated medical device.

### 2.7 App Review Information

- **Sign-in required:** Yes. User name `[DEMO_EMAIL]`, password `[DEMO_PASSWORD]` (the user creates it in
  production, §3 step 2).
- **Contact:** first and last name, phone and email of the person Apple can reach (the user).
- **Notes (≤ 4,000 characters; this text is about 3,500):**

```
ÖRZA is a wellness app for India: log meals by photo, text or voice, chat with the Ask ÖRZA coach, get recipes and a "rebalance" plan after a big meal, track goals, water, weight and steps, and set medicine reminders with photos. It gives wellness guidance only. It does not diagnose, prescribe or change a dose, and it is not a medical device.

SIGN-IN
Demo account (onboarding done, sample meals, one "as needed" medicine, AI credits):
Email: [DEMO_EMAIL]
Password: [DEMO_PASSWORD]
An account is needed because the same data is used on the ÖRZA website. Delete the account in the app: More > Settings > Privacy & data > Delete account (type DELETE). This deletes the account and all its data on our server.

AI (OPENAI) AND CONSENT
The first AI feature you use shows "Allow ÖRZA's AI features?". It names OpenAI and lists what is sent. Nothing goes to OpenAI before you tap Allow, and "Not now" keeps the rest of the app working. Change it any time: More > Settings > Privacy & data > AI features.
AI features: Snap tab (meal photo), Meals > Type or speak, More > Ask ÖRZA, More > Recipes, More > Rebalance, Medicines > Scan a prescription.
Report AI output: "Report" under every Ask ÖRZA reply (or long-press a reply), and on AI recipes, rebalance plans, the Snap result and AI-logged meals.

AI CREDITS: NO PURCHASES
AI features use free credits. Every account starts with 100. Members can ask the team for more (More > AI credits > Request more credits) and the team adds them free of charge. Credits are not sold in the app or anywhere else, and the app has no in-app purchases.

APPLE HEALTH (read only)
More > Health sync > Connect Apple Health reads steps, sleep, resting heart rate and weight. On Today, "Count my steps automatically" explains, then shows the Apple Health sheet. Only daily totals are saved to the account. ÖRZA writes nothing to Apple Health, never uses health data for ads, and never stores it in iCloud. Background delivery updates steps at most hourly.
Motion & Fitness: only when Apple Health has no steps, Today offers "Use iPhone motion instead".
Without these permissions, use "Log steps" on Today.

NOTIFICATIONS (medicine alarms)
Add a medicine with dose times (Medicines > +). ÖRZA explains, then shows the iPhone prompt (also in More > Reminders > Alarms on this phone). Dose alarms are local time-sensitive notifications with the medicine's photo and Take / Snooze / Skip. To try one: More > Reminders > Alarms on this phone > Test alarm (rings in 10 seconds). Time Sensitive is used only for medicine doses and their snoozes. Other reminders are normal notifications. No marketing, no remote push.

OTHER PERMISSIONS (asked only when used)
Camera: Snap > Take photo, medicine photos, Scan a prescription. Photos: the system picker (no library access). Microphone and Speech Recognition: the mic in Meals and Ask ÖRZA. Calendar: More > Calendar > Add to my calendar (an "ÖRZA" calendar with dose times; the events say "Medicine time" and don't name the medicine, because the calendar can sync to iCloud).
Background mode "processing" re-plans the next 7 days of medicine alarms about hourly.

MEDICAL SAFETY
A scanned prescription is checked line by line before any alarm is made ("Check and create alarms"). ÖRZA copies what is written and never changes a dose. Screens say "Wellness guidance, not medical advice. For medical concerns, please consult your doctor."

Support: support@orza.app (in the app: More > Settings > Help > Contact support).
```

Before pasting, replace `[DEMO_EMAIL]` and `[DEMO_PASSWORD]` (the user's demo account, §3 step 2). Credits are free at
launch (D6); if they are ever sold, the iPhone sells them through IAP and the "free of charge" and "not sold anywhere"
sentences change. Optional attachment: a 30-second screen recording of the Test alarm on a locked iPhone. Reviewers
can't wait for a real dose time.

### 2.8 Build facts (for reference and future checks)

**Info.plist purpose strings** (resolved with `npx expo config --type introspect` at `2b1cf48`):

| Key | Text | Asked when |
|---|---|---|
| NSCameraUsageDescription | ÖRZA uses your camera so you can snap meals, medicines and prescriptions. | Take photo (Snap, medicine, Rx) |
| NSPhotoLibraryUsageDescription | ÖRZA lets you choose meal, medicine and prescription photos from your library. | Only on old iOS, if the system picker fails |
| NSMicrophoneUsageDescription | ÖRZA uses the microphone so you can log meals and ask questions by voice. | First tap on a mic |
| NSSpeechRecognitionUsageDescription | ÖRZA turns what you say into text so you can log meals and ask questions hands-free. | First tap on a mic |
| NSMotionUsageDescription | ÖRZA uses your iPhone's motion data to count your steps when Apple Health has none, and saves each day's total to your ÖRZA account. If you allow AI features, they also go with your Ask ÖRZA chats. | "Use iPhone motion instead" → Continue |
| NSHealthShareUsageDescription | ÖRZA reads your steps, sleep, resting heart rate and weight from Apple Health to fill in Today and your Health trends. Only daily totals are saved to your ÖRZA account. If you allow AI features, steps and weight also go with your Ask ÖRZA chats. | Connect Apple Health / steps sheet → Continue |
| NSHealthUpdateUsageDescription | ÖRZA doesn't save anything to Apple Health. If that ever changes, it will ask you first. | Never (ITMS-90683 requires the key) |
| NSCalendarsFullAccessUsageDescription / NSCalendarsUsageDescription | **New:** ÖRZA adds your medicine times and the reminders you choose to an ÖRZA calendar on your iPhone, each with an alert. It only reads and changes the events it added. | Calendar › Add to my calendar |
| NSCalendarsWriteOnlyAccessUsageDescription | ÖRZA adds your medicine and wellness reminders to your calendar. | Never (the app asks for full access) |
| NSRemindersUsageDescription / NSRemindersFullAccessUsageDescription | **New:** ÖRZA doesn't use the Reminders app. If that ever changes, it will ask you first. | Never (EventKit references reminders) |
| NSFaceIDUsageDescription | none (secure-store never uses biometrics) | n/a |

**Entitlements:** `com.apple.developer.healthkit`, `com.apple.developer.healthkit.background-delivery` (no
`healthkit.access`, so no clinical records), `com.apple.developer.usernotifications.time-sensitive`, and
`aps-environment` (added by expo-notifications; no remote push is sent). **Background modes:** `processing` only
(after this step's plugin). **BGTask id:** `com.expo.modules.backgroundtask.processing`.

**Privacy manifest.** `app.json` declares UserDefaults `CA92.1`. At `pod install`, React Native combines every pod's
`PrivacyInfo.xcprivacy` (Expo's Podfile: `privacy_file_aggregation_enabled` unless
`apple.privacyManifestAggregationEnabled` is `false`) and its own core reasons into the app's manifest. The
expected result:

| Category | Reasons | From |
|---|---|---|
| UserDefaults | CA92.1 (data only this app reads) | app.json; RN core; expo-constants, -localization, -notifications, -system-ui, -task-manager. Also used, without a manifest of their own, by @kingstinct/react-native-healthkit + @react-native-healthkit/core (background-delivery settings) and expo-sharing (app-group key, unused here); all inside this category and reason. |
| FileTimestamp | C617.1 (files in the app's container), 0A2A.1 (SDK wrapper used by the app), 3B52.1 (files the user picked) | RN core, Folly, glog, boost, expo-application; expo-file-system |
| SystemBootTime | 35F9.1 (time between events in the app) | RN core / timing, boost, expo-device |
| DiskSpace | E174.1 (check space before writing), 85F4.1 (show space to the user) | expo-file-system |
| ActiveKeyboards | none | No SDK uses it |
| Tracking | `NSPrivacyTracking` false, no tracking domains | n/a |

Checked: every iOS native dependency's sources (Swift / ObjC / C++) were searched for UserDefaults, file timestamps
(`stat`, `getattrlist`, creation / modification dates), `systemUptime` / `mach_absolute_time`, disk space
(`statfs`, `volumeAvailableCapacity`, `NSFileSystemFreeSize`) and `activeInputModes`. Only the SDKs above use them.
expo-calendar's `creationDate` is an EventKit event property, not a file timestamp. SDWebImage (expo-image) and
hermes are on Apple's list of SDKs that need a signed manifest of their own; build 2 passed processing with no
ITMS-91061, so theirs were found. If Apple ever emails ITMS-91053 for a category, add that category and reason to `ios.privacyManifests` in
`app.json`; Expo's guide suggests this for static pods.

---

## 3. What the user does in App Store Connect (step by step)

Do the shared pre-launch checklist first (`listing.md` §0: the web push, build 3, the demo account).

1. **Account: the individual one** (D6, "Kunal Patil (Individual)"). The 5.1.1(ix) risk is accepted. If Apple rejects
   for it, enroll an Organization in the Apple Developer Program (needs a D-U-N-S number for the legal entity) and
   transfer app 6833346228 to it (App Store Connect › App Information › Transfer App; the app must have had one
   approved version), or create the app there.
2. **Make the demo account** on the live site or phone (production). Use a new email such as `appreview@<your domain>`
   with a strong password. Finish onboarding. Log 3–4 meals over 2–3 days and 2 weights. Add **one "as needed"
   medicine with a photo**, so adding a timed medicine shows the notification sheet. Leave AI consent **not given**
   (the reviewer should see the consent sheet). Give it **500 credits** from the admin console with a neutral reason
   such as "Review account"; never "purchase" or "paid". Check that `ai_enabled` is true in production. Keep the
   password only in App Store Connect.
3. **Support contact:** `support@orza.app` (it receives mail, D6). In App Store Connect › version ›
   **Support URL** use a page that shows the contact: `https://orza-nine.vercel.app/faq` (it has a mailto link to the
   support address; the same URL as `listing.md` §2), or `/privacy#contact`, or a `/contact` page when the web adds
   one. Marketing URL is optional (`https://orza-nine.vercel.app`).
4. **App Information:** Name "ÖRZA" (subtitle from `docs/store/listing.md`); Category Health & Fitness + Food & Drink
   (§2.5); Content Rights (§2.4); Age Rating questionnaire + Override 18+ (§2.2); App Store Regulations & Permits ›
   Declare Regulated Medical Device (nothing to answer while only India is offered; §2.6); Privacy Policy URL (§2.1).
5. **Pricing and Availability:** Free. Countries: **India only** (D6). **EU Digital Services Act trader status**
   (Apple's help page checked 2026-11-13): the account must have a trader status in App Store Connect (Business) even
   when nothing is offered in the EU. Declare **not a trader** (distributing only outside the EU). Don't tick any EU
   country until the trader details are decided: a trader's app has its address (an individual enters an "Address or
   P.O. Box"), phone and email verified and **published** on the EU product pages, and an app without trader status
   is removed from the EU store. Check what the account already declares.
6. **App Privacy:** Get Started › "Yes, we collect data" › tick the types in §2.1 › for each: purposes as listed,
   linked to the user **Yes**, tracking **No** › Publish.
7. **Version 1.0.0:** screenshots (two iPhone sets, Dynamic Island medium and large, `docs/store/listing.md` §4.2),
   promotional text, description (must name **Apple Health**; no prices, Premium, waitlist or website plans),
   keywords, support URL, copyright ("2026 Kunal Patil", the individual account's name).
8. **Build:** after build 3 from `main` (the D3 fixes and decisions) finishes processing in TestFlight and passes the
   user's quick check (alarm sheet "Continue", Settings › Help, Health screen without the website link, Privacy policy
   from Settings opens without the website menu, Preferences › "Help improve ÖRZA's AI" off, Calendar › Sync now
   writes "Medicine time" events), select it under Build. Export compliance is answered by the build.
9. **App Review Information:** sign-in required → demo email and password (step 2); contact; paste the notes from
   §2.7 with the placeholders filled; optionally attach the Test-alarm screen recording.
10. **Release:** "Manually release this version". Then **Add for Review** → **Submit**. Answer reviewer messages in
    App Store Connect › App Review; a rejection can be replied to or appealed there.

---

## 4. New copy

### 4.1 D3 audit fixes (approved by the user, 2026-11-13)

| Where | Text |
|---|---|
| Medicine alarm sheet, iPhone, before the prompt | Button "Continue" (VoiceOver hint "Shows the iPhone's notification prompt"); "Not now" and the close button removed there |
| Alarms on this phone (card) | "Turn on notifications" (short "Turn on"); compact card "Turn on" (were "Allow notifications" / "Allow") |
| Calendar purpose string | "ÖRZA adds your medicine times and the reminders you choose to an ÖRZA calendar on your iPhone, each with an alert. It only reads and changes the events it added." |
| Reminders purpose string | "ÖRZA doesn't use the Reminders app. If that ever changes, it will ask you first." |
| Settings, new group | "Help": "Contact support" (subtitle: the support address; hint "Opens your mail app"), "Terms of service" |
| Contact support without a mail app | Toast "Email us at support@orza.app" |
| Sign in | "Forgot your password? Email support@orza.app and we'll help you reset it." (the address is a link) |
| AI credits hero pill | "AI credits · Free" (was "· Free plan") |
| AI credits hero, low / empty | "…You're running low — request more below." / "You've used all your AI credits. Manual logging keeps working for free — request more below." |
| Request more credits sheet | "Need more credits? Tell us a little about how you use ÖRZA and we'll add more to your account." |
| More › AI credits row; account card | "Balance, history and requests"; "Running low — request more" |
| Health sync, iPhone without Apple Health | "You can still log your steps and weight in ÖRZA yourself." (the website importers are no longer offered on iPhone) |
| Preferences › Help improve ÖRZA's AI (iPhone) | "…Steps and anything read from Apple Health or your iPhone's motion sensor are never used for this…" (Android unchanged) |
| Scan a prescription, subtitle | "Take a photo of your doctor's prescription. ÖRZA reads the medicines — brand names, 1-0-1, BD, TDS, SOS, after food, x 5 days — and you check each one before any alarm is set." |
| Health screen footer | The existing app-wide line, reused: "Wellness guidance, not medical advice. For medical concerns, please consult your doctor." |

### 4.2 From the D3 decisions (2026-11-13; for the user's review)

| Where | Text |
|---|---|
| Settings › Preferences › Help improve ÖRZA's AI, iPhone (D2) | "Lets your conversations and logs, anonymized first, help make ÖRZA’s AI better. It’s off unless you turn it on. Steps and anything read from Apple Health or your iPhone’s motion sensor are never used for this. AI features work the same whether it’s on or off." |
| The same, Android (D2) | "Lets your conversations and logs, anonymized first, help make ÖRZA’s AI better. It’s off unless you turn it on. Steps and anything read from Apple Health, Health Connect or your phone’s motion sensor are never used for this. AI features work the same whether it’s on or off." |
| iPhone calendar, every medicine dose event (D4) | Title "💊 Medicine time · ÖRZA"; note "Open ÖRZA to see which medicine it is and mark the dose." (after "Marked as taken in ÖRZA." / "Marked as skipped in ÖRZA." when it applies, before the website link) |
| Calendar › "Add ÖRZA to my phone calendar" card, iPhone, after its first sentences (D4) | "Medicine events say “Medicine time” without the medicine’s name, because your calendar can sync to iCloud. Open ÖRZA to see which medicine it is." |
| Goals › goal planner, an age outside the range (D1) | "ÖRZA goal planning is for ages 18–100." (was 13–100) |
| Settings › Profile › Age, outside the range (D1) | "Age must be between 18 and 100" (was 13) |

Onboarding's age question and its "under 18" line come from the server (web `d3-web`), not from the app.

---

## 5. Open questions for the user

1. **Backups.** Medicine names, dose times and photos cached for offline alarms sit in the app's Documents folder,
   so an iPhone's iCloud backup includes them. It isn't HealthKit data, so no rule is broken. Exclude them from
   backup later (small native change)?
2. **Copy.** Please approve the new strings in §4.2.

The questions answered on 2026-11-13 (account, support email, demo account, free credits, website menu, AI
improvement, minimum age, privacy-policy sentences, countries, category, copy, iPhone calendar) are applied in §0–§4.

---

## Sources (checked 2026-11-13)

- App Review Guidelines (last updated 16 October 2026): 1.2, 1.4.1, 1.4.2, 1.5, 2.1, 2.3, 2.5.1, 2.5.2, 2.5.4,
  2.5.14, 3.1.1, 3.1.1(a), 3.1.3(b), 4.2, 4.5.4, 4.8, 5.1.1(i)–(ix), 5.1.2(i)/(vi), 5.1.3:
  https://developer.apple.com/app-store/review/guidelines/
- Human Interface Guidelines, Privacy (pre-alert screens: "Include only one button… Use a term like Continue or
  Next… don't provide a way for people to leave the screen… without viewing the system alert"):
  https://developer.apple.com/design/human-interface-guidelines/privacy
- Human Interface Guidelines, HealthKit (Apple Health icon, "Don't use the term HealthKit", privacy):
  https://developer.apple.com/design/human-interface-guidelines/healthkit
- App privacy details (definitions of collect, data types, purposes, tracking):
  https://developer.apple.com/app-store/app-privacy-details/
- Age ratings values and definitions; Set an app age rating (override for a EULA minimum age):
  https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/ ·
  https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/
- EU Digital Services Act trader requirements (review, checked 2026-11-13):
  https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/
  · https://developer.apple.com/news/?id=einwn76m
- Screenshot specifications (review, checked 2026-11-13; required iPhone set = Dynamic Island, medium):
  https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
- Declare regulated medical device status:
  https://developer.apple.com/help/app-store-connect/manage-app-information/declare-regulated-medical-device-status/
- App Store categories: https://developer.apple.com/app-store/categories/
- Required reason API and reason codes:
  https://developer.apple.com/documentation/bundleresources/describing-use-of-required-reason-api ·
  https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacyaccessedapitypes/nsprivacyaccessedapitypereasons
- Expo, Privacy manifests (static pods may need reasons in `ios.privacyManifests`):
  https://docs.expo.dev/guides/apple-privacy/
- Code read for this audit: `app.json`, `plugins/`, `src/app/**`, `src/features/{alarms,ai,credits,health,more,rx,settings,today}`,
  `src/lib/{alarms,health,steps,image,voice,device,config}`, the native SDK sources and manifests under `node_modules`,
  the Expo prebuild template and React Native's `privacy_manifest_utils.rb`; the web's privacy and terms pages,
  `src/lib/ai.ts`, `src/app/api/account/route.ts` and `src/lib/onboarding.ts` in `E:\aylo\orza-backend` (read-only).
