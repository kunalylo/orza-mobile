/// <reference types="node" />
/**
 * Reporting ÖRZA's AI output (`docs/notes/ai-report.md` §2, §3, §5, §8) — `npm run test:report`. Pure:
 * `lib/aiReport.ts` decides where Report shows, the request body, how an older server looks and every string;
 * `features/ai/*` renders the trigger and the sheet and sends the report.
 *
 * - R1 the server's lists (kinds, reasons, note limit, path) and no AI consent for a report.
 * - R2 `reportBody` / `reportNote`: trimmed, empty = left out, at most 500 characters, never half an emoji.
 * - R3 `isReportAnswer`: only `{report: {id}}` counts as sent.
 * - R4 `isReportUnavailable`: an older server (the framework's 404, a 405 / 501), not the route's own answers.
 * - R5 where Report shows: every stored ÖRZA reply, AI recipes, AI plans, AI-read typed / spoken meals.
 * - R6 the items reported this visit.
 * - R7 copy (§5, the website's words).
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { isAiPath } from '../../src/lib/aiConsent';
import {
  AI_REPORT_KINDS,
  AI_REPORT_NOTE_MAX,
  AI_REPORT_PATH,
  AI_REPORT_REASONS,
  REPORT_COPY,
  REPORT_REASONS,
  canReportChat,
  canReportMeal,
  canReportPlan,
  canReportRecipe,
  createReportedSet,
  isReportAnswer,
  isReportUnavailable,
  noteCounter,
  reportBody,
  reportHint,
  reportKey,
  reportNote,
  reportTitle,
  reportTriggerLabel,
} from '../../src/lib/aiReport';

describe('R1 the contract', () => {
  test('the same kinds, reasons and note limit as the server', () => {
    assert.deepEqual([...AI_REPORT_KINDS], ['chat', 'recipe', 'rebalance', 'scan', 'meal']);
    assert.deepEqual([...AI_REPORT_REASONS], ['offensive', 'unsafe', 'wrong', 'other']);
    assert.equal(AI_REPORT_NOTE_MAX, 500);
    assert.equal(AI_REPORT_PATH, '/ai/reports');
  });

  test('a report is not an AI request: the consent backstop lets it through', () => {
    assert.equal(isAiPath(AI_REPORT_PATH), false);
    assert.equal(isAiPath('/api/ai/reports'), false);
  });
});

describe('R2 the request body', () => {
  test('kind, ref_id and reason; no note when there is none', () => {
    assert.deepEqual(reportBody('chat', 'm1', 'offensive'), { kind: 'chat', ref_id: 'm1', reason: 'offensive' });
    assert.deepEqual(reportBody('recipe', 'r1', 'wrong', ''), { kind: 'recipe', ref_id: 'r1', reason: 'wrong' });
    assert.deepEqual(reportBody('scan', 's1', 'other', '   \n  '), { kind: 'scan', ref_id: 's1', reason: 'other' });
    assert.deepEqual(reportBody('meal', 'x', 'unsafe', null), { kind: 'meal', ref_id: 'x', reason: 'unsafe' });
  });

  test('the note is trimmed and keeps its line breaks; the id is trimmed', () => {
    assert.deepEqual(reportBody('rebalance', ' p1 ', 'unsafe', '  Too little food.\nDay 2 is 900 kcal.  '), {
      kind: 'rebalance',
      ref_id: 'p1',
      reason: 'unsafe',
      note: 'Too little food.\nDay 2 is 900 kcal.',
    });
  });

  test('at most 500 characters, never cutting an emoji in half', () => {
    assert.equal(reportNote('a'.repeat(500)), 'a'.repeat(500));
    assert.equal(reportNote('a'.repeat(501)), 'a'.repeat(500));
    // An emoji is two UTF-16 units; one straddling the limit is left out whole.
    const straddle = reportNote('a'.repeat(499) + '😀');
    assert.equal(straddle, 'a'.repeat(499));
    assert.equal(reportNote('a'.repeat(498) + '😀'), 'a'.repeat(498) + '😀');
    assert.equal(reportNote('a'.repeat(498) + ' ' + 'b'.repeat(10)), 'a'.repeat(498) + ' b');
    assert.equal(reportNote('a'.repeat(499) + ' ' + 'b'.repeat(10)), 'a'.repeat(499));
  });
});

describe('R3 the answer', () => {
  test('201 / 200 {report: {id}} is a recorded report', () => {
    assert.equal(isReportAnswer({ report: { id: 'r1', kind: 'chat' } }), true);
  });

  test('anything else is not', () => {
    for (const res of [null, undefined, '', '<html>', {}, { ok: true }, { report: null }, { report: {} }, { report: { id: '' } }, { report: { id: 7 } }]) {
      assert.equal(isReportAnswer(res), false, JSON.stringify(res));
    }
  });
});

describe('R4 an older server', () => {
  test("the framework's 404 (no route code), a 405 or a 501: reporting isn't available", () => {
    assert.equal(isReportUnavailable({ status: 404, code: 'http_404' }), true);
    assert.equal(isReportUnavailable({ status: 404 }), true);
    assert.equal(isReportUnavailable({ status: 405, code: 'http_405' }), true);
    assert.equal(isReportUnavailable({ status: 501, code: 'http_501' }), true);
  });

  test("the route's own answers are shown as the server words them", () => {
    assert.equal(isReportUnavailable({ status: 404, code: 'not_found' }), false); // the item is gone, or not the member's
    for (const status of [0, 400, 401, 403, 413, 415, 429, 500, 502]) {
      assert.equal(isReportUnavailable({ status, code: status ? `http_${status}` : 'network' }), false, String(status));
    }
    assert.equal(isReportUnavailable(null), false);
    assert.equal(isReportUnavailable(new Error('boom')), false);
    assert.equal(isReportUnavailable('404'), false);
  });
});

describe('R5 where Report shows', () => {
  test('every ÖRZA reply the server stored, the built-in coach too', () => {
    assert.equal(canReportChat({ role: 'assistant', id: 'a1' }), true);
    assert.equal(canReportChat({ role: 'assistant', id: 'a2', status: undefined }), true);
  });

  test("never the member's own message or a local one", () => {
    assert.equal(canReportChat({ role: 'user', id: 'u1' }), false);
    assert.equal(canReportChat({ role: 'assistant', id: 'tmp-1731300000000' }), false);
    assert.equal(canReportChat({ role: 'assistant', id: 'a3', status: 'sending' }), false);
    assert.equal(canReportChat({ role: 'assistant', id: 'a4', status: 'failed' }), false);
    assert.equal(canReportChat({ role: 'assistant', id: '' }), false);
  });

  test('recipes and plans the AI wrote', () => {
    assert.equal(canReportRecipe({ source: 'ai' }), true);
    assert.equal(canReportRecipe({ source: 'library' }), false);
    assert.equal(canReportRecipe({}), false);
    assert.equal(canReportPlan({ ai: true }), true);
    assert.equal(canReportPlan({ ai: false }), false);
    assert.equal(canReportPlan({}), false);
  });

  test('a typed or spoken meal the AI read; not the food list, a manual, chat or photo meal', () => {
    assert.equal(canReportMeal({ ai: true, meal: { source: 'text' } }), true);
    assert.equal(canReportMeal({ ai: true, meal: { source: 'voice' } }), true);
    assert.equal(canReportMeal({ ai: false, meal: { source: 'text' } }), false);
    assert.equal(canReportMeal({ ai: true, meal: { source: 'manual' } }), false);
    assert.equal(canReportMeal({ ai: true, meal: { source: 'chat' } }), false);
    // A saved Snap is reported as the scan, before Save.
    assert.equal(canReportMeal({ ai: true, meal: { source: 'photo' } }), false);
  });
});

describe('R6 reported this visit', () => {
  test('per kind and id; adding twice tells listeners once', () => {
    const set = createReportedSet();
    let calls = 0;
    const off = set.subscribe(() => {
      calls += 1;
    });
    assert.equal(set.has('chat', 'a1'), false);
    set.add('chat', 'a1');
    set.add('chat', 'a1');
    assert.equal(set.has('chat', 'a1'), true);
    assert.equal(set.has('recipe', 'a1'), false);
    assert.equal(calls, 1);
    assert.equal(reportKey('chat', 'a1'), 'chat:a1');
    off();
    set.add('scan', 's1');
    assert.equal(calls, 1);
  });

  test('another member starts with nothing reported', () => {
    const set = createReportedSet();
    let calls = 0;
    set.subscribe(() => {
      calls += 1;
    });
    set.clear(); // nothing to clear: no call
    set.add('meal', 'm1');
    set.clear();
    assert.equal(set.has('meal', 'm1'), false);
    assert.equal(calls, 2);
  });
});

describe('R7 copy', () => {
  test('the reasons, in order', () => {
    assert.deepEqual(REPORT_REASONS, [
      { value: 'offensive', label: 'Offensive or hurtful' },
      { value: 'unsafe', label: 'Unsafe advice' },
      { value: 'wrong', label: 'Wrong or misleading' },
      { value: 'other', label: 'Something else' },
    ]);
  });

  test('title and hint name what is reported', () => {
    assert.equal(reportTitle('chat'), 'Report this reply');
    assert.equal(reportTitle('recipe'), 'Report this recipe');
    assert.equal(reportTitle('rebalance'), 'Report this plan');
    assert.equal(reportTitle('scan'), 'Report this result');
    assert.equal(reportTitle('meal'), 'Report this result');
    assert.equal(reportHint('chat'), 'The team sees this reply with your report.');
    assert.equal(reportHint('rebalance'), 'The team sees this plan with your report.');
  });

  test('the trigger before and after a report', () => {
    assert.equal(REPORT_COPY.trigger, 'Report');
    assert.equal(REPORT_COPY.reported, 'Reported');
    assert.equal(reportTriggerLabel('recipe', false), 'Report this recipe');
    assert.equal(reportTriggerLabel('recipe', true), 'Reported. Change your report');
  });

  test('the sheet, the toast and the older-server line', () => {
    assert.equal(REPORT_COPY.lead, 'Tell the ÖRZA team what’s wrong. We use reports to make ÖRZA’s AI safer.');
    assert.equal(REPORT_COPY.question, 'What’s wrong?');
    assert.equal(REPORT_COPY.noteLabel, 'Anything to add? (optional)');
    assert.equal(REPORT_COPY.send, 'Send report');
    assert.equal(REPORT_COPY.cancel, 'Cancel');
    assert.equal(REPORT_COPY.sent, 'Report sent. Thanks. The ÖRZA team will review it.');
    assert.equal(REPORT_COPY.unavailable, 'Reporting isn’t available yet. Please try again later.');
  });

  test('the note counter', () => {
    assert.deepEqual(noteCounter(''), { text: '0/500', label: '0 of 500 characters' });
    assert.deepEqual(noteCounter('Too harsh'), { text: '9/500', label: '9 of 500 characters' });
  });
});
