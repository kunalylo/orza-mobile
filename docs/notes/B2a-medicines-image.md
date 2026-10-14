# B2a — Medicines + photo helper (notes / resume file)

## Endpoints (web: E:\aylo\orza\src\app\api\meds\**)
- GET  /meds → {medications: MedicationClient[]} (active first, A–Z). MedicationClient = Medication + photo_urls[] + uses_prescription_photo?
- POST /meds {name(1-80), strength?, form, dose(1-40), timing, instructions?(≤300), schedule{times[≤12 HH:MM], days?[0-6], start_date, end_date?, every_n_days?(1-90)}, as_needed, stock?{count 0-10000, unit, refill_alert_at?}, for_person?(≤40), photos?: dataUrl[] (≤4)} → 201 {medication}
- GET/PATCH/DELETE /meds/:id → {medication} / {medication} / {ok}. PATCH partial; null clears strength/instructions/for_person/stock; schedule partial (end_date null clears, every_n_days null clears); active; primary_photo_id.
- POST /meds/:id/photos {image} → {medication} (max 6 photos excl. prescription fallback; 400 "A medicine can have up to 6 photos…")
- DELETE /meds/:id/photos/:mediaId → {medication}
- GET /meds/today?date=YYYY-MM-DD → {date, now, doses: DoseItem[]} (status upcoming|due|taken|skipped|snoozed|missed)
- POST /meds/doses {medication_id, scheduled_for, action take|skip|snooze, snooze_minutes 5-60} → {dose: DoseLog}
- GET /meds/adherence?days=7|30 → {days, from, to, overall, daily[], medicines[]} (Tally: scheduled, taken, skipped, missed, pending, upcoming, total, rate|null)
- Errors: zod → 400 {error:"path: msg", code:"validation"} (no field — parse the path prefix); badRequest → 400 code bad_request; 404 "Medicine not found"; image > 1.5 MB → 400/413.
- Server image limit MAX_IMAGE_BYTES 1_500_000 (decoded). Client targets ≤ 1_400_000 like the web.

## Library APIs
- expo-image-picker v57: launchCameraAsync / launchImageLibraryAsync({mediaTypes:['images'], allowsMultipleSelection, selectionLimit, quality:1}); result {canceled, assets}. Library picker needs no permission (system picker); camera: get/requestCameraPermissionsAsync → {granted, canAskAgain} (canAskAgain false → "blocked").
- expo-image-manipulator v57 contextual API: ImageManipulator.manipulate(uri|ImageRef).resize({width|height}).renderAsync() → ImageRef{width,height,saveAsync({format: SaveFormat.JPEG, compress, base64:true})}; release() shared objects.
- usePreventRemove from 'expo-router/react-navigation' (unsaved-changes guard; catches header back, swipe, Android back).
- Pickers: custom Sheet-based time picker (hour/minute/am-pm grid) + month calendar date picker (dependable, no native module).

## Decisions
- Port web shared.ts helpers into src/features/meds/shared.ts; schedule draft logic into schedule.ts (quick patterns: 1-0-0 08:00 · 0-0-1 21:00 · 1-0-1 08:00,21:00 · 1-1-1 08:00,14:00,21:00 · BD 08:00,20:00 · TDS 08:00,14:00,21:00 · HS 22:00 · SOS as_needed).
- "Type it as written on your prescription" (web parseFrequency, 422 lines) NOT ported — out of scope for this step.
- Edit mode: photo add/remove/primary save immediately (like web); fields saved on "Save changes". Pause/delete live on the detail screen.
- History on detail: per-medicine tallies from /meds/adherence?days=7 and 30 + today's doses for that medicine (no per-dose history endpoint).
- toUploadDataUrl steps down [maxSide,q] → [1280,.7] → [1100,.65] → [960,.6] → [800,.5]; throws PhotoError when still too large. Extra exports (additive): PhotoError, MAX_UPLOAD_BYTES.

## Checklist
- [x] src/lib/image.ts
- [x] src/features/meds/types.ts
- [x] src/features/meds/shared.ts
- [x] src/features/meds/schedule.ts
- [x] src/features/meds/api.ts
- [x] src/features/meds/MedPhoto.tsx
- [x] src/features/meds/StatusViews.tsx (error panel / inline states)
- [x] src/features/meds/TodayTimeline.tsx
- [x] src/features/meds/AdherenceStrip.tsx
- [x] src/features/meds/MedicineCard.tsx
- [x] src/features/meds/PickerSheets.tsx (time + date)
- [x] src/features/meds/ScheduleEditor.tsx
- [x] src/features/meds/PhotoGrid.tsx
- [x] src/app/(app)/(tabs)/medicines.tsx
- [x] src/app/(app)/med/[id].tsx
- [x] src/app/(app)/med/edit.tsx
- [x] src/app/(app)/rx/index.tsx (temporary placeholder)
- [x] npm run routes / typecheck / lint

## Status
All items built; `npm run typecheck` and `npx expo lint` clean. Cross-area: optional modal presentation for med/edit in
src/app/(app)/_layout.tsx; alarm screen reads `med` + `at` params (TodayTimeline links to /alarm?med=&at=).
