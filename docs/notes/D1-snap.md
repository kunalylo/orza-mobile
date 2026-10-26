# D1 — snap (Snap & Know, emulator E2E)

Emulator Medium_Phone (Android 16, 1080x2400), dev build 0b45fa1 + alarm module, Metro from main repo, local server
http://10.0.2.2:3100 (JSON DB `E:\aylo\orza-localtest\.data\orza-db.json`). Safety gate printed SAFE at start (2026-10-20 12:08 IST).
Screenshots `sNN` in the session scratchpad `e2e/` folder. AI budget: 1–2 scan calls.

Feature code: `src/app/(app)/(tabs)/snap.tsx`, `src/features/snap/**`, `src/lib/image.ts`, `src/features/meals/ItemEditor.tsx`.

## Test cases

| # | Case | Result | Evidence / notes |
|---|------|--------|------------------|
| 1 | Test photo: PIL-drawn overhead thali (dal, sabzi, curd, rice, 2 rotis, salad on a steel plate, wooden table), 1600x1200 JPEG, pushed to /sdcard/Pictures/thali.jpg | PASS | scratchpad `e2e/thali.jpg` (generator `make_thali.py`); shows first in the system photo picker (sn21) |
| 2 | Snap idle screen: header, viewfinder art, Take photo / Choose from gallery, Snap tips, credits + privacy fine print, disclaimer clears the tab bar | PASS | sn02–sn04 |
| 3 | Cancel the gallery picker (Android back) | PASS | sn06 picker → sn07 idle again, no error / toast, buttons enabled |
| 4 | Choose from gallery → photo prepared → "Photo ready" + note + Analyse | FIXED | sn11–sn13 / sn22: the **Analyse photo · 2 credits** button was a blank coral pill (no gradient, no label) — bug 1; sn23 / sn43 fixed. Spinner sat on "Take photo" while the gallery was being used — bug 2; sn40/sn42 fixed |
| 5 | Note field + keyboard | PASS | sn24–sn26: field scrolls above the keyboard, "homemade, less oil" typed (first adb burst lost chars while the keyboard was still opening — adb artefact, retyped fine) |
| 6 | Offline analyse (wifi + data off, keyboard "go") → error panel | PASS | one `analyse` call (temp log), sn27/28 scan line + "Spotting each item on the plate…", sn29 "Couldn't finish the scan · Let's try that again · Can't reach ÖRZA right now. Check your connection and try again." + refund note + Try again / Use another photo; no credits taken (97) |
| 7 | Offline analyse via the button, tapped twice 0.3 s apart | PASS / FIXED | one request (sn44/45). The error panel's second button read "Use another p…" (clipped) — bug 4 |
| 8 | Network back on → **Try again** (AI call 1 of 2) | PASS / FIXED | 12:28:42 → result in < 80 s on this slow emulator; server scan "Madhya Pradesh Thali", 0.9, 6 items (dal, chana dal, rice, 3 roti, curd, salad) 870 kcal; credits 97 → 95. Review opened scrolled past its own dish name / confidence / totals (sn47) — bug 3. Dish name + confidence chip drawn through the corner brackets (sn48) — bug 5 |
| 9 | Review: remove a row (Chana dal) → totals + range recompute | PASS | sn50 → sn51: 870 → 720 kcal, 35 → 25 g P, 160 → 135 g C, 14.5 → 10.5 g F, range 750–990 → 620–820 |
| 10 | Review: quantity stepper (roti 3 → 2, step 0.5) rescales the row | PASS | sn55: 210/6/45/3 → 140/4/30/2 (screens lag > 1 s on this emulator, so the first screenshot looked unchanged) |
| 11 | Review: Add item → blank row; Log with it blank → validation | PASS | sn57/58 new "Item 6" (placeholder "e.g. Dal tadka"); sn60 toast "Please check the highlighted fields." + name / kcal fields red + "Give this item a name · Calories: 0–5000" |
| 12 | Review: fill the new row (Aloo matar sabzi 150 / 4 / 18 / 7) with the keyboard | PASS | sn61–63: focused fields scroll above the keyboard; errors clear as the row becomes valid; totals 800 / 27 / 138 / 16.5, range 690–910 (sn70) |
| 13 | Meal type segmented (Lunch preselected at 12:3x → Dinner → Lunch) | PASS | sn64/65 |
| 14 | Android back while reviewing → "Discard this scan?" | FIXED | sn66 dialog OK, but back on the dialog did nothing (not cancelable) — bug 6; sn68/69 back now keeps reviewing |
| 15 | Log this meal → Logged panel + server + Meals + Today | PASS | sn72–74 spinner then "Added to lunch · Madhya Pradesh Thali — 6 items, 800 kcal · P 27g · C 138g · F 16.5g · Fibre 10g"; server meal source photo, lunch, 800 kcal, 6 items, scan confirmed + meal_id; View meal log → Meals today (sn76–78) "2 meals · 1,370 kcal", PHOTO · 12:36 PM card with all 6 rows (Roti 2 roti · 80 g); Today (sn79–81) 1,370 eaten / 310 left, Lunch "Madhya Pradesh Thali 12:36 pm · Dal, Rice, Roti ×2, Curd, Salad… 800" with camera icon |
| 16 | Camera: Take photo → system prompt "Allow ÖRZA to take pictures and record video?" → While using the app → emulator virtual camera (CaptureActivity) → shutter → ✓ → "PHOTO READY · Resized on your device" with the photo, note, Analyse, Retake / Gallery, 95 credits | PASS | sn88–90 prompt (spinner on Take photo while it is up), sn106 camera, sn110 capture review, sn111/112 photo ready (the photo drew ~5 s after the controls on this emulator) |
| 17 | Camera: Don't allow once → "CAMERA ACCESS · ÖRZA needs your camera" + Allow access / Choose from gallery instead | PASS | sn91/92, sn105; Allow access re-opens the system prompt (sn93) |
| 18 | Camera: Don't allow twice → "…You can turn it on in Settings." + Open Settings → system App info page for ÖRZA | PASS / FIXED | sn94–96. Allowing camera there and coming back left the stale "needs your camera / Open Settings" panel (sn99) — bug 7. "Ask every time" in Settings left the camera unusable from the app — bug 8 (sn102 → sn104 fixed) |
| 19 | Cancel the camera (back without capturing) → idle, tips, no error / toast | PASS / FIXED | sn106 → sn109. Allow access → allowed → camera cancelled used to keep the "needs your camera" panel (bug 7) — now cleared (sn109) |
| 20 | Analyse a non-food camera photo (AI call 2 of 2) → "Couldn't finish the scan · The photo does not show any food or drink. No credits were used." + Use another photo only (no Try again); balance stays 95 | PASS | sn113 analysing state, sn114b; server: −2 then "Refund: Snap & Know scan — nothing found" +2 (balance 95). Button icon was a camera although it opens the gallery — bug 9 (polish) |
| 21 | Bug 7/8 retest: camera really blocked (`pm revoke` + user-fixed) → Take photo → no dialog flash, "Open Settings" panel → App info → Permissions → Camera → Allow only while using the app → back → panel gone, page back at the top with tips (toast "Camera access is on — tap Take photo." — 3 s, gone before the slow screenshot) | FIXED | sn117/118 → sn119–121 → sn124 |
| 22 | Retake (camera) from "Photo ready" → cancel the camera → the earlier photo stays, no error | PASS | sn131 → sn132 |
| 23 | Android stops ÖRZA while the camera is open (`am kill` with the camera in front, like a low-memory kill on a 2–3 GB phone) → take the photo → ÖRZA restarts on Today and the photo is gone | OPEN (JS recovery added, not verifiable here) | sn125. Bug 10 |
| 24 | Resume check 2026-10-26 on HEAD 54a847c (after the meds-rx / today-meals commits; no snap files changed since cbf6e5e): safety gate SAFE, `npm run typecheck` + `npx expo lint` clean, Snap → Choose from gallery → thali → "PHOTO READY" with the Analyse photo · 2 credits button drawn (gradient + label, bug 1 stays fixed), 91 credits; no AI call | PASS | r04 picker, r05 photo ready. The dev element inspector had been left open by an earlier session ("Tap something to inspect it") and `uiautomator dump` cannot get an idle screen (endless tab-bar halo), so this check used screenshots |

## Bugs

1. FIXED — Snap "Analyse photo" rendered blank (Android). After picking a photo the controls switch from
   [Take photo, Choose from gallery] to [note, Analyse, …]; React reused the *secondary* "Choose from gallery" Button
   instance for the *energy* "Analyse" one. On Android/Fabric a rounded `overflow: hidden` view whose border goes away
   (secondary has a 2-hairline border, energy none) stopped drawing its children: coral background only, no gradient,
   no label (sn12, reproduced twice). Proven by experiment: with the secondary border removed the button rendered.
   Fix: `key={variant}` on the Button's PressableScale (src/ui/Button.tsx) — a fresh native view per variant. Also
   protects the other live variant toggles (recipe Save secondary↔primary, rx history, goals, alarms, rx analyse).
2. FIXED — Snap: choosing from the gallery showed the spinner on "Take photo"; `preparing` is now the source being
   picked, so the pressed button (Take photo / Choose from gallery / Retake / Gallery) spins and the others are disabled.
   Also synchronous ref guards: one picker at a time, and one scan request per photo until it settles (a double
   submit would spend 2 × 2 credits) — src/app/(app)/(tabs)/snap.tsx.
3. FIXED — Snap: after a scan the screen scrolled to the side panel's *old* position (read one frame after the state
   change, before the panel's new layout arrived); results drop the note + Analyse block above it, so the review
   opened ~300 dp too far down — dish name, confidence and totals off screen. Now scrolls shortly after the request
   and again whenever the panel reports a new y during the next second (snap.tsx `scrollToSide`).
4. FIXED — Snap panels: two buttons sharing a row were `flex: 1` + one line, so "Use another photo" was clipped to
   "Use another p…" (and longer translations / larger fonts would clip more). Now `flexGrow: 1` with the row's wrap:
   equal-ish when both fit, otherwise each gets its own line (src/features/snap/Panels.tsx).
5. FIXED — Viewfinder results: the white corner brackets ran through the dish name (bottom-left) and the confidence
   chip (top-right). Brackets are hidden once the result chips show (src/features/snap/Viewfinder.tsx).
6. FIXED — "Discard this scan?" (Android back while reviewing) could not be dismissed with back; now `cancelable` —
   back / outside tap = Keep reviewing.

7. FIXED — Snap: the camera-permission panel went stale. (a) Open Settings → Allow → back to ÖRZA still showed
   "ÖRZA needs your camera · Open Settings" (sn99); (b) Allow access → allowed → camera closed without a photo kept the
   panel too. Now the panel re-checks the permission whenever the app becomes active (gone + toast "Camera access is on —
   tap Take photo." once allowed; switches Allow access ↔ Open Settings when the status changed) and is cleared as soon
   as a pick gets past the permission step (snap.tsx; new `photoPermission()` in src/lib/image.ts).
8. FIXED — Camera / photo permission could never be asked again after a block. expo-modules remembers `canAskAgain`
   from the last request, so after "Don't allow" twice and then "Ask every time" in system Settings it still read false;
   `ensureCameraPermission` skipped the request when `canAskAgain` was false → straight to "Open Settings" with no
   dialog (sn102, reproduced with `pm revoke` + cleared flags). Now it always requests when not granted — a really
   blocked permission returns at once without a dialog (sn104: dialog shown again). Also used by medicine / Rx photos.
9. FIXED (polish) — "Use another photo" on the scan-error panel showed a camera icon but opens the gallery; gallery icon.
10. OPEN / partly fixed — A photo taken while Android stopped ÖRZA (low memory, camera in front) was silently lost: the
   app restarts on Today (sn125). Expo's documented answer is `ImagePicker.getPendingResultAsync()` on start, which the
   app never called. Added: Snap passes `owner: 'snap'` to `pickPhotos`, which remembers it in SecureStore while the
   camera / picker is open; the tabs layout calls `recoverSnapPhoto()` once per start → `takePendingPhotos('snap')` →
   opens Snap with the photo ("Your photo is back — add a note or analyse it."). On this **dev-client** build the mark
   is read correctly (`{"owner":"snap",…}`) but `getPendingResultAsync()` returns `null` — the dev launcher creates the
   React context ~20 s after the camera result arrives, so expo-modules has nobody to hand it to. Needs a check on a
   release / preview build (camera open → `adb shell am kill in.co.ylo.orza` → take the photo → Snap should show it).
   Medicine / Rx photos don't pass an owner (unchanged).

## Environment notes

- Dev build on the 2 GB emulator: native heap 450–580 MB, ~900 MB swap in use; RenderThread 50–70 % + main thread
  ~30 % CPU even when idle on Today or Snap (the tab bar's Snap halo animates forever). One ANR ("ÖRZA isn't responding",
  main thread `Waited 5002ms for KeyEvent`, 12:20:25) right after the offline test while the system was swapping; the
  lower half of Snap stayed blank (keyboard space not given back) for > 3 s after the keyboard closed during that time.
- Resumed session (16:05): the dev element inspector was left open ("Tap something to inspect it") — app restarted.
  `app_start` force-stop + immediate start was cancelled ("refused to die while trying to launch") twice; one launch
  died as "failed to complete startup" (bg ANR — class verification at 25–150 bytecodes/s, swap 1.49 / 1.51 GB used).
  `scripts/e2e/adb.sh` `app_start` now waits for the old process to go before starting.
- Two more ANRs "Waited 5002ms for FocusEvent(hasFocus=true)" right when ÖRZA came back to the front (from system
  Settings 16:16, from the camera 16:29); the app showed a black window for a few seconds, then recovered. App PSS
  ~670 MB (dev build), swap full — environment, but worth a look on a release build / real device.
- `adb reverse tcp:8081` silently disappeared during the session (HMR "Cannot connect to Expo CLI" warning in JS logs);
  re-added.
