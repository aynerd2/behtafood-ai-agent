// Order tracking with no model, delay rules, and polite reminders.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DELAY_THRESHOLDS,
  NUDGE_TEMPLATES,
  NudgeService,
  ProposalStore,
  StageClock,
  delayThresholdsFromEnv,
  detectDelay,
  nudgeResultText,
  type Cart,
} from '@behtafood-agent/agent-core';
import { MockBehtafoodPort } from '../src/mockPort';
import { ADA, FakeClock, TUNDE } from './helpers';

const MIN = 60_000;

describe('delay thresholds from settings', () => {
  test('defaults: preparing 30 min, ready without rider 10 min, on the way 40 min', () => {
    assert.deepEqual(DEFAULT_DELAY_THRESHOLDS, { preparingMs: 30 * MIN, readyNoRiderMs: 10 * MIN, onTheWayMs: 40 * MIN });
    assert.deepEqual(delayThresholdsFromEnv({}), DEFAULT_DELAY_THRESHOLDS);
  });

  test('each threshold can be set in minutes, decimals allowed; bad values fall back', () => {
    const t = delayThresholdsFromEnv({ AGENT_DELAY_PREPARING_MINUTES: '5', AGENT_DELAY_READY_NO_RIDER_MINUTES: '0.5', AGENT_DELAY_ON_THE_WAY_MINUTES: 'soon' });
    assert.deepEqual(t, { preparingMs: 5 * MIN, readyNoRiderMs: 30_000, onTheWayMs: 40 * MIN });
  });

  test('a demo setting makes every threshold a few seconds, but never in production', () => {
    assert.deepEqual(delayThresholdsFromEnv({ AGENT_DELAY_DEMO_SECONDS: '20' }), { preparingMs: 20_000, readyNoRiderMs: 20_000, onTheWayMs: 20_000 });
    assert.deepEqual(delayThresholdsFromEnv({ AGENT_DELAY_DEMO_SECONDS: '20', NODE_ENV: 'production' }), DEFAULT_DELAY_THRESHOLDS);
  });
});

describe('detectDelay (fixed messages, no model)', () => {
  const T = DEFAULT_DELAY_THRESHOLDS;
  const at = (ms: number) => ({ sinceMs: 0, now: ms });

  test('preparing too long: remind the restaurant (delivery and pickup alike)', () => {
    assert.equal(detectDelay({ status: 'preparing', riderAssigned: false }, at(30 * MIN - 1).sinceMs, at(30 * MIN - 1).now, T), null);
    for (const fulfilment of ['delivery', 'pickup'] as const) {
      const d = detectDelay({ status: 'preparing', riderAssigned: false, fulfilment }, 0, 32 * MIN, T)!;
      assert.equal(d.kind, 'long_preparing');
      assert.deepEqual(d.parties, ['vendor']);
      assert.equal(d.message, 'The restaurant has been preparing your order for 32 minutes. Would you like to send a polite reminder?');
    }
  });

  test('a rider assigned but not picked up: remind the restaurant', () => {
    const d = detectDelay({ status: 'rider_assigned', riderAssigned: true }, 0, 11 * MIN, T)!;
    assert.equal(d.kind, 'not_collected');
    assert.deepEqual(d.parties, ['vendor']);
  });

  test('a pickup order never gets a rider rule, even if the record says otherwise', () => {
    for (const status of ['ready', 'rider_assigned', 'on_the_way'] as const) {
      assert.equal(detectDelay({ status, riderAssigned: false, fulfilment: 'pickup' }, 0, 999 * MIN, T), null, status);
    }
  });

  test('ready with no rider after the threshold: remind the restaurant', () => {
    assert.equal(detectDelay({ status: 'ready', riderAssigned: false }, 0, 9 * MIN, T), null);
    const d = detectDelay({ status: 'ready', riderAssigned: false }, 0, 11 * MIN, T)!;
    assert.equal(d.kind, 'no_rider');
    assert.deepEqual(d.parties, ['vendor']);
    assert.match(d.message, /ready for 11 minutes/);
  });

  test('on the way for longer than the threshold: remind the rider', () => {
    assert.equal(detectDelay({ status: 'on_the_way', riderAssigned: true }, 0, 40 * MIN, T), null);
    const d = detectDelay({ status: 'on_the_way', riderAssigned: true }, 0, 45 * MIN, T)!;
    assert.equal(d.kind, 'long_delivery');
    assert.deepEqual(d.parties, ['rider']);
    assert.match(d.message, /on the way for 45 minutes/);
  });

  test('short demo thresholds read in seconds; no promise of a delivery time', () => {
    const d = detectDelay({ status: 'ready', riderAssigned: false }, 0, 25_000, { preparingMs: 20_000, readyNoRiderMs: 20_000, onTheWayMs: 20_000 })!;
    assert.match(d.message, /ready for 25 seconds/);
    assert.doesNotMatch(d.message, /will arrive|arrive in|soon|ETA/i);
  });

  test('no delay for other stages, finished orders, or ready with a rider', () => {
    for (const status of ['picked_up', 'delivered', 'collected', 'cancelled'] as const) {
      assert.equal(detectDelay({ status, riderAssigned: false }, 0, 999 * MIN, T), null, status);
    }
    assert.equal(detectDelay({ status: 'ready', riderAssigned: true }, 0, 999 * MIN, T), null);
  });
});

describe('StageClock: when the current stage began', () => {
  test('first sighting uses the order\'s last update; a new stage starts then; the same stage keeps its start', () => {
    const c = new StageClock();
    assert.equal(c.observe('o1', 'preparing', 1_000, 5_000), 1_000);
    assert.equal(c.observe('o1', 'preparing', 4_000, 9_000), 1_000, 'unrelated saves do not reset the clock');
    assert.equal(c.observe('o1', 'ready', 8_000, 9_000), 8_000);
    assert.equal(c.observe('o1', 'ready', 8_000, 60_000), 8_000);
    assert.equal(c.observe('o1', 'on_the_way', 99_000, 70_000), 70_000, 'never in the future');
  });
});

async function placedOrder(ctx = ADA) {
  const clock = new FakeClock();
  const port = new MockBehtafoodPort(clock.fn);
  const proposals = new ProposalStore(port, { clock: clock.fn });
  const cart: Cart = { restaurantId: 'rst_fountain', lines: [{ itemId: 'itm_akara', quantity: 1 }] };
  const p = proposals.create(ctx, { sessionId: 's', cart, quote: await port.quoteOrder(ctx, cart) });
  const r = await proposals.approve(ctx, p.id);
  assert.equal(r.status, 'placed');
  return { clock, port, orderId: r.status === 'placed' ? r.order.orderId : '' };
}

describe('reminders (nudges)', () => {
  test('fixed, polite text: no pressure, no times, no promises', () => {
    assert.equal(NUDGE_TEMPLATES.vendor, 'Hello from Behtafood. The customer is checking on order {reference}. When you can, please update its status in your app. Thank you.');
    assert.equal(NUDGE_TEMPLATES.rider, 'Hello from Behtafood. The customer is checking on order {reference}. When it is safe, please update the delivery status in your app. Thank you.');
    for (const t of Object.values(NUDGE_TEMPLATES)) assert.doesNotMatch(t, /urgent|immediately|asap|hurry|late|minutes|now|arrive/i);
  });

  test('honest result wording: "reminder sent" or "couldn\'t send", never delivered or read', () => {
    assert.equal(nudgeResultText('vendor', { sent: true, message: 'x' }), 'Reminder sent to the restaurant.');
    assert.equal(nudgeResultText('rider', { sent: true, message: 'x' }), 'Reminder sent to the rider.');
    assert.equal(nudgeResultText('vendor', { sent: false, code: 'SEND_FAILED', message: 'x' }), "Couldn't send the reminder. Please try again later.");
    const all = (['vendor', 'rider'] as const).flatMap((p) =>
      (['NOT_CONFIRMED', 'NOT_FOUND', 'NOT_ACTIVE', 'NO_RIDER', 'COOLDOWN', 'ORDER_LIMIT', 'SEND_FAILED'] as const).map((code) => nudgeResultText(p, { sent: false, code, message: '' })),
    );
    for (const t of all) assert.doesNotMatch(t, /delivered|read|seen/i);
  });

  test('limits: 1 per party per 10 minutes, 2 per order; each attempt logged with who, when and result', async () => {
    const { clock, port, orderId } = await placedOrder();
    const n = new NudgeService(port, clock.fn);
    const ask = (party: 'vendor' | 'rider') => n.nudge(ADA, { orderId, party, customerConfirmed: true });
    assert.equal((await ask('vendor')).sent, true);
    assert.deepEqual(await ask('vendor'), { sent: false, code: 'COOLDOWN', message: n.refusalText('COOLDOWN') });
    assert.equal((await ask('rider')).sent, false, 'no rider yet');
    port.advanceOrder(orderId, 'rider_assigned');
    assert.equal((await ask('rider')).sent, true);
    clock.advance(11 * MIN);
    const third = await ask('vendor');
    assert.equal(third.sent === false && third.code, 'ORDER_LIMIT');
    assert.equal(port.nudges.length, 2);
    assert.deepEqual(n.log.map((l) => [l.party, l.outcome]), [['vendor', 'sent'], ['vendor', 'COOLDOWN'], ['rider', 'NO_RIDER'], ['rider', 'sent'], ['vendor', 'ORDER_LIMIT']]);
    assert.ok(n.log.every((l) => l.customerId === 'cus_ada' && l.orderId === orderId && !Number.isNaN(Date.parse(l.at))));
  });

  test("another customer's order: refused as not found, nothing sent", async () => {
    const { clock, port, orderId } = await placedOrder(ADA);
    const n = new NudgeService(port, clock.fn);
    const r = await n.nudge(TUNDE, { orderId, party: 'vendor', customerConfirmed: true });
    assert.equal(r.sent === false && r.code, 'NOT_FOUND');
    assert.equal(port.nudges.length, 0);
  });

  test("a send that fails is logged and reported as couldn't send", async () => {
    const { clock, port, orderId } = await placedOrder();
    port.failNudges = true;
    const n = new NudgeService(port, clock.fn);
    const r = await n.nudge(ADA, { orderId, party: 'vendor', customerConfirmed: true });
    assert.equal(r.sent === false && r.code, 'SEND_FAILED');
    assert.equal(n.log.at(-1)?.outcome, 'SEND_FAILED');
    // A failed send does not use up the order's two reminders.
    port.failNudges = false;
    assert.equal((await n.nudge(ADA, { orderId, party: 'vendor', customerConfirmed: true })).sent, true);
  });

  test('a finished order cannot be nudged', async () => {
    const { clock, port, orderId } = await placedOrder();
    port.advanceOrder(orderId, 'delivered');
    const r = await new NudgeService(port, clock.fn).nudge(ADA, { orderId, party: 'vendor', customerConfirmed: true });
    assert.equal(r.sent === false && r.code, 'NOT_ACTIVE');
  });
});
