# V2 fixes — from the vivo V2544 runs 3–4

Date: 2026-11-12. Evidence: `docs/notes/steps-v2-V1.md`, "V2 real phone (vivo V2544, Android 16)", runs 3–4 (bugs B1, B2;
findings F1–F3; the 10:39 FORCE STOP). Plan: `docs/notes/steps-v2.md` (§2.9, §6 and §10 V2 updated).
Code and Node tests only: nothing was built, installed or run on a phone or an emulator, no server, no AI calls.
**Native change:** `modules/orza-alarms` (Kotlin, one new function), so the next phone test build must be a full
rebuild (not a JS-only update). An older build without it still works: the button falls back to App info.

## What changed, and why

**B1 (medium) — Health sync's Connect never asked for Health Connect's background reading.**
- Why: `bridge.android.ts` `requestAccess()` asked for the four types only. A member who turned Health Connect on from
  Health sync got no "Access data in the background?" screen (run 3, 4e: `READ_HEALTH_DATA_IN_BACKGROUND
  granted=false`), and Today never asks once it counts. The hourly run then can't read Health Connect while ÖRZA is
  closed (`storeUnread`): steps reach the account only when ÖRZA is opened.
- Fix 1, new connections: the Connect asks for the four types plus `BackgroundAccessPermission` when
  `healthFeatures().backgroundRead === 'available'`, like Today's ask. The asks are pure in `src/lib/health/hcPermissions.ts`
  (`connectAsk`, `stepsAsk`, `stepsGrantOf`, `grantedMetrics`).
- Fix 2, existing installs: the steps access now carries `storeBackground` (`granted` / `not_granted` / `unavailable`,
  `androidSources.storeBackgroundOf`). When Health Connect counts for the member without it, the Health screen's
  "Count steps automatically" card shows "Steps are saved only while ÖRZA is open." and "Allow background access".
  That runs `useTodaySteps().requestBackground()`, the same steps ask; Steps is already granted, so Health Connect
  shows only its background screen. After a refusal on this visit, the line names the Health Connect path and the
  button becomes "Open Health Connect" ↗, because Health Connect may not show the screen again after two refusals.
  The decision is pure: `switchCard.switchView(...).background`.

**B2 (low) — the motion button after Physical activity was refused for good.**
- Why: the refused-Health-Connect card's "Use this phone's motion sensor instead" opened App info (run 3, 4b), with no
  caption.
- Fix: `todayCard.motionButtonCopy`. When the action opens Settings: "Allow Physical activity" ↗ (iPhone: "Allow Motion &
  Fitness"), short label "Allow activity" / "Allow Motion" (review: was "Open Settings", see below), and a caption with
  the Settings path. It is used on Today and on the Health / Settings switch.

**F1 — Health Connect counts this phone only while an app holds `READ_STEPS`.** Added to steps-v2.md §2.9 Known limits.
A re-grant on a later day misses the steps from before the re-grant: an undercount, never a double count. No code change.

**F2 — the Health card's lines.**
- With the phone's own counter ON and Health Connect not ON (Android 14+ after a Health Connect refusal, and 9–13), the
  "both ways" line said ÖRZA reads Samsung Health / Fitbit through Health Connect. It now reads "ÖRZA counts this
  phone's steps itself and doesn't share them with other health apps." (`switchCard.bothWaysLine`).
- "See today's steps" opens ÖRZA's own Today, so its ↗ is gone.

**F3 — the "Counting since…" line after a member switch.**
- Why: on a partial Health Connect day, the line "…Health Connect starts counting this phone's steps when you turn this
  on." showed whatever the cause.
- Fix: `todayCard.partialDayLine` keeps that line only when the coverage starts at ÖRZA's first grant
  (`coverFrom === hcGrantAt`, S-H2). Health Connect from any other instant (the M9 floor after a member switch, a
  later grant) gets "Counting since {time} — steps before then aren't included." The START line and the phone line are
  unchanged. `StepsCard` reads `hcGrantAt` from the steps prefs.

**OEM — "Keep medicine alarms working".**
- Why: vivo force-stopped ÖRZA at 10:39 (run 4 `exit-info`: `USER REQUESTED / FORCE STOP`). A force-stopped app loses its
  alarms and its background job. It gets no boot broadcast either, until the member opens it again. No code can undo
  that. Only the member's settings can stop it.
- What the member sees: a one-time sheet, `KeepAlarmsSheet`, mounted in the member layout. It shows on Android phones from
  vivo / iQOO, Xiaomi / Redmi / POCO, OPPO / realme / OnePlus, Huawei / Honor and Samsung (Build.BRAND, else
  MANUFACTURER, from expo-device). It comes right after the alarm engine first has a medicine alarm set with
  notifications allowed, and never over "Let your medicine alarms ring" or an alarm screen. If that sheet comes up
  meanwhile, it takes this sheet's place and this one is offered again later. The sheet counts as seen once the member
  closes it. Samsung gets it only while ÖRZA's battery isn't "Unrestricted".
- Content: plain steps for the maker, and "Open settings" ↗.
- The button tries the maker's own screens first (Xiaomi autostart / battery saver; ColorOS / OnePlus auto launch;
  Huawei / Honor app launch), then ÖRZA's App info, then Android's battery-optimisation list.
- Exception: vivo / iQOO and Samsung go to App info first. On the V2544 the decisive setting is App info › Battery usage
  › Background power control (run 3), and Samsung's "Unrestricted" is in App info.
- `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is never used.
- The way back: a tip row on Reminders & alarms › "Alarms on this phone", "Keep alarms working on this {maker} phone" +
  "Show me how".
- Code: pure `src/lib/alarms/oem.ts` (tested), `src/features/alarms/keepAlive.ts` (state + the per-install
  `orza-alarm-keepalive.json`), and native `openKeepAliveSettings(targetsJson)` in `OrzaAlarmsModule.kt`. That function
  tries each explicit component, then App info / the list, and skips any that throws (missing, or not exported).

**Re-plan on app start / boot when the plan is empty — checked; nothing added.**
- App start: `useAlarmSync` asks for a *forced* re-plan on every launch of the member area (`requestAlarmSync('start',
  {force: true})`). This uses fresh data, or the cached medicines when offline, and its `scheduleAll` also re-sets
  undelivered alarms up to 3 h late.
- A headless start (the hourly job) re-plans every run too: a new process has no `lastScheduled`.
- After a force stop, WorkManager reschedules its work at the next app start (seen in run 4).
- Boot: `BootReceiver` re-arms the stored plan. WorkManager restores the hourly job, which re-plans from the server.
- Remaining gap, not fixable in code: a plan only runs dry when no ÖRZA code runs for its whole horizon (7 days). That
  happens when ÖRZA is force-stopped, or the maker's battery manager blocks its job. Nothing native can plan without
  JS, so the sheet above is the answer.

## New copy (the user approves it later)

Health screen › Count steps automatically (B1):
- "Steps are saved only while ÖRZA is open."
- "Allow background access" (hint: "Asks Health Connect to let ÖRZA read your steps while it's closed")
- "Steps are saved only while ÖRZA is open. To save them when it's closed, allow background access in Health Connect ›
  App permissions › ÖRZA."
- "Open Health Connect" (hint: "Opens Health Connect, where you can allow ÖRZA to read in the background")
- Toasts: "Done — your steps are saved even when ÖRZA is closed.", "No problem — your steps are saved whenever you open
  ÖRZA.", "That didn't open — please try again in a moment." (that one already exists)

Motion button, refused for good (B2):
- "Allow Physical activity" / "Allow Motion & Fitness" (short labels "Allow activity" / "Allow Motion")
- "To count with this phone, turn on Physical activity: Settings › Apps › ÖRZA › Permissions › Physical activity › Allow."
- "To count with your iPhone, turn on Motion & Fitness: Settings › ÖRZA › Motion & Fitness."

Health card (F2):
- "ÖRZA counts this phone's steps itself and doesn't share them with other health apps."

Today (F3):
- "Counting since {time} — steps before then aren't included."

Keep medicine alarms working (OEM):
- Eyebrow "Medicine alarms", title "Keep medicine alarms working"
- Intro: "{Maker} phones can close ÖRZA to save battery. Its medicine alarms then can't ring until you open ÖRZA again.
  Change this once:"
- vivo / iQOO:
  1. "Battery: choose "Allow background power usage" in Settings › Apps › ÖRZA › Battery usage › Background power
     control."
  2. "Autostart: turn it on for ÖRZA in Settings › Apps › Autostart, if your phone has it."
- Xiaomi / Redmi / POCO:
  1. "Autostart: turn it on in Settings › Apps › Manage apps › ÖRZA › Autostart."
  2. "Battery saver: choose "No restrictions" in Settings › Apps › Manage apps › ÖRZA › Battery saver."
- OPPO / realme / OnePlus:
  1. "Battery: turn on "Allow background activity" in Settings › Apps › ÖRZA › Battery usage."
  2. "Auto launch: turn on "Allow auto launch" on the same page, or in Settings › Apps › Auto launch."
- Huawei / Honor:
  1. "App launch: in Settings › Battery › App launch, turn off "Manage automatically" for ÖRZA and keep Auto-launch,
     Secondary launch and Run in background on."
- Samsung:
  1. "Battery: choose "Unrestricted" in Settings › Apps › ÖRZA › Battery."
  2. "Sleeping apps: make sure ÖRZA isn't listed in Settings › Battery › Background usage limits."
- "You can find this again in Reminders & alarms › Alarms on this phone." (only when it showed by itself)
- Buttons "Open settings" (hint "Opens your phone's settings for ÖRZA"), "Done"
- Toast: "That didn't open — please open Settings › Apps › ÖRZA yourself."
- Alarms on this phone row: "Keep alarms working on this {Maker} phone" / "{Maker} phones can close ÖRZA to save
  battery, and then alarms can't ring until you open it." / "Show me how"

## Checks

`npm run typecheck`, `npx expo lint` clean.

| Suite | Result |
|---|---|
| `test:steps` | 434 (was 419; 435 after the review). Added: the asks and `storeBackgroundOf`; the background offer; the F2 line; `motionButtonCopy`; `partialDayLine`. |
| `test:alarms` | 79 (was 69; new `alarm-oem.test.ts`; 80 after the review) |
| `test:ai` | 32 |
| `test:a11y` | 6 |
| `test:report` | 20 |

## Device checks (next test build, vivo V2544)

1. **B1 new:** sign in a member without Health Connect. Health sync › Connect → Health Connect's sheet → Steps on → Allow.
   Then **"Allow ÖRZA to access data in the background?"** must follow. `dumpsys package in.co.ylo.orza`:
   `READ_HEALTH_DATA_IN_BACKGROUND granted=true`.
2. **B1 recovery:** revoke only the background permission (`pm revoke in.co.ylo.orza
   android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND`, then `am force-stop` with no medicines). Open Health sync:
   the card shows "Steps are saved only while ÖRZA is open." + "Allow background access".
   - Tap it: only the background screen shows. Allow → the line goes and `granted=true`.
   - Again with Don't allow → the toast, then the Health Connect path + "Open Health Connect" ↗ (opens Health Connect).
   - Back with it allowed → the line goes.
3. **B2:** with Health Connect refused and Physical activity refused for good: Today shows "Allow Physical activity" ↗,
   its caption with the Settings path, and opens App info. The Health card's switch does the same. At font 1.3 the
   label isn't cut.
4. **F2:** qa8 with the phone counting and Health Connect refused: the Health card says "ÖRZA counts this phone's steps
   itself and doesn't share them with other health apps."; "See today's steps" has no ↗.
5. **F3:** a member switch on a phone with Health Connect counting, no typed count, after a walk: "Counting since {sign-out
   time} — steps before then aren't included." The first grant's day keeps the Health Connect line.
6. **OEM sheet (vivo):** a member with no medicine adds one with an alarm time 10+ min ahead, then allows notifications.
   - The sheet "Keep medicine alarms working" (vivo steps) slides up after "Let your medicine alarms ring" closes.
     "Open settings" opens ÖRZA's App info (Battery usage is there), and the sheet is still open on return.
   - "Done", then reopen ÖRZA: it doesn't come back by itself.
   - Reminders & alarms › Alarms on this phone shows "Keep alarms working on this vivo phone" › "Show me how" → the same
     sheet, without the "find this again" line.
   - With the alarm prompt still open, the sheet waits (one sheet at a time).
7. **OEM button fallbacks** (any non-vivo phone, or with adb): `logcat -s OrzaAlarms` shows "Couldn't open <component>"
   for maker screens that aren't there, then App info opens. Never the "ignore battery optimisation" system dialog.
8. **The vivo setting itself (user):** App info › Battery usage › Background power control › "Allow background power
   usage". Then W3 / W4 of the walk plan: `exit-info` should show no `FORCE STOP`, and alarms still armed after the swipe.

## Review (2026-11-12, of `30ea9a6` + `529f82b`)

Adversarial read of the two commits; code and Node tests only, as above. Held up, no change:
- **B1, every Health Connect on path asks for background reading:** the Health screen's Connect (`connectAsk`) and
  Today's / the switch's ask (`stepsAsk`, also behind "Allow background access") add it where Health Connect offers it.
  Members who have it see no offer (`storeBackground: 'granted'`), and Health Connect shows nothing for a permission
  already granted. The offer needs Health Connect counting for the member (`sources` has `store`), Android only.
  `healthFeatures()` never throws, so the Connect fails no more often than before.
- **B2 / F2 / F3:** every state is in `steps-card` / `steps-switch` (the motion action is only a sheet or Settings;
  `bothWaysLine` by source; `partialDayLine` with the M9 floor before / after the grant).
- **OEM intents can't crash ÖRZA:** every start goes through `startSettings` (any exception, `ActivityNotFound` and
  `SecurityException` included, is logged and the next target is tried); bad JSON is an empty list; a lost React
  context rejects, and `openKeepAliveScreen` turns any rejection into "nothing opened" (the toast). Makers: Android
  only, the listed brands only (`makerOf`), never iOS (`keepAliveGuideHere`).
- **Re-plan on start / boot:** the native set is keyed by alarm (`scheduleAll` replaces it, cancels keys that left,
  one PendingIntent per key), so a forced re-plan can't double an alarm. The plan holds future instants only. A
  past, undelivered alarm is kept for ≤ 3 h, and the engine `dismiss`es those whose doses were handled before it
  schedules. The boot re-arm rings only what was missed by ≤ 30 min while the phone was off (unchanged design).

Fixed:
- **The sheet covered an alarm screen.** It is a Modal window, so an alarm that rang while it was open (e.g. "Test
  alarm" then "Show me how", or a dose while the member read it) opened under it, Take / Snooze hidden. It now steps
  aside when the alarm screen is in front (`usePathname() === '/alarm'`, also when the member opened it), and it is
  never offered while one is. Not marked seen: offered again after.
- **The makers' screens might not open on Android 11+.** They are explicit activities in other packages, and
  Android 11+ filters packages an app hasn't declared (package visibility), so they may not resolve and the button
  would fall to App info every time (not checked on a device). The seven packages are now in
  `modules/orza-alarms` `AndroidManifest.xml` `<queries>` (not `QUERY_ALL_PACKAGES`); `alarm-oem.test.ts` checks
  the list matches `oem.ts`. **Native (manifest) change: part of the full rebuild already needed.**
- **The B2 short label "Open Settings"** shared no word with "Allow Physical activity": at large text the button
  showed words that voice control can't match to its name. Now "Allow activity" / "Allow Motion" (words of the
  label, in order, as for the other short labels; a test checks every one).
- The sheet's step numbers stay inside their 28 dp circle at large text (`maxFontSizeMultiplier` 1.4; each step
  stays one TalkBack stop with its full text).

Not changed, for the user:
- Today's "Turn on" (Steps granted already, e.g. allowed in Health Connect's own settings) stays consent only, as
  its disclosure says (no "Next…" caption). Such a member gets the background offer on the Health screen only.
- Admin accounts (no automatic steps) are also asked for background reading by the Connect. Harmless.

New copy: "Allow activity", "Allow Motion" (short labels, replacing "Open Settings"). Checks after the review:
typecheck, lint clean; `test:steps` 435, `test:alarms` 80, `test:ai` 32, `test:a11y` 6, `test:report` 20.

Device checks added (next test build):
- With "Test alarm" set (rings in 10 s), open "Show me how": the alarm screen comes up with the sheet gone; after the
  alarm closes, an auto sheet that wasn't closed yet comes back, an opened one doesn't.
- On a Xiaomi / OPPO / Huawei phone (if one is at hand): "Open settings" opens the maker's own screen, not App info.
- Font 1.3 on a 360 dp phone: "Allow background access" on the Health card isn't cut (a `sm` button that sets its
  own width, so it has no short label).
