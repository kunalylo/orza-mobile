# D1 — care (Health sync, Calendar, Reminders — emulator E2E)

Emulator Medium_Phone (Android 16, 1080x2400), dev-client build 0b45fa1 + native alarm module (package in.co.ylo.orza),
Metro from the main repo, local server http://10.0.2.2:3100 (JSON DB `E:\aylo\orza-localtest\.data\orza-db.json`).
Safety gate (`node scripts/e2e/verify-local-bundle.mjs`) printed SAFE at start (2026-10-27).
System animation scales set to 0 (Reduce Motion path) so uiautomator reads every screen.
Screenshots `cNN` in the session scratchpad `e2e/` folder.

Feature code: `src/app/(app)/health.tsx`, `src/features/health/**`, `src/lib/health/**`; `src/app/(app)/calendar.tsx`,
`src/features/calendar/**`; `src/app/(app)/reminders.tsx`, `src/features/reminders/**`.

## Test cases

| # | Case | Result | Evidence / notes |
|---|------|--------|------------------|
| H1 | Health sync (More › Health sync, qa4 signed in, never connected): Connect state (orb, 7 metric tags, Connect button, "you choose…" note), Steps card, Trends empty state "Connect Health Connect above…" | PASS | c01 |
| H2 | Connect → Health Connect onboarding ("Get started with Health Connect") → Go back: toast "No permissions were allowed…", stays on Connect | PASS | c02/c03 |
| H3 | Connect → Get started → permission sheet "Allow ÖRZA to access your fitness and wellness data?" (8 types) → Don't allow: toast, still Connect | PASS | c05 |
| H4 | Second "Don't allow" → all 8 types USER_FIXED; the next Connect shows NO sheet, only the same toast again — no way forward in the app = bug B1 | FIXED | dumpsys package flags USER_FIXED; c07 after fix (hint + "Open Health Connect") |
| H5 | Fix path: hint → Open Health Connect → (HC home: the per-app intent can't resolve — native issue N1) → App permissions › ÖRZA → allow Steps + Sleep → back: the card connected by itself (no sheet), synced, toast "Connected — Health Connect has no data for the last 30 days yet", "Synced just now", info banner | PASS (after B1 fix) | c08, ui |
| H6 | Connected, empty data: Trends empty state said "Your first sync … is on its way — pull down to check again" while the card says "Synced just now · Health Connect has nothing" = bug B2 | FIXED | c10 |
| H7 | Sample data: no adb/Health Connect tooling to insert records on the emulator (no write permission declared, no toolbox app) → seeded 19 days through the LOCAL server's `/api/health/import` (source csv, script in scratchpad tools/health-seed.mjs). Tiles (Steps 5,777 yesterday, Sleep 6h 7m, Resting HR 59, Weight 72.3 Sat 24 Oct), "Synced … · CSV import" tag, Steps / Sleep / Resting HR / Weight charts with headlines, Sources card | PASS | c11, c13 |
| H8 | Trends period switch (30 / 90 days): the Segmented rendered as a blank ~100 px pill, both labels hidden = bug B3. After fix: "30 days / 90 days" readable; 90 days re-draws all four charts over 90 days | FIXED | c11 → c12 |
| H9 | Sync now (connected, empty): toast said "Connected — Health Connect has no data…" on a plain Sync now = polish P1 | FIXED | toast now "Health Connect still has no data for the last 30 days" |
| H10 | Access revoked while connected (`pm revoke` READ_STEPS/READ_SLEEP — app killed by the system) → reopen → Sync now: tag NEEDS ATTENTION, red banner "Health Connect access is turned off for ÖRZA. Reconnect…", Reconnect + Manage access | PASS | c15 |
| H11 | Reconnect while any requested type is USER_FIXED: Health Connect finishes its sheet at once (logcat `PermissionsActivity: App has at least one USER_FIXED permission, finishing!`) and Reconnect did nothing — no toast, no hint = bug B4. After fix: toast + "Health Connect isn't asking again…" hint + Open Health Connect; allowing Steps there and coming back re-synced by itself (ON, Synced just now) | FIXED | c16 → c17, ui |
| H12 | Manage access → Health Connect (home screen — see N1) → back returns to ÖRZA | PASS | dumpsys activity |
| H13 | Stop syncing → alert (Keep syncing / Stop syncing); Keep → still connected; Stop → Connect state, synced CSV data stays; Connect again (Steps still allowed) → connected at once without a sheet | PASS | ui |
| H14 | Offline (wifi + data off) → refresh: "Showing saved data. Can't reach ÖRZA right now…" + Retry, charts stay; network on → Retry → banner gone | PASS | c19 |
| C1 | Calendar (orza://calendar): month grid Oct 2026 (Mon-first, out-of-month days dimmed, today ringed), "74 doses · 0 reminders", legend, coloured dots, today's agenda (0/6 doses taken, photos, Upcoming) | PASS | c21 |
| C2 | Tap 20 Oct → "Past day · Tuesday, 20 October", 2/4 doses taken, meals + doses in time order; the selected day was drawn as a black SQUARE (no corner radius) = bug B5; "Today" chip appears | FIXED | c22/c23 → c24 (circle) |
| C3 | Previous / Next month buttons, swipe right/left on the grid (→ October selects today, → November keeps the day number), Today chip back to 27 Oct; November grid 6 rows, 106 doses | PASS | c24, ui |
| C4 | Phone calendar card: "Add to my calendar" → system dialog "Allow ÖRZA to access your calendar?" → Don't allow: "ÖRZA needs access to your calendar…"; again → Don't allow (USER_FIXED): the card switches to "Calendar access is off… Open Settings" but ALSO kept the red error "Calendar access is off… then try again" — the same message twice = polish bug B6 | FIXED (code; the blocked-with-error state can't be re-created on the emulator: expo reports canAskAgain=false once asked, even after `pm clear-permission-flags`) | c27, c28 |
| C5 | Open Settings → App info › Permissions › Calendar › Allow → back: the card re-reads permission on resume and shows "Add to my calendar"; Add → toast "Added ÖRZA to your calendar with 73 events.", card "ÖRZA is in your calendar · ON · 73 upcoming events · Synced just now". Phone: calendar `ÖRZA` (LOCAL account, name orza_reminders, Asia/Calcutta), 73 events 27 Oct 08:00 → 9 Nov 22:00 (14 days), every event hasAlarm=1 with a reminder at 0 min (method alert), 0 duplicates | PASS | c29, `content query` calendars/events/reminders |
| C6 | Sync now (Re-sync): toast "Your calendar is already up to date.", still 73 events, none deleted/duplicated | PASS | content query |
| C7 | Remove → confirm strip (Cancel / Remove calendar); Cancel keeps it; Remove calendar → toast "Removed the ÖRZA calendar from this phone.", calendar + all events gone from the provider, card back to "Add ÖRZA to my phone calendar"; Add again → 73 events | PASS | rm_strip, ad_strip, content query |
| C8 | Subscribe: Create my calendar link → toast, private link box (http://10.0.2.2:3100/api/calendar/feed/…), Copy (toast "Link copied"; clipboard verified by pasting into the iCal field), Share (Android share sheet with the link, back returns), Apple/Google/Outlook steps, local-server warning; Turn off → confirm strip → link gone, "Create my calendar link" back | PASS | c31, cp1s, c32, c33 |
| C9 | Connect your calendar: the iCal field stays above the keyboard; an http:// link is refused client-side with "Calendar links start with https:// or webcal://…" | PASS | c33, c34 |
| C10 | Calendar offline (wifi + data off) → a month not loaded yet (December): red "Can't reach ÖRZA right now… Try again" panel, but the header still said "LOADING MONTH" and the agenda said "A clear day — No medicines, reminders or events here yet" for a day it knew nothing about = bug B9. After fix: "MONTH NOT LOADED" + "This day hasn't loaded — … use Try again above" | FIXED | c57 → c58 |
| C11 | Phone calendar Sync now offline: error said "Your phone's calendar didn't accept the changes" (the fetch from ÖRZA failed, not the phone calendar) = bug B10. After fix: "Can't reach ÖRZA right now. Check your connection and try again."; network back → Sync now → "Synced just now", 73 events | FIXED | ui |
| C12 | Reminder with Calendar on (water, Mon/Wed/Fri 17:00) → opening Calendar re-synced the phone calendar: +6 "💧 Sip some water" events (Wed 28 Oct, Fri 30, Mon 2 Nov, Wed 4, Fri 6, Mon 9 at 17:00), 79 total, no duplicates; month header "74 doses · 7 reminders" | PASS | content query ev2 |
| C13 | Reminder deleted, app process then ended (Android kills background apps; here the 2 GB emulator ran out of memory) → app reopened → Calendar: "Synced 14 min ago", the deleted reminder's 6 events still in the phone calendar and still set to ring — the "stale" flag lived only in memory and the 6-hour rule skipped the re-sync = bug B8. After fix (marker file): change → kill → reopen → Calendar re-synced by itself: 73 events, 0 water events, marker removed | FIXED | content query ev3/ev4, run-as ls files |
| R1 | Reminders (orza://reminders): Up next hero, "Alarms on this phone" card ON with next alarm, list "Log your meal · Paused", presets, Medicine alarms card, Quiet hours, How it works | PASS | c35, c37–c39 |
| R2 | Alarm card count: "27 medicine alarms and 2 reminders set on this phone" with NO active reminder — the 2 were Metformin refill alerts (stock 16 ≤ 18) = bug B7. After fix: "27 medicine alarms and 2 refill alerts"; with reminders "27 medicine alarms, 13 reminders and 2 refill alerts" (7 breakfast + 6 water in the 7-day plan), later 10 / 7 as reminders changed | FIXED | ui |
| R3 | Preset "Log breakfast" → chip "Added", row "Every day · 9:00 am · APP · Next Today 9:00 am", server reminder times ["09:00"], days [] | PASS | local DB |
| R4 | New reminder sheet: kind Water (title/message defaults follow), days M/T/W/T/F/S/S → tap to drop days → "Mon, Wed, Fri" (the last day can't be removed), Add time → picker (AM/PM, hours, 5-min steps) → 4:35 pm, Calendar channel on → Add reminder: row "Mon, Wed, Fri · 9:00 am, 4:35 pm · APP · CALENDAR · Next Tomorrow 9:00 am"; server days [1,3,5], times ["09:00","16:35"], channels push+calendar | PASS | c40–c44, local DB |
| R5 | Edit: title field stays above the keyboard with Save lifted (c46); remove 9:00 am (the last time's × is disabled), change 4:35 → 5:00 pm via the picker, rename "Sip some water" → Save changes: row + server updated (times ["17:00"]) | PASS | c46, local DB |
| R6 | Pause / resume with the row switch: "Paused", server active false → true, list re-sorts | PASS | local DB |
| R7 | Delete: "Delete reminder" → the confirm strip's Cancel / Delete buttons were left under the pinned "Save changes" footer = bug B11. After fix the sheet scrolls the strip into view; Cancel → back; Delete reminder → row gone, server deleted | FIXED | c50 → c52 |
| R8 | Validation: empty title + no channel → only "Pick at least one way to be reminded." was visible; "Give the reminder a title." sat above, scrolled out of sight = bug B12. After fix the sheet scrolls to the first error (title) | FIXED | c55 → c56 |
| R9 | Repeat through the day: every 3 h, 9:00 am → 9:00 pm, Fill times → 9:00, 12:00, 3:00, 6:00, 9:00 (Times · 5) | PASS | ui |
| R10 | Quiet hours: switch on → saved 10:30 pm – 7:00 am at once (toast, server integrations.quiet_hours); From → 8:30 pm → "Save quiet hours" → saved 20:30–07:00 and "20 medicine doses in the next 7 days fall inside these hours and won't ring on this phone" (Metformin 21:00 ×6, Glimepiride 21:00 ×7, Amlodipine 22:00 ×7 — correct); switch off → server `{}` | PASS | c53, local DB |
| R11 | Notifications state is real: `pm revoke POST_NOTIFICATIONS` (system kills the app) → reopen: card OFF, "Notifications are off… Open Settings"; `pm grant` → back to the app: ON, "Notifications allowed", alarms re-counted | PASS | c54, ui |

## Bugs

| # | Bug | Status |
|---|-----|--------|
| B1 | Health: after two "Don't allow"s Health Connect marks every type USER_FIXED and never shows the sheet again; Connect only repeated the toast, with no route to the place where access can be given. Fix `src/features/health/ConnectCard.tsx`: after a denial the Connect card shows a hint + "Open Health Connect" (`health.openManage`), and when the app comes back to the front with access (`hasAccess`) it connects by itself without the sheet (`useHealthSync().connect({ onlyIfGranted })` in `src/lib/health/sync.ts`); `openManage` first tries ÖRZA's own Health Connect page (`Linking.sendIntent` MANAGE_HEALTH_PERMISSIONS + package; blocked today by N1) then the Health Connect home | FIXED, retested H4/H5 |
| B2 | Health: connected + the sync found nothing → Trends said "Your first sync … is on its way" forever. Fix `src/app/(app)/health.tsx`: when the last sync ran and was empty, the empty state says Health Connect had nothing to share for the last 30 days and data appears after the next sync | FIXED, retested (c10 state now shows the new text — checked in code; qa4 now has CSV data, so the state is not reachable on qa4) |
| B3 | Health: the Trends 30/90-day `Segmented` had no width in a space-between row; its segments are `flex: 1` (basis 0) so the track shrank to its padding and hid both labels. Fix: fixed width (`styles.range`, like WeightTrendCard) | FIXED, retested c12 |
| B4 | Health: Reconnect when Health Connect refuses to show its sheet (any USER_FIXED type) gave no feedback at all. Fix `ConnectCard.tsx` ConnectedState: `denied` → toast + "Health Connect isn't asking again…" hint + Open Health Connect; while `needsReconnect`, coming back to the app with access re-runs the sync by itself | FIXED, retested H11 |
| P1 | Health: Sync now with nothing new said "Connected — …" (the connect wording). `announce(…, justConnected)` | FIXED |
| B5 | Calendar month grid: tapping a day drew the selected fill as a square. The day circle (`num`) had only a radius — no background or border — so Fabric flattened it; when selection gave it a background the re-created native view never got the (unchanged) radius. Fix `src/features/calendar/MonthGrid.tsx`: the circle always has a transparent 1.5 px border (never flattened; same size in every state) | FIXED, retested c24 |
| B6 | Phone calendar card: after the second "Don't allow" the card showed the "Calendar access is off… Open Settings" box AND the red error with the same message. Fix `src/features/calendar/PhoneCalendarCard.tsx`: permission errors are hidden when the access-off box already explains it, and once access is granted | FIXED (code) |
| B7 | Reminders › "Alarms on this phone": every non-medicine alarm was called a reminder ("27 medicine alarms and 2 reminders" with no reminder on — 2 refill alerts). Fix: `src/lib/alarms/sync.ts` state `reminderAlarms` (reminder items among the scheduled), `src/features/alarms/AlarmStatusCard.tsx` lists medicine alarms, reminders and refill alerts separately | FIXED, retested R2 |
| B8 | Phone calendar: the "ÖRZA data changed" flag (reminder / medicine / dose changes) lived only in memory; once Android ended the app, the next Calendar visit within 6 h of the last sync did not re-sync, so deleted reminders / medicines kept ringing from the phone calendar. Fix `src/features/calendar/deviceCalendar.ts`: the flag is mirrored in a marker file (`orza-phone-calendar.stale`), set on changes / failed syncs, cleared when a sync starts or on sign-out clean-up | FIXED, retested C13 |
| B9 | Calendar offline / failed month: header "Loading month" forever and the agenda claimed "A clear day". Fix `src/app/(app)/calendar.tsx` ("Month not loaded", `unavailable` passed down) + `src/features/calendar/DayAgenda.tsx` ("This day hasn't loaded") | FIXED, retested C10 |
| B10 | Phone calendar Sync now offline blamed the phone ("Your phone's calendar didn't accept the changes"). Fix `phoneCalendarMessage`: an `ApiError` (the fetch from ÖRZA) shows the API's own message | FIXED, retested C11 |
| B11 | Reminder sheet: the delete confirmation's buttons were hidden under the pinned Save footer. Fix: `src/ui/Sheet.tsx` gives its content a `useSheetScroll()` context (`scrollToEnd`); `ReminderSheet` wraps the strip in `AtSheetEnd`, which scrolls it into view once laid out | FIXED, retested c52 |
| B12 | Reminder sheet: a failed Save showed errors that could be off-screen (title far above). Fix: `Sheet` takes a `scrollRef`; `ReminderSheet` records where title / times / channels sit and scrolls the first error into view | FIXED, retested c56 |
| P2 | Health Steps chart: the tallest bars reach the target line and ran through the "Target 9k" label. Fix `src/features/health/charts.tsx`: a white halo (stroked copy) under the label | FIXED, retested c64c |

## Native issues (not changed — report)

- N1: `Linking.sendIntent('android.health.connect.action.MANAGE_HEALTH_PERMISSIONS', [PACKAGE_NAME=in.co.ylo.orza])`
  is rejected by React Native's IntentModule (`resolveActivity == null`: package visibility — the manifest's `<queries>`
  has `com.google.android.apps.healthdata` but neither that intent action nor `com.google.android.healthconnect.controller`).
  From adb the same intent opens Health Connect › ÖRZA's permission page directly. Needs a `<queries><intent><action
  android:name="android.health.connect.action.MANAGE_HEALTH_PERMISSIONS"/></intent></queries>` (and
  `androidx.health.ACTION_MANAGE_HEALTH_PERMISSIONS` for Android 9–13) via app.json / a config plugin. JS already tries it
  first and falls back to the Health Connect home.

## Notes / observations (not bugs in this area)

- Test harness: in this dev build, typing a word with two "r"s close together (adb `input text`) inside a sheet's field
  reloaded the app — React Native's Modal forwards key-ups to the Activity, whose focus isn't the field, so its dev-only
  double-R reload fires. Not present in release builds. Escape (keyevent 111) closes a sheet like Back (edits discarded).
- Emulator: the dev build's process sits at ~500–670 MB RSS (native heap ~340 MB right after launch: unminified bundle);
  on this 2 GB emulator the system ran out of memory twice (load 60+, kswapd, `am force-stop` stuck) and the app process
  had to be killed (`run-as … kill -9`). `adb reverse tcp:8081` also vanished twice (adb transport re-connected) — re-run
  `adb reverse` / `app_start` when Metro shows "Cannot connect to Expo CLI".
- Health: no tooling on the emulator to insert Health Connect records (ÖRZA declares read permissions only; no Health
  Connect Toolbox) — sample data came through the local server's import API instead (case H7).

## State left on the emulator / local server (qa4@orza.test)

- Health Connect: ÖRZA may read Steps + Sleep (the other 6 types are USER_FIXED denied); Health sync connected.
- Local server: 19 days of sample health data (source csv); reminders "Log breakfast" (daily 9:00, active) and
  "Log your meal" (paused); quiet hours off; calendar feed link turned off.
- Phone: calendar permission granted, the "ÖRZA" phone calendar added (73 events); notifications granted.
