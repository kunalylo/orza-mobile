# Accessibility polish — 48 dp touch targets and labels at large text (pre-release)

Date: 2026-11-11. Follow-ups from the device runs: steps-v2-V1 run 6 (U6: the app's other native switches, the sheet close
button and the header icon buttons under 48 dp) and AI consent AC-10 (`ai-consent.md` §10.4: the Ask ÖRZA header icons,
mic, send and chips under 48 dp; the Rx and Snap buttons cut at 360 dp with font 1.3). Code only — no build, no emulator
in this run; the device check list is at the end.

Sizes as in the device runs: **default** = 411 dp wide at font 1.0 (the emulator's 1080x2400 @ 420); **small** = 360 dp
at font 1.3 (the worst case). "Target" = what takes a touch: the view's bounds plus its hit slop.

## How touch targets work here (and what limits them)

- A React Native pressable takes touches in its bounds plus `hitSlop`, even outside its parent (Fabric counts children's
  slop in the parent's overflow inset) — but not past a scroll view's or an `overflow: hidden` view's edge.
- Where two targets overlap, the **later sibling wins** (Android's touch target search goes last child first). So a slop
  that reaches a neighbour takes the neighbour's edge. Rule used: between two small controls the slop stops at half the
  gap (0 when they touch) — `IconButton`'s new `hitSlop` prop sets single sides.
- **A text or an empty view is a target too**: laid out after a small control, it wins the touches in its own bounds, so
  a slop or a switch box that reaches over it is lost there. The control's row gets `zIndex: 1` instead, so the search
  meets it first (Fabric mounts siblings in zIndex order; layout and reading order don't change): the Snap result's
  "ÖRZA analysis" line over the dish name, the recipe screen's "Created by ÖRZA AI" line over the title, the recipe
  card's head (Another / Close) over its title. Not a `pointerEvents="none"` wrapper around the heading: on Android
  that view also stops hover events, which TalkBack's explore by touch needs to focus the heading. A container whose
  top is empty gets `box-none` (the stock fields under "Remind me to refill": its children still take touches).
- A **native switch gets no slop**: on Android it takes touches only inside its own bounds, and only when every parent's
  bounds hold the point too. So the switch itself must be 48 × 48 dp, and a row with no padding around it needs slack.
- Android's guideline is 48 × 48 dp (Apple's 44 pt). `layout.hit` was 44; it is now 48.

## 1. Touch targets — before → after (dp)

### Switches: one shared `ui/Switch` (Android: the 48 × 48 dp box; iOS unchanged)

The native switch is 46 × 27 dp. `ui/Switch` gives it `minWidth / minHeight 48` (the track is drawn centred top to bottom
and at the box's end, as `StepsSwitch` showed in V1 run 6) and, by default (`fit="native"`), negative margins
(−10.5 dp above / below, −2 dp at the start) so the row's layout doesn't move. `switchRowSlack()` is for a row with no
padding around the switch: padding + the same negative margin (+ the row's own margins) and `pointerEvents: box-none`, so
the row's wider bounds pass other touches through. `fit="box"` lays the whole box out (the steps switch, as before).

| Where | Component | Before → after |
|---|---|---|
| Settings › Preferences and the other toggle rows | `features/settings/parts.tsx` `ToggleRow` (16 dp row padding holds the box) | 46 × 27 → **48 × 48** |
| Reminders list row, reminder sheet rows, Quiet hours header | `features/reminders/parts.tsx` `BrandSwitch` (`SwitchRow`, `ReminderRow`, `CardHeader` `right`) | 46 × 27 → **48 × 48**; `CardHeader` (40 dp row) gets `switchRowSlack` on the row and the header |
| Medicine editor › Track stock "Remind me to refill" | `app/(app)/med/edit.tsx` (row had no padding → `switchRowSlack({bottom: 4})`; the stock fields under it are `box-none`, their empty top took 6.5 dp) | 46 × 27 → **48 × 48** |
| Prescription row editor "SOS — only when needed" | `features/rx/RowEditorSheet.tsx` (`switchRowSlack({top: 16})`) | 46 × 27 → **48 × 48** |
| Health card + Settings › Privacy "Count steps automatically" | `features/health/StepsSwitch.tsx` → `Switch fit="box"`, spinner `switchBoxStyle` | 48 × 48 (V1 F1) → same, now the shared component |

### Icon buttons: `IconButton` slop up to `layout.hit` = 48 (was 44), app-wide

| Where | Size | Before → after target |
|---|---|---|
| Every sheet's close (X), `ui/Sheet` | 36 | 44 → **48** |
| Pushed screens' back / close, `ui/ScreenHeader` (Health, Rx, Settings pages, …) | 40 | 44 → **48** |
| Header right buttons: Health refresh, Meals camera, Medicines +, Snap meal log, Goals, medicine Edit, Reminders +, Reports share; alarm close; calendar link Copy / Share | 44 | 44 → **48** |
| Ask ÖRZA header: back, Your conversations, New chat (8 dp apart: slops meet, no overlap) | 40 | 44 → **48** |
| Recipe header, onboarding header, month arrows (calendar, pickers, reports), conversation / plan / food-item delete, alarm photo arrows | 40 | 44 → **48** (plan delete 44 wide: its card clips the right side) |
| Today water − / + (8 dp apart: slops overlap only in the gap), dose full-screen button, meal-log month arrows | 38 | 44 → **48** |
| What ÖRZA remembers X, meal-logged X | 36 | 44 → **48** |
| Targets callout X | 32 | 44 → **48** |
| Medicine photo star / remove (the tile clips at 6 dp outside) | 30 | 43 → **45** |
| Meal card Edit + Delete (2 dp apart) → `hitSlop` 1 on the facing sides | 36 | 44 tall; Edit lost 2 dp to Delete → **48 tall × 43 wide** each, neither takes the other's edge |
| Recipe result Another + Close (4 dp apart) → 2 on the facing sides; the head is `zIndex: 1` over the title 4 dp under them (it took 2 dp) | 36 | → **48 tall × 44 wide** each |
| Rx review row Edit over Remove (touching) → 0 on the facing sides | 36 | Remove took 4 dp of Edit → **48 wide × 42 tall** each |
| Meal item stepper +, meal-log day › (flush against the field / the date) → left 0 | 36 / 32 | took 4 dp of the field / date → **48 tall × 42 wide** (compact stepper 40), the field and date keep their edges; the date button's own slop is now top / bottom only (it took 4 dp of ‹) |
| Medicine alarm-time chip X (flush against the time) → left 0 | 32 | took 6 dp of the time → **48 tall × 40 wide** |
| Weight sheet − / + | 52 | 52 (unchanged) |

### Chat and chips

| Where | Before → after |
|---|---|
| Ask ÖRZA mic (`features/chat/Composer.tsx`) | 40 + slop 4 = 48 (unchanged; bounds 40) |
| Ask ÖRZA send | 40 → **48** (slop 4: the field's 5 dp padding and the 4 dp gap hold it) |
| Ask ÖRZA quick-action strip chips (compact, 34–35) | 35 → **49** (slop 7; the strip gets 7 dp of top padding pulled back by a −7 margin into the footer's padding — nothing moves) |
| Ask ÖRZA welcome: starter chips (40) / quick chips (compact 34), wrapping rows 8 dp apart | 40 → **48** / 34 → **42** (slop 4 = half the row gap) |
| `ui/Chip` md (42) / sm (32), wrapping rows 8 dp apart everywhere | 42 → **48** (slop 3) / 32 → **40** (slop 4) |

### Not changed (limits, noted)

- Welcome quick chips 42 and `Chip` sm 40: rows are 8 dp apart, so 48 would take the next row's edge.
- Conversation delete (Ask's list) and plan delete (Rebalance history) keep their even slop over the row beside them: the
  row's main button loses 4 dp at its far edge; both deletes ask first.
- Ask ÖRZA's voice-language pill (about 22 dp + 6 dp slop): the composer is 6 dp above it; more slop would take the send
  and mic edges.
- `Button size="sm"`: 38 + 6 = 50 (unchanged). iOS switches: unchanged (UISwitch keeps its 51 × 31 pt).

## 2. Labels cut at 360 dp with font 1.3 — a shorter label when the full one can't fit

`Button` has a new `shortLabel` (one, or a list longest first): an invisible copy measures each label's row (icon, gap,
text) at its natural width, the button's width less its padding and border is the room, and `ui/fitLabel.ts` picks the
longest that fits (the last if none does; the full label until all are measured). Measured on screen, so it follows the
screen width and font scale (V1 F2 / AC-10's idea, without the hand-measured constants). TalkBack keeps the full label
(`accessibilityLabel`), and each short label is part of it. Only for a button whose row sets its width (`block`, or flex
in a row). `npm run test:a11y` (6 cases).

Estimates below are Figtree's own advance widths (scripted from the font file; "Connect Health Connect" came out at
198.5 dp, the device measured 197) and the screens' paddings: row needed vs room inside the button, dp.

| Screen / button | Full label | Short label(s) | Small (360 dp, 1.3) | 360 dp at 1.0 | Default |
|---|---|---|---|---|---|
| Rx, with a photo (lg energy, block) | Read prescription · 2 credits | Read prescription | 316 vs 242 → short (208) | 249 vs 242 → short | full (249 vs 293) |
| Rx, under the actions (sm ghost) | Prefer typing? Enter medicines manually | Enter medicines manually | 358 vs 266 → short (235) | 281 vs 266 → short | full (281 vs 317) |
| Rx, AI off, no photo (lg primary) | Type the medicines instead | Type the medicines | 309 vs 242 → short (228) | 243 vs 242: borderline | full |
| Snap, ready (lg energy, block) | Analyse photo · 2 credits | Analyse photo | 281 vs 268 → short (174) | full | full |

The Rx "Prefer typing?" button is now `block` so its row sets its width: a ghost button has no background or border, so
it looks as before (label centred); its touch area spans the row.

## 3. The same risk elsewhere — fixed

Found by listing every `Button` that shares a row with another button and estimating both sizes. Two patterns:

**A single long label beside a short fixed button → `shortLabel`:**

| Screen / button | Full label | Short label(s) | Small (360, 1.3) | 360 at 1.0 | Default |
|---|---|---|---|---|---|
| Medicine editor footer, beside Cancel | Save changes / Add & set alarms / Add medicine | Save / Add | cut (164 / 194 / 164 vs 163) → short | full | full |
| Rx row editor footer, beside Cancel (lg) | Add medicine | Add | 168 vs 137 → short | full | full |
| Rx review footer, beside Start over (lg) | Create alarms (3) | Create alarms, Create | 204 vs 119 → Create | 163 vs 143 → Create alarms | full (163 vs 194) |
| Rx history sheet, beside Delete | Review & create alarms / See medicines | Create alarms, Review / Medicines | 260 vs 141 → Review; 171 vs 141 → Medicines | 206 vs 156 → Create alarms | full (206 vs 207: fits by 2 dp — check) |
| Recipe result card, beside Save | View full recipe | Full recipe, View | 182 vs 116 → View | 145 vs 128 → Full recipe | full (145 vs 179) |
| Change password footer, beside Clear | Update password | Update | 202 vs 179 → short | full | full |

**Two equal buttons → D1's pattern** (row `flexWrap`, buttons `flexGrow 1 / flexShrink 1 / flexBasis 0` + `minWidth`
= the wider one at font 1 × font scale): equal halves while both fit, stacked full width otherwise. Default size checked:
both minimums fit beside each other, so it looks as before.

| Screen | Buttons | Min width | Small (360, 1.3) | 360 at 1.0 | Default |
|---|---|---|---|---|---|
| Rx scan, no photo (lg) | Take photo / Upload | 168 | stacked (was cut) | stacked (was cut: 167 vs 143) | halves (2 × 168 + 8 = 344 ≤ 345) |
| Delete account sheet | Keep my account / Delete forever | 178 | stacked (both were cut) | stacked (were cut) | halves (364 ≤ 371) |
| Rx done | Notifications / Scan another | 168 | stacked (both were cut) | stacked (were cut) | halves |
| Recipe detail footer | Save recipe / Log 1 serving | 167 | stacked (both were cut) | stacked ("Log 1 serving" was cut) | halves |
| Medicine editor photos (sm) | Take photo / From gallery | 131 | stacked (both were cut) | halves | halves |
| Request credits sheet | Cancel (⅓) / Send request (⅔) | 94 / 168 | stacked ("Cancel" was cut) | ⅓ / ⅔ | ⅓ / ⅔ |

Checked and left: Rx Retake / Gallery (fit at 1.3 by ~7 dp), Settings save bars (fit at 1.3 by ~4 dp), Snap's Retake / Gallery and the
out-of-credits panel, Today's medicine actions (already wrap), the AI turn-off confirm, the steps off sheet, Health's
connected card and the alarm's Snooze / Skip (already D1's pattern), the Rx problem panel (AC-10's own short label).

### New copy for the user's review

Short labels shown only when the full one can't fit: "Read prescription", "Enter medicines manually", "Type the
medicines" (also for the no-photo case now), "Analyse photo", "Save", "Add", "Create alarms", "Create", "Review",
"Medicines", "Full recipe", "View", "Update".

## Checks (this run)

`npm run typecheck`, `npx expo lint`, `npm run test:ai` 32 / 32, `npm run test:steps` 419 / 419, `npm run test:alarms`
69 / 69, `npm run test:a11y` 6 / 6 (new). No build, no emulator, no server calls.

## Device check list (later, release-type test build; `a11y.mjs` for bounds, screenshots for the look)

Default size and small (`wm size 720x1280`, `wm density 320`, `font_scale 1.3`); reset after.

1. **Look unchanged at the default size**: Settings › Preferences, Reminders (list, a reminder's sheet, Quiet hours on /
   off), the medicine editor (stock switch, footer, photos), the Rx row editor (SOS row), Health (steps card), Ask ÖRZA
   (header, composer, quick-action strip, welcome chips), a sheet header, a meal card, the Rx scan / review / done
   screens, a recipe card and detail, the delete-account and request-credits sheets — compare with earlier shots
   (`steps-v2-V1-shots/`, `ai-consent-shots/`). The switch track is where it was and centred in its row.
2. **Switch boxes**: `a11y.mjs` shows each switch 48 × 48 (above). Tap 8–9 px inside the box's top and bottom edges
   (outside the old 27 dp track) on: a Preferences row, a reminder row, Quiet hours, "Remind me to refill", SOS — each
   toggles. Then tap just outside the box (the row's text, the neighbour above / below): nothing toggles, and the
   neighbour (a stock field, a chip) still takes its own taps.
3. **Icon buttons**: tap 5 dp outside a sheet's X (36 dp), a header back (40), Ask's send — each fires. Meal card Edit /
   Delete, recipe Another / Close, Rx review Edit / Remove: a tap at each button's inner edge fires that button, not the
   neighbour. Meal item stepper and the meal-log day bar: a tap at the field's / date's right edge opens the field /
   date picker (not +1 / next day).
4. **Chips**: Ask's quick-action strip — a tap 6 dp above a chip fires it; the strip and the composer haven't moved. A
   welcome-screen chip row: a tap between two rows goes to the nearer chip.
5. **Labels, small size**: Rx with a photo → "Read prescription" and "Enter medicines manually", nothing cut, TalkBack
   reads "Read prescription · 2 credits" / "Prefer typing? Enter medicines manually"; Rx with AI off; Snap ready →
   "Analyse photo"; medicine editor footer ("Add" / "Save"); Rx row editor ("Add"); Rx review footer ("Create");
   prescription history sheet ("Review" / "Medicines"); recipe card ("View"); change password with a change typed
   ("Update"). At the default size each shows its full label (and the history sheet's "Review & create alarms" isn't
   cut — it fits by about 2 dp on paper).
6. **Stacked pairs, small size**: Rx scan with no photo, delete-account sheet, Rx done, recipe detail footer, medicine
   photos, request credits — the two buttons stack full width with full labels; at the default size they sit side by
   side as before.
7. **No flicker**: opening those screens at the small size, the short label settles at once (one frame of the full label
   at most) and doesn't switch back and forth; rotating the font scale back to 1.0 with the app open brings the full
   labels back.
