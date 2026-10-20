# D1 — meds-rx (Medicines + Prescriptions, emulator E2E)

Emulator Medium_Phone (Android 16, 1080x2400), dev build 0b45fa1 + alarm module, Metro from main repo, local server
http://10.0.2.2:3100 (JSON DB `E:\aylo\orza-localtest\.data\orza-db.json`). Safety gate printed SAFE at start (2026-10-20 ~17:07 IST).
Account: qa4@orza.test (already signed in, 0 medicines). Screenshots `mrNN` in the session scratchpad `e2e/` folder.
AI budget: 1–2 prescription scans.

Feature code: `src/app/(app)/(tabs)/medicines.tsx`, `src/app/(app)/med/*`, `src/app/(app)/rx/*`, `src/features/meds/**`,
`src/features/rx/**`, `src/features/today/MedsCard.tsx`.

## Test cases

| # | Case | Result | Evidence / notes |
|---|------|--------|------------------|
| 1 | Test images: PIL pill box (Metformin 500 mg carton + blister on wood) and a printed prescription (Dr. Anjali Mehta header, patient, date 18/10/2026, 3 medicines: Glimepiride 1 mg 1-0-1 before food x 30 days, Amlodipine 5 mg 0-0-1 after food x 30 days, Pantoprazole 40 mg cap 1-0-0 empty stomach x 14 days) → /sdcard/Pictures | PASS | scratchpad `e2e/pillbox.jpg`, `e2e/rx_mehta.jpg` (generator `gen/make_images.py`); both first in the photo picker (mr15) |
| 2 | Medicines tab, 0 medicines: hero, alarm status card, "No medicines yet" + Scan a prescription + Add manually | FIXED | mr02–mr04: the dark hero was invisible (white text on the cream page) — bug 1; mr08 fixed. mr09: title read "No medicines" — bug 2; mr10 fixed. While the list loads the page briefly shows the Today card ("No doses scheduled today") before switching to the empty state (mr01/mr02) — cosmetic, left |
| 3 | Add form: Add & set alarms with nothing filled → toast "Please check the highlighted fields." + name field red "Add the medicine's name." | PASS | mr13 |
| 4 | Add form: From gallery → system photo picker (multi, up to 4) → pill box → tile with "On alarm" badge + remove | PASS / FIXED | mr15–mr17. "Preparing…" tile + disabled buttons showed while the picker was still open (mr14) — bug 3; mr20–mr22 fixed (Preparing appears only after a photo is chosen) |
| 5 | Name / strength / form (Tablet) / dose (1 tablet default) / With food = After food | PASS | mr19, mr23, mr24 (first adb burst garbled "Metformin" into the Strength field after a Fast Refresh remount — test artefact) |
| 6 | Schedule: 1-0-1 → 8:00 am + 9:00 pm; change 8:00 am → 5:00 pm in the time sheet (AM/PM, hour, minute grid); Add time → 5:15 pm; Some days → Mon–Fri preselected, + Sat; summary | PASS / FIXED | mr25–mr31. Pills stayed in insertion order (5:00 pm, 9:00 pm, 5:15 pm) — bug 4; now sorted. Summary eyebrow nested in the sentence squeezed the wrapped lines — bug 5 (polish); mr32 fixed |
| 7 | Track stock: switch on → Left now 20, Alert at (placeholder "Auto (13)") 18, unit tablets | PASS | mr33–mr35; Auto (13) = 3 doses × 6/7 days × 5 days |
| 8 | Details: For "Papa" | PASS | mr36; after save a "Papa" suggestion chip appears |
| 9 | Save → toast "Metformin added — alarms are set" → first-medicine alarm prompt (notifications → Allow; exact alarms → Not now) → back on Medicines with Everyone / Me / Papa chips | PASS | mr37–mr43. Server: name Metformin, strength 500 mg, tablet, 1 tablet, after_food, times 17:00/17:15/21:00, days [1..6], start 2026-10-20, stock {20, tablets, 18}, for_person Papa, 1 photo |
| 10 | Today timeline: 3 doses (5:00 / 5:15 due, 9:00 upcoming), "2 due now", "0 of 3 taken", photo, tags | PASS / FIXED | mr43: Take, Snooze and Skip each sat on their own line beside a lone full-screen icon column — bug 6; mr44 fixed (Take + Snooze share a line, Skip + full-screen below) |
| 11 | Take 5:00 pm (online) → "Taken at 5:30 pm", check badge, 1 of 3, progress bar, toast; server dose_log taken + stock 20 → 19 | PASS | mr45–mr47; dose_log `…:2026-10-20T11:30:00.000Z` taken 12:00:13Z, stock 19 |
| 12 | Snooze 10 min on 5:15 pm → "Snoozed until 5:40 pm"; server snoozed, snooze_until 12:10:57Z | PASS / FIXED | mr48/49. The status pill ran into the card's padding (would cross the edge for 10:xx–12:xx) — bug 7; pill now "Snoozed · 5:40 pm" and tags can never be wider than their row (mr52) |
| 13 | Optimistic update: offline Skip → row shows Skipped (strike-through, Take after all) at once → request fails → rolled back + toast "Can't reach ÖRZA right now…" | FIXED | mr56 burst: the row kept its old state with a spinner on Skip for ~1.3 s before the optimistic Skipped appeared (cancelQueries awaited first) — bug 8; mr57 burst: Skipped in the next frame, rollback after the failure |
| 14 | Skip online → "Skipped", toast "Metformin — skipped", "Take after all"; server dose_log skipped | PASS | mr59; dose_log 17:15 skipped 12:06:33Z (the first tap right after re-enabling wifi failed — network not up yet, rolled back correctly) |
| 15 | Person filter: Me → Today "No doses scheduled today", list "No medicines for this person yet."; Papa → Papa's doses + card | PASS / FIXED (polish) | mr60–mr63. The filtered Today note said "Nothing is due today on your current schedules" and the 7-day adherence (which is for all medicines — same as the web) looked like it was the person's — now "Nothing is scheduled today for this person. Choose Everyone…" and "LAST 7 DAYS · EVERYONE" while filtered (bug 9) |
| 16 | Adherence strip: 50 %, "1 of 2 doses taken in the last 7 days", Tue ring 1/2 (taken + skipped) | PASS | mr60 |
| 17 | Medicine card: photo, "500 mg · 1 tablet · Tablet", schedule, After food / For Papa, "19 tablets left", "About 7 days left" | PASS | mr63 |
| 18 | Detail: header "MEDICINE · FOR PAPA / Metformin 500 mg", photo with "On alarm", tags, schedule (summary, time pills, repeat, started, until), "Take it after food.", stock, Today (3 doses), History 7 / 30 days, Edit / Pause / Delete | PASS | mr65–mr67, mr70 |
| 19 | Detail → "Take after all" on the skipped 5:15 dose → Taken at 5:40 pm, toast, stock 19 → 18 = alert → "Refill soon" tag + stock card "Refill soon — the alert is set at 18."; History 100 % 2 of 2 | PASS | mr68–mr70; server 17:15 taken, stock 18 |
| 20 | Edit: second photo from the gallery (uploads at once, star = make primary, "Preparing…" during upload), remove the 5:15 pm time, instructions "Swallow whole with water" → Save changes → "Metformin updated" → detail | PASS / FIXED (polish) | mr71–mr81; server times 17:00/21:00, days Mon–Sat, stock kept at 18, instructions saved, 2 photos. The upload toast said "Photo added — alarms show it" for a second photo, which alarms don't show — bug 10 |
| 21 | Detail carousel: 2 dots; swipe → second photo, dots move, "On alarm" badge only on photo 1 | PASS | mr81, mr84 (a fast adb fling didn't page — adb artefact, a normal drag pages) |

## Bugs

1. FIXED — Medicines hero (and the Reminders "Up next" + Rx "Alarms are set" heroes) were unreadable: `GlassCard tone="dark"`
   is translucent white glass (`heroGlass` rgba(255,255,255,0.08)) meant for the dark hero backdrop (admin screen), but
   these three sit on the light `orb` backdrop → white text on cream (mr02). New `tone="hero"`: solid #07090C with the
   hero gradient + floating shadow (src/ui/GlassCard.tsx); medicines.tsx, reminders.tsx, rx/done.tsx use it.
2. FIXED — EmptyState title lost its last word on Android ("No medicines yet" → "No medicines", mr09): the centred column
   shrink-wraps the title, Android measures Playfair with negative letter spacing a hair narrower than it draws, the
   last word wraps onto a second line that the measured height clips. Title now `alignSelf: 'stretch'`
   (src/ui/EmptyState.tsx) — app-wide.
3. FIXED (polish) — Medicine photos: "Preparing…" tile and disabled Take photo / From gallery appeared as soon as the
   button was tapped, while the system picker was still open (and flashed on cancel). `pickUploadPhotos(source, max,
   onPrepare)` now reports when photos were actually picked; edit.tsx sets busy only then and guards a second picker
   with a ref (src/features/meds/PhotoGrid.tsx, src/app/(app)/med/edit.tsx).
4. FIXED — Schedule editor: alarm-time pills stayed in the order they were added (5:00 pm · 9:00 pm · 5:15 pm); the time
   sheet now keeps them sorted and de-duplicated (src/features/meds/ScheduleEditor.tsx).
5. FIXED (polish) — Schedule summary: the "SUMMARY ·" eyebrow nested inside the sentence gave the wrapped lines the
   eyebrow's small line height (lines touching, mr31); eyebrow now on its own line.
6. FIXED — Today timeline dose card: Take / Snooze 10 min / Skip wrapped one per line (narrow column next to a separate
   full-screen icon column), three stacked buttons per dose (mr43). The full-screen button moved into the wrapping
   action row (pushed right); Take and Snooze grow to share the first line, Skip + full-screen the second
   (src/features/meds/TodayTimeline.tsx; also the medicine detail's Today card).
7. FIXED — Status pill "SNOOZED UNTIL 5:40 PM" was wider than the text column beside the photo and ran into the card's
   padding (10:xx–12:xx would cross the border). Timeline pill now "Snoozed · 5:40 pm" (accessibility label keeps the
   long form) and `Tag` gets `maxWidth: '100%'` + a shrinkable 2-line label so no tag can overflow its row (src/ui/Chip.tsx).
8. FIXED — Take / Snooze / Skip optimistic update arrived late: `act()` awaited `cancelQueries` (and a render of the
   pending state) before writing the optimistic row, so the old row sat with a spinner for ~1.3 s on the emulator
   (mr56 burst). The optimistic row is now written in the same tick as the pending state and re-applied after the
   cancel settles (a cancelled GET reverts the cache) — src/features/meds/api.ts; mr57 burst shows Skipped next frame.
9. FIXED (polish) — Medicines tab person filter: the empty Today note for a filtered person talked about "your current
   schedules", and the adherence card (always all medicines, like the web) gave no hint it wasn't filtered. Filtered
   note + "Last 7 days · everyone" eyebrow (src/app/(app)/(tabs)/medicines.tsx).
10. FIXED (polish) — Edit medicine: adding a second photo toasted "Photo added — alarms show it"; only the first photo
   (or the first real photo replacing a prescription stand-in) rings on alarms. Toast now says so only then.

## Resume 2 (2026-10-20 ~21:05 IST — after the usage-limit pause; emulator had rebooted)

Safety gate SAFE again. Cases 22–30 below were reconstructed from the screenshots mr85–mr128 and the local DB
(one prescription scan = the 1st AI call; scan created 12:20:20Z, applied 12:26:22Z).

| # | Case | Result | Evidence / notes |
|---|------|--------|------------------|
| 22 | Medicines hero → Scan a prescription → capture screen (viewfinder, Take photo / Upload, tips, "Your prescriptions" empty state) | PASS / FIXED (polish) | mr85–mr89. The "PRESCRIPTION" badge sat on the frame's corner mark (lines showed through the glass) — bug 11; moved inside the mark (Viewfinder.tsx) |
| 23 | Upload → gallery → rx_mehta.jpg → preview with "Read prescription · 2 credits", Retake / Gallery, "95 credits left · resized on your phone" | PASS | mr90–mr91 |
| 24 | Read prescription (AI call 1) → reading state → review | PASS / FIXED (polish) | mr92–mr93: the loading Button hid its label — a bare spinner on an orange bar for 10–30 s — bug 12; now an "ActivityIndicator + Reading your prescription…" pill (rx/index.tsx). Read: Dr. Anjali Mehta, 18 Oct, Mr. Ramesh Kulkarni, notes; Glimepiride 1 mg 1-0-1 before food 30 d → 8:00 am + 9:00 pm; Amlodipine 5 mg 0-0-1 after food 30 d → 9:00 pm; Pantoprazole 40 mg cap 1-0-0 empty stomach 14 d → 8:00 am (mr94–mr95) |
| 25 | Review: untick Pantoprazole → "2 of 3 selected", Create alarms (2); tick again → 3 | PASS | mr96, mr102 |
| 26 | Review: edit Amlodipine (sheet shows "As written on the prescription: 0-0-1 After food") → change the alarm time 9:00 pm → 10:00 pm in the time sheet → close with changes → "Discard changes?" → Keep editing → Save → row shows 10:00 pm | PASS | mr97–mr103 |
| 27 | Review: "These medicines are for" field | FIXED (polish) | mr103: the placeholder "e.g. Mom — leave empty if they're yours" wrapped inside the one-line field and was clipped — bug 13; placeholder "e.g. Mom, Papa", the "leave empty" sentence moved to the hint (mr104) |
| 28 | Create alarms (3) → loading → "Alarms are set / 3 medicines added" with each medicine, times, "until 18 Nov / 2 Nov", Add pill photo, See today's doses / Notifications / Scan another | PASS | mr105–mr109. Server: Glimepiride 08:00+21:00 end 2026-11-18; Amlodipine 22:00 end 2026-11-18; Pantoprazole capsule 08:00 empty_stomach end 2026-11-02; all photo_ids = the Rx photo, prescription_id set, prescription status applied |
| 29 | History: Scan another → "Your prescriptions" → Dr. Anjali Mehta · 18 Oct · 3 medicines · ALARMS CREATED → detail sheet (photo, patient, notes, Delete / See medicines) | PASS | mr110–mr112 |
| 30 | Manual entry: "Prefer typing?" → "Type your prescription" + auto-opened "Add a medicine" sheet; Dolo 650 mg TDS 3 days; Cetirizine SOS | FIXED (partly) | mr113–mr121. TDS showed the 1-1-1 chip selected (same times) — bug 14, the tapped pattern now wins (RowEditorSheet). SOS on a typed 1-0-1 row read "As written · 1-0-1" — bug 15, a pattern the editor filled is replaced by SOS. mr114 showed a SECOND "New medicine" sheet rising under the Dolo sheet's "Discard changes?" dialog — being investigated (debug logs in Sheet.tsx at the pause) |
| 31 | Capture screen after the fix: badge inside the corner mark | PASS | mr133 (bug 11 verified) |
| 32 | Manual entry: "New medicine" sheet opens with the name focused — keyboard up | FIXED | mr134/mr135: the name field looked focused but no keyboard came (`mInputShown=false`) — bug 16. RowEditorSheet used `autoFocus` inside the Modal; now `initialFocus` (Sheet waits for the Modal's onShow and retries). Retest: `mInputShown=true` on open (mr144) |
| 33 | Manual entry: typed Cetirizine → SOS on → Add medicine → the whole review screen froze (no tap, no scroll; Create alarms dead) | FIXED | mr140/mr141. `dumpsys window` showed a 2nd full-screen TRANSPARENT app window (the Sheet's RN Modal) left on top after the sheet closed — bug 17 (the same freeze as mr122–mr125 before the pause). Isolated: only when the sheet unmounts while the SOS note (`Animated.View entering={FadeIn} exiting={FadeOut}`) is on screen (chip removal, SOS on→off, discard: no leak). Reanimated keeps the ancestors of a view with an exiting animation — the Modal included — alive to play it, and the Modal window never went away. Fix: Sheet wraps its Modal in `<LayoutAnimationConfig skipExiting>` (the sheet has already slid out). Retest: same steps → 1 app window, Add a medicine works again |
| 34 | Pattern chips with the keyboard up (just typed the strength) | FIXED | the first tap on 0-0-1 / TDS only dismissed the keyboard (kbd 0, pattern unchanged — reproduced with the prop removed) — bug 19; the nested horizontal chip ScrollView now has `keyboardShouldPersistTaps="handled"` → one tap selects BD / 0-0-1 with the keyboard still up |
| 35 | Manual: Dolo 650 mg TDS (8:00 am · 2:00 pm · 9:00 pm), After food, 3 days; Cetirizine 10 mg SOS; edit a row (rename Cet → Cetirizine, 10 mg); doctor Dr. Rao; prescription photo from the gallery (thumb + "kept with this prescription" note); for "Mom" → Create alarms (2) → loading → "2 medicines added · 1 of them will ring" | PASS | mr145–mr152. Server: Rx doctor Dr. Rao, media set, status applied, TDS/SOS frequency_text; Dolo times 08:00/14:00/21:00 after_food end 2026-10-22, for Mom; Cetirizine as_needed, times [], for Mom; both photo_ids = the Rx photo. "As written · TDS / SOS" on the rows (bugs 14/15 verified) |
| 36 | Done → Add pill photo (Dolo) → Edit Dolo with the prescription stand-in + "Showing your prescription for now" → gallery pill box → Preparing… → "Photo added — alarms show it", stand-in replaced (server photo_ids = 1 new id) → Save changes → back on Done, Dolo shows its photo | PASS / FIXED (polish) | mr153–mr155. With the stand-in the grid said "Up to 7 photos" (the stand-in's slot), then "Up to 6" after — bug 18; now "Up to 6" throughout (`shownMax`) |

### Bugs (resume 2)

11. FIXED (polish) — Rx viewfinder "PRESCRIPTION" badge sat on the frame's corner mark (src/features/rx/Viewfinder.tsx).
12. FIXED (polish) — Rx reading state was a loading Button (label hidden) = a bare spinner on an orange bar for 10–30 s;
    now a pill with spinner + "Reading your prescription…" (src/app/(app)/rx/index.tsx).
13. FIXED (polish) — Rx review "These medicines are for" placeholder wrapped and clipped in the one-line field; short
    placeholder, the "leave empty" sentence in the hint (src/app/(app)/rx/review.tsx).
14. FIXED — Row editor: tapping TDS highlighted 1-1-1 (same times); the tapped pattern now wins (RowEditorSheet).
15. FIXED — Row editor: SOS on a typed 1-0-1 row kept frequency_text "1-0-1" → "As written · 1-0-1" on an SOS row; a
    pattern the editor filled is replaced by "SOS", a scanned free-text frequency is kept (RowEditorSheet).
16. FIXED — Row editor (new medicine) opened with the name field focused but no keyboard (autoFocus inside a Modal on
    Android); now Sheet `initialFocus` (RowEditorSheet).
17. FIXED (P0) — Any Sheet that unmounted while a child with an `exiting` layout animation was on screen left its RN
    Modal window on top: invisible, full screen, swallowing every tap → the screen froze (Rx manual entry after adding an
    SOS medicine: Create alarms dead; only an app restart helped). Sheet now wraps the Modal in
    `LayoutAnimationConfig skipExiting` (src/ui/Sheet.tsx) — app-wide.
18. FIXED (polish) — Edit medicine with a prescription stand-in said "Up to 7 photos"; PhotoGrid `shownMax` keeps the
    member-facing limit at 6 (src/features/meds/PhotoGrid.tsx, src/app/(app)/med/edit.tsx).
19. FIXED — Row editor pattern chips ignored the first tap while the keyboard was up (nested horizontal ScrollView
    without keyboardShouldPersistTaps) (RowEditorSheet).
