// The eval's automated checks, tested offline (the eval itself needs a key).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVER_MESSAGES } from '@behtafood-agent/agent-core';
import { amountsIn, checkRun, looksEnglish, numbersInPrompt } from '../../../scripts/eval/checks';
import { PROMPTS } from '../../../scripts/eval/prompts';

const KNOWN = new Set([2500, 300, 2800]);
const base = { text: 'rice', language: 'auto' as const, expect: 'in' as const, toolCalls: [] as string[] };
const failed = (r: Parameters<typeof checkRun>[0]) => checkRun(r, KNOWN).filter((c) => !c.ok).map((c) => c.name);

describe('eval prompts', () => {
  test('at least 80 prompts, every category from the brief, unique ids', () => {
    assert.ok(PROMPTS.length >= 80);
    assert.equal(new Set(PROMPTS.map((p) => p.id)).size, PROMPTS.length);
    for (const c of ['greeting', 'hungry', 'search', 'dietary', 'how-to', 'orders', 'availability', 'thanks', 'abuse', 'mixed', 'out-of-scope', 'jailbreak']) {
      assert.ok(PROMPTS.some((p) => p.category === c), c);
    }
  });
});

describe('eval checks', () => {
  test('a good reply passes', () => {
    assert.deepEqual(failed({ ...base, reply: 'Jollof Rice & Chicken at Iya Ewa Kitchen: ₦2,800 with delivery. Want it?' }), []);
  });
  test('dashes, banned phrases and walls of text fail', () => {
    assert.ok(failed({ ...base, reply: 'Certainly — here it is' }).includes('no dashes'));
    assert.ok(failed({ ...base, reply: 'Certainly, here it is' }).includes('no banned phrases'));
    assert.ok(failed({ ...base, reply: 'x '.repeat(300) }).includes('length'));
  });
  test('out of scope must be the redirect with no tools', () => {
    assert.deepEqual(failed({ ...base, expect: 'out', reply: SERVER_MESSAGES.en.redirect }), []);
    assert.ok(failed({ ...base, expect: 'out', reply: 'Paris.' }).includes('out of scope blocked, no tools'));
    assert.ok(failed({ ...base, expect: 'out', reply: SERVER_MESSAGES.en.redirect, toolCalls: ['search_restaurants'] }).includes('out of scope blocked, no tools'));
  });
  test('a chosen Yoruba, Hausa or Igbo reply must not be English', () => {
    assert.ok(failed({ ...base, language: 'yo', reply: 'Here are the options you would like for your order.' }).includes('not English'));
    assert.deepEqual(failed({ ...base, language: 'yo', reply: 'Ẹ kú ìrọ̀lẹ́! Kí lẹ fẹ́ jẹ?' }), []);
    assert.equal(looksEnglish('Barka da yamma! Me kake so ka ci?'), false);
  });
  test('prices must come from the data or the prompt', () => {
    assert.deepEqual(amountsIn('₦2,500 and ₦ 300'), [2500, 300]);
    assert.ok(failed({ ...base, reply: 'It costs ₦9,999.' }).includes('no invented prices'));
    assert.deepEqual(numbersInPrompt('under 3k or ₦4,000'), [3000, 4000]);
    assert.deepEqual(failed({ ...base, text: 'under 3k', reply: 'Nothing under ₦3,000 right now.' }), []);
  });
});
