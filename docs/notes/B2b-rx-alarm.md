# B2b — Prescriptions (/rx) + Alarm screen (notes / resume file)

## Endpoints (web: E:\aylo\orza\src\app\api\prescriptions\**, meds\doses)
- POST /prescriptions/scan {image: dataUrl} → {prescription: PrescriptionClient, credits}. 2 credits (refunded on AI failure).
  Errors: 503 `ai_disabled` (offer manual entry) · 402 / `no_credits` (link /credits) · 429 `rate_limited` (shared photo-scan budget) ·
  400 image too big / bad type (`validation` / `bad_request`). One photo per scan ("Scan each page separately").
- GET /prescriptions → {prescriptions: PrescriptionClient[]} newest first, ≤50.
- POST /prescriptions {image?, doctor?(≤200, clamped 80), issued_on?, notes?, medicines?: object[] (≤20)} → 201 {prescription} (manual, status "review").
- GET /prescriptions/:id → {prescription}; 404 "Prescription not found".
- DELETE /prescriptions/:id → {ok}; medicines made from it keep working.
- POST /prescriptions/:id/apply {medicines: ExtractedMedicine[] (≥1, ≤20, user-edited), start_date?: YYYY-MM-DD, for_person?: ≤40}
  → {medications: MedicationClient[], prescription}. 409 `already_applied`; 400 "Add at least one medicine with a name." /
  "You can keep up to N medicines…"; 404. Server re-normalises rows with fromUser: keeps times / as_needed / timing / duration_days;
  frequency_text only feeds the repeat rule (days / every_n_days); default times ["08:00"] when empty & not SOS.
- PrescriptionClient = {id, user_id, media_id?, doctor?, issued_on?, notes?, patient_name?, medicines: ExtractedMedicine[],
  status: "review"|"applied", applied_medication_ids?, applied_at?, created_at, photo_url: string|null}.
- ExtractedMedicine = {name, strength?, form, dose, timing, times: HH:MM[], frequency_text, duration_days?, as_needed, instructions?, confidence?}.
  LOW_CONFIDENCE < 0.6 → "Hard to read — please check this one against your prescription."
- GET /meds/doses?at=<iso> → {now, doses: DoseItem[]} (every dose at that instant ±30 s, any status).
  GET /meds/doses → {now, doses (status "due"), next: DoseItem|null (next upcoming within 24 h)}.
- POST /meds/doses {medication_id, scheduled_for, action, snooze_minutes 5–60} → {dose}; 404 "Medicine not found";
  400 "That dose isn't on this medicine's schedule" (stale id / changed schedule / SOS) → treat as "already handled".
- Credits: GET /credits/balance via `useAiStatus()` from @/features/meals/api (ai_enabled + costs.scan, fallback 2).

## Library APIs
- pickPhotos(source, {multiple:false}) → PickedPhoto[] ([] cancel) / PhotoPermissionError{status, source}; toUploadDataUrl(uri) → {dataUrl, bytes} / PhotoError.
- TimePickerSheet / DatePickerSheet from @/features/meds/PickerSheets; QUICK_PATTERNS from @/features/meds/schedule;
  TIMING_OPTIONS / TIMING_INSTRUCTION / formatTime12 / clockIn / medicineTitle / scheduleSummary / doseKey / withAction / isOpen from @/features/meds/shared.
- medsApi.dose + medsKeys + putMedication from @/features/meds/api; emitDoseEvent from @/features/meds/events.
- router.dismissTo('/medicines') (expo-router 57) for "back to Medicines"; usePreventRemove from 'expo-router/react-navigation'.
- FlatList horizontal pagingEnabled for the alarm photo carousel; react-native-svg for the pill illustration; Reanimated 4 layout anims.

## Decisions
- Routes: rx/index (capture + scanning + problem panel + tips + history), rx/review?id= (editable review; no id → manual entry),
  rx/done?id= (success with created alarms). Scan result → push review. Apply → replace done.
- The picked photo travels capture → manual review via a tiny module store (src/features/rx/draft.ts) — data URLs are too big for params.
- Review rows are summary cards (include checkbox, warnings) + a bottom-sheet editor per medicine (name, strength, dose, quick
  pattern chips, time chips, food timing, days, SOS). frequency_text shown read-only "As written"; a quick pattern sets times +
  frequency_text. parseFrequency is NOT ported (same call as B2a).
- for_person is per prescription (apply body), with chips of people already used + the prescription's patient name hint.
- History: tap → Sheet with large photo + details + actions (Review / See medicines / Delete with confirm).
- Alarm: query key ['alarm', at|'due'] (outside medsKeys so meds invalidations don't reset it); every open dose gets its own card
  (photo carousel, details, Take / Snooze 10 min / Skip); "Take all" (confirm) when ≥2 open; handled doses collapse to a status row;
  auto-close 1.4 s after everything is handled; stale ids → "Already handled" state.

## Checklist
- [x] src/features/rx/types.ts
- [x] src/features/rx/api.ts
- [x] src/features/rx/rows.ts (row helpers + photo hand-off store; replaces draft.ts)
- [x] src/features/rx/problem.ts (AI / photo error classification)
- [x] src/features/rx/Viewfinder.tsx (photo frame + scanning animation)
- [x] src/features/rx/ProblemPanel.tsx (+ photo.ts: pickRxPhoto)
- [x] src/features/rx/HistoryList.tsx (+ detail sheet)
- [x] src/features/rx/ReviewRowCard.tsx
- [x] src/features/rx/RowEditorSheet.tsx
- [x] src/app/(app)/rx/index.tsx
- [x] src/app/(app)/rx/review.tsx
- [x] src/app/(app)/rx/done.tsx
- [x] src/features/alarm/api.ts
- [x] src/features/alarm/PhotoCarousel.tsx
- [x] src/features/alarm/PillIllustration.tsx (+ AlarmGlow.tsx)
- [x] src/features/alarm/AlarmDoseCard.tsx (+ HandledDoseRow)
- [x] src/app/(app)/alarm.tsx
- [x] npm run routes / typecheck / lint

## Status
All items built. `npm run typecheck` clean (whole project); `npx expo lint` clean for my files — the only remaining lint
error is in src/features/reminders/notifications.ts (another builder's in-progress file).
To verify on a device: nested sheet (TimePickerSheet opened from inside RowEditorSheet), alarm photo paging, Reduce Motion.
