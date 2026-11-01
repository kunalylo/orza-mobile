/// <reference types="node" />
/**
 * Rebalance at the safe floor — `npm run test:rebalance`. Pure texts in `src/features/rebalance/types.ts`, same rules
 * and wording as the web's RebalancePlanView (at the floor = usual − floor < 10; below = floor − usual ≥ 10).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { floorNote, isAtFloor, isBelowFloor, PRINCIPLES, trimTile, type CompensationSummary } from '../../src/features/rebalance/types';

function summary(over: Partial<CompensationSummary>): CompensationSummary {
  return {
    usual_calories: 2000,
    floor_calories: 1500,
    food_kcal: 600,
    activity_kcal: 300,
    released_kcal: 0,
    avg_daily_trim: 200,
    walk_minutes_per_day: 15,
    extra_steps_per_day: 1800,
    back_to_usual: '2026-11-05',
    ...over,
  };
}

describe('floor rules', () => {
  test('at = usual − floor < 10; below = floor − usual ≥ 10', () => {
    assert.equal(isAtFloor({ usual_calories: 1700, floor_calories: 1700 }), true);
    assert.equal(isAtFloor({ usual_calories: 1709, floor_calories: 1700 }), true);
    assert.equal(isAtFloor({ usual_calories: 1710, floor_calories: 1700 }), false);
    assert.equal(isAtFloor({ usual_calories: 1400, floor_calories: 1700 }), true);
    assert.equal(isBelowFloor({ usual_calories: 1691, floor_calories: 1700 }), false);
    assert.equal(isBelowFloor({ usual_calories: 1690, floor_calories: 1700 }), true);
  });
});

describe('Gentle trim tile', () => {
  test('normal plan', () => {
    assert.deepEqual(trimTile(summary({}), 200, 3), { v: '~200 kcal/day', note: 'Over 3 days, no skipped meals' });
    assert.deepEqual(trimTile(summary({}), 0, 1), { v: 'None needed', note: 'Over 1 day, no skipped meals' });
    assert.deepEqual(trimTile(undefined, 0, 2), { v: 'None needed', note: 'Over 2 days, no skipped meals' });
  });

  test('at the floor: None / Already at your safe minimum', () => {
    assert.deepEqual(trimTile(summary({ usual_calories: 1696, floor_calories: 1696, avg_daily_trim: 0 }), 0, 3), {
      v: 'None',
      note: 'Already at your safe minimum',
    });
  });

  test('below the floor: Already below your safe minimum', () => {
    assert.deepEqual(trimTile(summary({ usual_calories: 1400, floor_calories: 1700, avg_daily_trim: 0 }), 0, 3), {
      v: 'None',
      note: 'Already below your safe minimum',
    });
  });
});

describe('note under "ÖRZA says"', () => {
  test('nothing to say: normal plan, nothing released', () => {
    assert.equal(floorNote(summary({})), null);
    assert.equal(floorNote(undefined), null);
  });

  test('normal plan with calories released', () => {
    assert.equal(
      floorNote(summary({ released_kcal: 350 })),
      'Trims stay within a gentle range (never below 1,500 kcal a day) and walks stay comfortable, so the last ~350 kcal is simply left to even out naturally over the week.'
    );
  });

  test('at the floor, released / not released', () => {
    const at = { usual_calories: 1696, floor_calories: 1696 };
    assert.equal(
      floorNote(summary({ ...at, released_kcal: 400 })),
      "Your usual 1,696 kcal already sits at your body's safe floor, so ÖRZA doesn't trim meals, and walks stay comfortable — the last ~400 kcal is simply left to even out naturally over the week."
    );
    assert.equal(
      floorNote(summary({ ...at, released_kcal: 0 })),
      "Your usual 1,696 kcal already sits at your body's safe floor, so ÖRZA doesn't trim meals — a little extra movement balances this instead."
    );
  });

  test('below the floor, released / not released', () => {
    const below = { usual_calories: 1400, floor_calories: 1700 };
    assert.equal(
      floorNote(summary({ ...below, released_kcal: 250 })),
      "Your usual 1,400 kcal is already below the safe floor for your body (1,700 kcal), so ÖRZA won't trim further, and walks stay comfortable — the last ~250 kcal is simply left to even out naturally over the week."
    );
    assert.equal(
      floorNote(summary({ ...below, released_kcal: 0 })),
      "Your usual 1,400 kcal is already below the safe floor for your body (1,700 kcal), so ÖRZA won't trim further — a little extra movement balances this instead."
    );
  });

  test('principles: the floor rule says meals stay as they are', () => {
    assert.equal(
      PRINCIPLES[0].body,
      'At most 15% off your usual calories on any day, and never below a safe floor for your body — if your target is already at or under it, meals stay as they are.'
    );
  });
});
