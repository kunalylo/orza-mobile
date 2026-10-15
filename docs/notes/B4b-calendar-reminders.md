# B4b — Calendar + Reminders (notes / resume file)

Ownership: src/app/(app)/calendar.tsx, src/app/(app)/reminders.tsx, src/features/calendar/**, src/features/reminders/**.

## Endpoints (exact contracts from E:\aylo\orza)
- GET /api/calendar → {tz, feed: {feed_url, webcal_url} | null, is_local, external: ExternalCalendarState}
- GET /api/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD (local days, inclusive, ≤ 62 days) → {from, to, tz, events: CalendarEvent[], external}
  - CalendarEvent {id, kind: medication|reminder|meal|external, title, subtitle?, start (ISO UTC; all-day: local date), end?, all_day, color, url?, photo_url?, status?, busy?, location?, calories?}
  - ids: `med_<medId>_<iso>`, `rem_<remId>_<iso>`, `meal_<id>`, external ids. 400 bad dates / range.
- POST /api/calendar/token → {feed_url, webcal_url, is_local} (create/rotate); DELETE /api/calendar/token → {ok}
- PUT /api/calendar/external {url (1..2048, https:// or webcal://)} → {external, upcoming_count}; errors `calendar_*` (4xx/502), 429 rate_limited
  DELETE /api/calendar/external → {ok}
- GET /api/reminders → {reminders: ReminderView[]} (active first, by first time)
- POST /api/reminders {kind, title(1..80), body?(≤240), schedule {times[1..24] HH:MM, days 0..6[]}, channels?, active?} → 201 {reminder}; 409 code `limit` (50 max)
- PATCH /api/reminders/[id] (partial; body null clears) → {reminder}; DELETE → {ok}; 404 not found
- GET /api/integrations → IntegrationsView {push, whatsapp {configured, mode, phone, opt_in}, calendar, health, quiet_hours {start,end}|null, reminders_enabled, timezone}
- PUT /api/integrations/quiet-hours {start, end} | {start:null,end:null} → IntegrationsView; 400 messages
- PUT /api/settings/preferences {reminders: true} → {user} (resume paused reminders; setUser)
- PUT /api/integrations/whatsapp {phone (E.164)|null, opt_in} → IntegrationsView; POST /api/integrations/whatsapp/test → {ok, mode, image, session_only}; 429 / 502 / 503

## Library APIs
- expo-calendar v57 default import = NEW object API: requestCalendarPermissions(writeOnly=false) / getCalendarPermissions(),
  getCalendars(EntityTypes.EVENT), createCalendar({title, color, entityType, sourceId?, source, name, ownerAccount, accessLevel}) → ExpoCalendar,
  ExpoCalendar.get(id) (throws if gone), cal.listEvents(start, end), cal.createEvent({title, notes, startDate, endDate, timeZone, alarms:[{relativeOffset:0, method: AlarmMethod.ALERT}], url}),
  ExpoCalendarEvent.get(id) → ev.update()/delete(), cal.delete().
  iOS: full access needed to create calendars (writeOnly can't); source omitted → native uses defaultCalendarForNewEvents.source (getDefaultCalendarSync().sourceId passed explicitly).
  Android: source {isLocalAccount: true, name: 'ÖRZA', type: LOCAL}, ownerAccount 'ÖRZA', accessLevel OWNER. Not in Expo Go / web.
- expo-notifications: getPermissionsAsync / requestPermissionsAsync (Android 13+: a channel must exist before the prompt → create 'reminders' channel first).
- expo-clipboard setStringAsync; RN Share.share; Linking.openURL(webcal / google subscribe url), Linking.openSettings.
- expo-secure-store (calendar id under own key) + expo-file-system File(Paths.document, 'orza-phone-calendar.json') for the event-id map.

## Decisions
- Phone calendar sync = medicine doses (all) + reminders whose channels.calendar is on, next 14 local days, future starts only.
  Diff sync: map serverEventId → {eventId, sig, start}; unchanged sig kept, changed → update, new → create, removed (future) → delete.
  Lost map but calendar exists → wipe future events in our calendar first (no duplicates). Calendar found again by stored id, else by title 'ÖRZA'.
- Calendar screen: month grid (Mon-first) + selected-day agenda + insights (busy-day port), phone calendar card, feed subscribe card, connect card.
- Reminders screen: paused banner, notifications permission card, presets, list with Switch, ReminderSheet (kind/title/message/times/repeat/days/channels/active/delete),
  medicines card, WhatsApp card (only when configured), quiet hours, how-it-works.
- Time pickers: reuse TimePickerSheet from features/meds/PickerSheets (rendered inside my Sheet tree so nested modals present on iOS).

## Checklist
- [x] src/features/reminders/types.ts
- [x] src/features/reminders/shared.ts
- [x] src/features/reminders/api.ts
- [x] src/features/reminders/ReminderRow.tsx
- [x] src/features/reminders/ReminderSheet.tsx
- [x] src/features/reminders/NotificationsCard.tsx
- [x] src/features/reminders/QuietHoursCard.tsx
- [x] src/features/reminders/WhatsAppCard.tsx
- [x] src/features/reminders/parts.tsx (IconTile, CardHeader, BrandSwitch, SwitchRow, ConfirmStrip — also used by calendar)
- [x] src/features/reminders/notifications.ts (permission hook + Android "reminders" channel)
- [x] src/app/(app)/reminders.tsx
- [x] src/features/calendar/types.ts
- [x] src/features/calendar/utils.ts
- [x] src/features/calendar/api.ts
- [x] src/features/calendar/deviceCalendar.ts
- [x] src/features/calendar/MonthGrid.tsx
- [x] src/features/calendar/DayAgenda.tsx
- [x] src/features/calendar/PhoneCalendarCard.tsx
- [x] src/features/calendar/SubscribeCard.tsx
- [x] src/features/calendar/ConnectCard.tsx
- [x] src/app/(app)/calendar.tsx
- [x] npm run typecheck + npx expo lint clean

## Status (resumed session)
- All calendar components + screen were already on disk (checkpoint commit 081bb61); reviewed for completeness and consistency.
- `npm run typecheck` clean (routes regenerated), `npx expo lint` clean for the whole project.
- iOS full-access calendar usage string comes from the expo-calendar plugin's `calendarPermission` (sets NSCalendarsFullAccessUsageDescription).
