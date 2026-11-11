/// <reference types="node" />
/**
 * A button's shorter label (`src/ui/fitLabel.ts`, `Button` `shortLabel`, `docs/notes/a11y-polish.md`) — `npm run
 * test:a11y`. Widths are the Rx screen's "Read prescription" button and the review footer's "Create alarms (3)", dp, as
 * the Figtree font measures them: each label's row (icon, gap, text) against the room inside the button (its width less
 * its padding and border) — default size = 411 dp at font 1.0, small = 360 dp at font 1.3.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { fitLabel } from '../../src/ui/fitLabel';

const READ = ['Read prescription · 2 credits', 'Read prescription'];
const READ_ROWS = { 'Read prescription · 2 credits': 315.6, 'Read prescription': 208.4 };

const CREATE = ['Create alarms (3)', 'Create alarms', 'Create'];

describe('fitLabel', () => {
  test('the full label while it fits (the default size)', () => {
    assert.equal(fitLabel(READ, { 'Read prescription · 2 credits': 248.5, 'Read prescription': 166.1 }, 293), READ[0]);
  });

  test('the shorter label when the full one would be cut (small phone, font 1.3)', () => {
    assert.equal(fitLabel(READ, READ_ROWS, 242), 'Read prescription');
  });

  test('a row that fits exactly (or measures a hair over) keeps the full label', () => {
    assert.equal(fitLabel(READ, READ_ROWS, 315.6), READ[0]);
    assert.equal(fitLabel(READ, READ_ROWS, 315.2), READ[0]);
    assert.equal(fitLabel(READ, READ_ROWS, 315), 'Read prescription');
  });

  test('the longest shorter label that fits, longest first', () => {
    const rows = { 'Create alarms (3)': 162.5, 'Create alarms': 135.7, Create: 79.3 };
    assert.equal(fitLabel(CREATE, rows, 193.5), 'Create alarms (3)'); // default size
    assert.equal(fitLabel(CREATE, rows, 142.5), 'Create alarms'); // 360 dp, font 1.0
    const large = { 'Create alarms (3)': 203.8, 'Create alarms': 168.9, Create: 95.6 };
    assert.equal(fitLabel(CREATE, large, 119.2), 'Create'); // 360 dp, font 1.3
  });

  test('the shortest when none fits (it is cut then, as before)', () => {
    assert.equal(fitLabel(CREATE, { 'Create alarms (3)': 300, 'Create alarms': 260, Create: 180 }, 150), 'Create');
  });

  test('the full label until every row and the room are measured', () => {
    assert.equal(fitLabel(READ, {}, 242), READ[0]);
    assert.equal(fitLabel(READ, { 'Read prescription · 2 credits': 315.6 }, 242), READ[0]);
    assert.equal(fitLabel(READ, READ_ROWS, 0), READ[0]);
    assert.equal(fitLabel(READ, READ_ROWS, -52), READ[0]); // the button not laid out yet: 0 minus its padding
  });
});
