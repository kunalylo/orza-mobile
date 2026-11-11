/**
 * Which label a button shows (`Button` `shortLabel`, `docs/notes/a11y-polish.md`). Pure — `npm run test:a11y`.
 *
 * `labels` is the full label first, then shorter ones, longest first. `natural` holds each label's row (icons, gaps
 * and text) at its natural width, `room` the width inside the button for that row, both in dp as measured on screen.
 */

/** Text measures can land a hair over a row that fits exactly. */
const SLACK = 0.5;

/** The longest label whose row fits `room`, else the last (shortest); the full label until everything is measured. */
export function fitLabel(labels: readonly string[], natural: Readonly<Record<string, number>>, room: number): string {
  if (room <= 0 || labels.some((l) => natural[l] == null)) return labels[0];
  return labels.find((l) => natural[l] <= room + SLACK) ?? labels[labels.length - 1];
}
