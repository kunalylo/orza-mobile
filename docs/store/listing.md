# Store listing — App Store and Google Play (ÖRZA)

Written 2026-11-13 (D3). **The user reviews every text here before it is pasted.** Character counts were made with a
script, counting Unicode characters (Ö is 1).

**Review fixes (2026-11-13), in both descriptions:** the prescription line now says you check each medicine before
any reminder or alarm is set (it said ÖRZA "sets the reminders for you to check"; `2b1cf48` fixed the same claim in
the app); the daily targets come from your body, activity level and goal (web `domain/targets.ts`; diet
and allergies don't change them); the reminder kinds are meals, water, weigh-ins and your own (there is no walk
reminder). §4.2: Apple requires the Dynamic Island **medium** screenshot set as well as the large one.

**Rules followed**
- Everything said here is something the app does today.
- No medical claims ("lose weight", "improve your health", "never miss a dose"), no "best" / "#1" / "free forever",
  no prices.
- No emoji and no capitals for emphasis (Play's metadata rules).
- The iPhone texts don't mention Android, and the Play texts don't mention iPhone (App Store 2.3.10).
- The iPhone description names Apple Health; the Android one names Health Connect (App Store 2.5.1, Play health
  declaration).
- Both full descriptions carry Play's required sentence, word for word: "not a medical device and does not
  diagnose, treat, cure, or prevent any medical condition", plus the reminder to consult a healthcare professional.

Where the features come from: Today, Meals, Snap, Medicines and More (`src/features/more/menu.ts`), `ask.tsx`,
`recipes.tsx`, `rebalance.tsx`, `goals.tsx`, `reports.tsx`, `health.tsx`, `reminders.tsx`, `calendar.tsx`,
`credits.tsx`, `rx/*`, the alarm screen and Settings; voice in `en-IN` / `hi-IN`; coach replies in English, Hindi or
Hinglish (web `lib/coach.ts`); about 350 foods in the food list (web `lib/nutrition/foods.ts`); free credits at
sign-up (web `INITIAL_CREDITS`; the number isn't stated, so it can change).

---

## 1. Names (both stores)

| Field | Text | Chars | Limit |
|---|---|---|---|
| App Store name | `ÖRZA: Meals, Meds & AI Coach` | 28 | 30 |
| Google Play title | `ÖRZA: Meals, Meds & AI Coach` | 28 | 30 |
| Alternative (both) | `ÖRZA: Meal Log & Pill Alarms` | 28 | 30 |

- App Store Connect already has the name "ÖRZA". It can change until the first version is approved.
- Keep the same name on both stores.

## 2. App Store (iPhone)

| Field | Text | Chars | Limit |
|---|---|---|---|
| Subtitle | `Photo meal log, pill reminders` | 30 | 30 |
| Keywords | `calorie,counter,diet,nutrition,indian,food,tracker,medication,tablet,steps,weight,recipes,water` | 95 | 100 |

- Keywords: no spaces after the commas. They avoid the words already in the name and subtitle (meals, meds, coach,
  photo, log, pill, reminders), because Apple indexes those already. No competitor names.
- The iPhone texts say "reminders", not "alarms": on iPhone they are time-sensitive notifications with a sound, not
  full-screen alarms.

**Promotional text** (140 / 170; can be changed any time without review)
```
Log a meal with one photo, ask ÖRZA about food in English, Hindi or Hinglish, and get medicine reminders that show a photo of each medicine.
```

**Description** (count in §5; limit 4000)
```
ÖRZA is a wellness companion built around Indian food. Log meals in seconds, ask questions in your own words, and keep your medicines on time with reminders that show a photo of each one.

Snap, type or say what you ate
• Snap & Know: take a photo of your plate and ÖRZA estimates the dishes, portions, calories and macros. Check and edit before you log.
• Type or speak a meal in English or Hindi, like "2 roti, dal and a katori of rice".
• Or pick from hundreds of Indian dishes and everyday foods, in katori, plate, piece and cup portions.

Ask ÖRZA
• Chat about food, habits and your plan. ÖRZA knows your targets and what you've logged today, and replies in English, Hindi or Hinglish.
• See and edit what ÖRZA remembers about you.

Medicines, on time
• Add your medicines with photos, doses and times. Each reminder shows the medicine's photo, with Take, Snooze and Skip.
• Snap a prescription: ÖRZA reads the medicines and timings (1-0-1, BD, TDS, after food), and you check each one before any reminder is set. It never changes a dose.
• Keep track of stock, get a refill reminder, and see your last 7 days.

Plan and progress
• Daily calorie, protein, carb, fat, fibre and water targets worked out from your body, activity level and goal.
• Recipes made for your diet, region and calorie budget.
• Rebalance: after a festival meal or a party, a kind plan for the next few days. No guilt.
• Goals and your weight trend, daily and weekly reports, and a spreadsheet of your week you can share with your doctor.

Apple Health
• With your permission, ÖRZA reads your steps, sleep, resting heart rate and weight from Apple Health, or counts steps with your iPhone's motion sensor. Only daily totals are saved to your account. ÖRZA never writes to Apple Health.

Reminders and calendar
• Gentle reminders for meals, water and weigh-ins, or your own, with quiet hours.
• Add your medicine times to your iPhone's calendar.

Your data, your choice
• AI features are run by OpenAI and ask for your permission first. Everything else works without them.
• Report any AI answer from inside the app.
• Export your data or delete your account at any time in Settings.
• No ads. Your health data is never sold.

AI credits
New accounts get free AI credits for photo scans, AI meal logging, chat, recipes and plans. Need more? Ask from the Credits screen. There are no purchases in the app, and logging from the food list never uses credits.

Use the same account on the ÖRZA website.

Important
ÖRZA offers wellness guidance, not medical advice. It is not a medical device and does not diagnose, treat, cure, or prevent any medical condition. Calorie and nutrition values are estimates. Take medicines as your doctor prescribed, and talk to your doctor or another qualified healthcare professional for medical advice, diagnosis or treatment.

Privacy policy: https://orza-nine.vercel.app/privacy
Terms of service: https://orza-nine.vercel.app/terms
```

**Other App Store fields**
- Category: Health & Fitness (primary), Food & Drink (secondary).
- Support URL: `https://orza-nine.vercel.app/faq`, or a contact page.
- Marketing URL: `https://orza-nine.vercel.app`.
- Privacy policy URL: `https://orza-nine.vercel.app/privacy`.
- The age rating, review notes and privacy labels are in `docs/store/app-store.md` (App Store step).

## 3. Google Play (Android)

| Field | Text | Chars | Limit |
|---|---|---|---|
| Short description | `Snap or speak meals, chat with an AI coach and get medicine alarms with photos` | 78 | 80 |

**Full description** (count in §5; limit 4000)
```
ÖRZA is a wellness companion built around Indian food. Log meals in seconds, ask questions in your own words, and keep your medicines on time with alarms that show a photo of each one.

Snap, type or say what you ate
• Snap & Know: take a photo of your plate and ÖRZA estimates the dishes, portions, calories and macros. Check and edit before you log.
• Type or speak a meal in English or Hindi, like "2 roti, dal and a katori of rice".
• Or pick from hundreds of Indian dishes and everyday foods, in katori, plate, piece and cup portions.

Ask ÖRZA
• Chat about food, habits and your plan. ÖRZA knows your targets and what you've logged today, and replies in English, Hindi or Hinglish.
• See and edit what ÖRZA remembers about you.

Medicines, on time
• Add your medicines with photos, doses and times. At each dose time the alarm rings with the medicine's photo, with Take, Snooze and Skip, even when you're offline.
• When you allow it, the alarm fills the locked screen like an alarm clock.
• Snap a prescription: ÖRZA reads the medicines and timings (1-0-1, BD, TDS, after food), and you check each one before any alarm is set. It never changes a dose.
• Keep track of stock, get a refill reminder, and see your last 7 days.
• On phones that close apps to save battery, ÖRZA shows the settings that keep alarms working.

Plan and progress
• Daily calorie, protein, carb, fat, fibre and water targets worked out from your body, activity level and goal.
• Recipes made for your diet, region and calorie budget.
• Rebalance: after a festival meal or a party, a kind plan for the next few days. No guilt.
• Goals and your weight trend, daily and weekly reports, and a spreadsheet of your week you can share with your doctor.

Health Connect and steps
• With your permission, ÖRZA reads your daily steps from Health Connect, from this phone and any watch or fitness app that shares steps there, or counts them with your phone's motion sensor.
• Connect Health Connect to see your sleep, resting heart rate and weight next to what you eat.
• Only daily totals are saved to your account. ÖRZA never writes to Health Connect.

Reminders and calendar
• Gentle reminders for meals, water and weigh-ins, or your own, with quiet hours.
• Add your medicine times to your phone's calendar.

Your data, your choice
• AI features are run by OpenAI and ask for your permission first. Everything else works without them.
• Report any AI answer from inside the app.
• Export your data or delete your account at any time in Settings.
• No ads. Your health data is never sold.

AI credits
New accounts get free AI credits for photo scans, AI meal logging, chat, recipes and plans. Need more? Ask from the Credits screen. There are no purchases in the app, and logging from the food list never uses credits.

Use the same account on the ÖRZA website.

Important
ÖRZA offers wellness guidance, not medical advice. It is not a medical device and does not diagnose, treat, cure, or prevent any medical condition. Calorie and nutrition values are estimates. Take medicines as your doctor prescribed, and talk to your doctor or another qualified healthcare professional for medical advice, diagnosis or treatment.

Privacy policy: https://orza-nine.vercel.app/privacy
```

**Other Play fields:** category Health & Fitness; tags, contact details and privacy URL as in `google-play.md` §3.9
and §3.1.

---

## 4. Screenshots, icon and feature graphic

### 4.1 Rules for every screenshot
- **Data:** the demo account, with sample data only.
  - Sample first name: "Asha".
  - Everyday Indian meals.
  - Two or three common medicines, photographed as plain strips with no person.
  - A **made-up sample prescription**, marked "Sample", with an invented doctor and patient. Never a real one.
  - No real names, emails or phone numbers.
- **Phone:** Wi-Fi and full battery in the status bar, time 9:41, no notifications showing, light theme (the app's
  only theme).
- **Captions:** short, true and in the app's own words. No claims ("lose weight"), no awards or rankings, no prices.
- **Images:** iPhone shots on the App Store and Android shots on Play. No Android imagery on Apple, no iPhone imagery
  on Play.
- **The order** tells the story: food first, then the coach, then medicines, then progress.

### 4.2 Sizes

| Store | Required | Size to make | Notes |
|---|---|---|---|
| App Store, iPhone only (`supportsTablet: false`) | **Two sets**, 1–10 shots each (Apple's screenshot specifications, checked 2026-11-13): **iPhone with Dynamic Island, medium** is required for every iPhone app, and **Dynamic Island, large** (or Face ID, large) is required too | Medium: **1206 × 2622** (or 1179 × 2556). Large: **1320 × 2868** (or 1290 × 2796) | PNG or JPEG, no transparency. Make both sets from the same captures and frames. A shot taken on an iPhone 15, 15 Pro or 16 (1179 × 2556) or a 16 Pro (1206 × 2622) fits the medium slot as it is. One from a 15/16 Plus or 15 Pro Max (1290 × 2796) fits the large slot. The other set is the same framed screen at the other size. |
| Google Play, phone | At least 2, up to 8; **4 or more at ≥ 1080 px** to be eligible for promotion | **1080 × 1920** portrait (9:16) | PNG (no alpha) or JPEG. The long side may be at most twice the short side. Raw shots from modern phones (about 9:20, e.g. 1080 × 2400) break that rule, so place each shot in a 1080 × 1920 frame with its caption. |
| Google Play, app icon | Required | **512 × 512**, 32-bit PNG, ≤ 1 MB | Scale down `assets/images/icon.png` (1024²). A full square; Play rounds the corners itself. |
| Google Play, feature graphic | Required | **1024 × 500**, JPEG or 24-bit PNG, no alpha | §4.4 |

### 4.3 Which screens, in order

| # | Screen (how to reach it) | Caption | App Store | Play |
|---|---|---|---|---|
| 1 | **Today**, mid-day: energy card, a few meals, water, steps, the medicines card | "Your day at a glance" | ✓ | ✓ |
| 2 | **Snap & Know result**: a thali photo, the dish list with calories, the Log button | "Snap your plate. Know your meal." | ✓ | ✓ |
| 3 | **Meals › Type or speak**: the composer with "2 roti, dal and a katori of rice" and the mic | "Type or say what you ate" | ✓ | ✓ |
| 4 | **Ask ÖRZA**: one question and a short, practical reply | "Ask in English, Hindi or Hinglish" | ✓ | ✓ |
| 5 | **Medicines**: today's timeline with medicine photos and one dose marked taken | "Every medicine, with its photo" | ✓ | ✓ |
| 6 | **The alarm screen** (Test alarm): photo, name, dose, Take / Snooze / Skip. On Android, the full-screen alarm over the lock screen. | iPhone: "Take, snooze or skip" · Android: "Alarms that show the medicine" | ✓ | ✓ |
| 7 | **Prescription review** after a scan of the sample prescription: medicines, times, "never changes a dose" | "Snap a prescription, check the times" | ✓ | ✓ |
| 8 | **Health sync / Today steps card** | iPhone: "Steps from Apple Health" · Android: "Steps from Health Connect" | ✓ | ✓ |
| 9 | **Recipes**: one recipe card for a vegetarian diet | "Recipes for your diet and budget" | ✓ | — |
| 10 | **Reports**: the weekly view | "See your week" | ✓ | — |

The App Store gets all 10; Play gets 1–8 (its limit). The iPhone's first three are what most people see in search,
so keep 1–3 as they are.

**Frame:** cream canvas `#FBF7F1`, caption at the top in Playfair Display (dark ink), the screenshot below with
rounded corners. No device frame is needed, and none from the other platform.

### 4.4 Feature graphic brief (Play, 1024 × 500)
- **Look:** the app's dark hero, `#07090C` background, with the glowing orb (`#FFB454 → #FF7A6A → #FF5FA2`) right of
  centre.
- **Text:** the "ÖRZA" wordmark in Playfair Display, left of centre. Under it, in Figtree: "Meals, medicines and a
  coach that knows Indian food". No other text.
- **Keep clear:** important things stay inside the middle 80%, because Play may crop the edges or put a play button
  on top.
- **Not allowed:** no phone frame, no screenshots, no "best" / "#1" / "free", no prices, no badges.
- **Format:** export as 24-bit PNG or JPEG without transparency.
- **Option:** a variant with one screenshot (Today), only if it stays readable at small sizes. Plain is safer.

### 4.5 Who makes them
- The user takes the iPhone screenshots on the TestFlight build, with the demo account.
- Android screenshots: on the vivo, or on the emulator (1080 × 2400, framed to 1080 × 1920), when Android testing
  resumes.
- The frames and the feature graphic can be made from these captures; that is a separate step.

---

## 5. Character counts (script, 2026-11-13)

See the table in §1–§3. The full descriptions:

| Text | Chars | Limit |
|---|---|---|
| App Store description | 2940 | 4000 |
| Google Play full description | 3246 | 4000 |
