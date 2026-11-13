/// <reference types="node" />
/**
 * Settings after the D3 decisions — `npm run test:settings`.
 *
 * - A1 Minimum age 18 (D1, `features/settings/options.ts` `PROFILE_LIMITS`, `profileDraft.ts` `buildPatch`): a new or
 *   changed age under 18 is refused; an age already saved under 18 isn't touched when other fields change.
 * - A2 "Help improve ÖRZA's AI" is opt-in (D2, `aiImprovementOn`): on only when the account stores
 *   `ai_training_opt_out: false` (the member's own switch); missing (every account that never chose: sign-up and
 *   onboarding never store it) or `true` is off. Works the same with an old server and a new one.
 * - A3 the switch's copy per platform.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DEFAULT_PREFERENCES, PROFILE_LIMITS, aiImprovementDescription, aiImprovementOn } from '../../src/features/settings/options';
import { buildPatch, type ProfileDraft } from '../../src/features/settings/profileDraft';

const BASE: ProfileDraft = {
  units: 'metric',
  name: 'Asha',
  age: '32',
  sex: 'female',
  height_cm: '160',
  height_ft: '',
  height_in: '',
  weight: '60',
  activity_level: 'light',
  diet: 'vegetarian',
  allergies: [],
  region: 'Maharashtra',
  language: 'en',
  household_mode: 'individual',
  lifestyle: '',
};

describe('A1 minimum age 18', () => {
  test('the limit', () => {
    assert.deepEqual(PROFILE_LIMITS.age, { min: 18, max: 100 });
  });
  test('17 is refused, 18 and 100 are saved, 101 is refused', () => {
    assert.equal(buildPatch({ ...BASE, age: '17' }, BASE).errors.age, 'Age must be between 18 and 100');
    assert.equal(buildPatch({ ...BASE, age: '13' }, BASE).errors.age, 'Age must be between 18 and 100');
    assert.equal(buildPatch({ ...BASE, age: '18' }, BASE).patch.profile.age, 18);
    assert.equal(buildPatch({ ...BASE, age: '100' }, BASE).patch.profile.age, 100);
    assert.equal(buildPatch({ ...BASE, age: '101' }, BASE).errors.age, 'Age must be between 18 and 100');
  });
  test('a member saved under 18 can still change other fields (their age is left alone)', () => {
    const minor = { ...BASE, age: '16' };
    const r = buildPatch({ ...minor, weight: '58' }, minor);
    assert.equal(r.errors.age, undefined);
    assert.equal('age' in r.patch.profile, false);
    assert.equal(r.changed, true);
  });
});

describe('A2 Help improve ÖRZA’s AI: opt-in', () => {
  test('missing means off (never chosen; old and new servers alike)', () => {
    assert.equal(aiImprovementOn({}), false);
    assert.equal(aiImprovementOn({ units: 'metric', reminders: true, weekly_report: true, tone: 'gentle' }), false);
    assert.equal(aiImprovementOn(undefined), false);
    assert.equal(aiImprovementOn(null), false);
  });
  test('only the member’s own “on” (false stored) is on; true is off', () => {
    assert.equal(aiImprovementOn({ ai_training_opt_out: false }), true);
    assert.equal(aiImprovementOn({ ai_training_opt_out: true }), false);
  });
  test('the default the screen merges under the account’s values is off', () => {
    assert.equal(DEFAULT_PREFERENCES.ai_training_opt_out, true);
    assert.equal(aiImprovementOn({ ...DEFAULT_PREFERENCES, ...{} }), false);
    assert.equal(aiImprovementOn({ ...DEFAULT_PREFERENCES, ...{ ai_training_opt_out: false } }), true);
  });
});

describe('A3 copy', () => {
  test('iPhone: no Health Connect', () => {
    const ios = aiImprovementDescription('ios');
    assert.equal(
      ios,
      'Lets your conversations and logs, anonymized first, help make ÖRZA’s AI better. It’s off unless you turn it on. Steps and anything read from Apple Health or your iPhone’s motion sensor are never used for this. AI features work the same whether it’s on or off.'
    );
    assert.ok(!ios.includes('Health Connect'));
  });
  test('Android', () => {
    assert.equal(
      aiImprovementDescription('android'),
      'Lets your conversations and logs, anonymized first, help make ÖRZA’s AI better. It’s off unless you turn it on. Steps and anything read from Apple Health, Health Connect or your phone’s motion sensor are never used for this. AI features work the same whether it’s on or off.'
    );
  });
});
