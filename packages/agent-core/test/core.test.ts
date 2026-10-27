// Unit tests for the pure pieces: pricing, spend caps, rate limiting, topic guard.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter, UsageMeter, costUsd, isHealthAdviceRequest } from '../src/index';

describe('costUsd', () => {
  test('prices cached input at the cached rate', () => {
    const c = costUsd('muse-spark-1.3', { promptTokens: 10_000, cachedTokens: 8_000, completionTokens: 1_000, reasoningTokens: 600 });
    // 2000 * 1.25 + 8000 * 0.15 + 1000 * 4.25, per million
    assert.equal(Number(c.toFixed(6)), 0.00795);
  });

  test('offline models cost nothing', () => {
    assert.equal(costUsd('scripted-demo', { promptTokens: 999, cachedTokens: 0, completionTokens: 999, reasoningTokens: 0 }), 0);
  });
});

describe('UsageMeter', () => {
  test('caps per customer and resets the next UTC day', () => {
    let now = Date.parse('2026-10-28T23:00:00Z');
    const m = new UsageMeter({ clock: () => now, customerDailyCapUsd: 0.01 });
    m.record({ customerId: 'a', sessionId: 's', model: 'muse-spark-1.3', usage: { promptTokens: 0, cachedTokens: 0, completionTokens: 3000, reasoningTokens: 0 } });
    assert.deepEqual(m.canSpend('a'), { ok: false, reason: 'customer_cap' });
    assert.deepEqual(m.canSpend('b'), { ok: true });
    now += 2 * 60 * 60 * 1000;
    assert.deepEqual(m.canSpend('a'), { ok: true });
  });
});

describe('RateLimiter', () => {
  test('allows max hits per window per key', () => {
    let now = 0;
    const r = new RateLimiter(2, 1000, () => now);
    assert.equal(r.hit('a'), true);
    assert.equal(r.hit('a'), true);
    assert.equal(r.hit('a'), false);
    assert.equal(r.hit('b'), true);
    now = 1001;
    assert.equal(r.hit('a'), true);
  });
});

describe('isHealthAdviceRequest', () => {
  test('catches health topics, not ordinary food words', () => {
    assert.equal(isHealthAdviceRequest('Is this safe for my peanut allergy?'), true);
    assert.equal(isHealthAdviceRequest('How many calories in jollof?'), true);
    assert.equal(isHealthAdviceRequest('Something spicy and filling, 3k'), false);
    assert.equal(isHealthAdviceRequest('rice and chicken'), false);
  });
});
