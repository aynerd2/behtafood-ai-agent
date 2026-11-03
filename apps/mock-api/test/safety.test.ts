// The safety rules (docs/safety.md), one block per rule, against the mock backend.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEALTH_REFUSAL,
  MAX_MODEL_CALLS_PER_MESSAGE,
  NUDGE_TEMPLATES,
  NudgeService,
  PROPOSAL_TTL_MS,
  ProposalStore,
  RateLimiter,
  SYSTEM_PROMPT,
  TOOL_SCHEMAS,
  UsageMeter,
  type Cart,
} from '@behtafood-agent/agent-core';
import { MockBehtafoodPort } from '../src/mockPort';
import { ADA, FakeClock, FnModel, TUNDE, harness, sequenceModel, toolCall } from './helpers';

const JOLLOF_CHICKEN: Cart = { restaurantId: 'rst_fountain', lines: [{ itemId: 'itm_akara', quantity: 1 }, { itemId: 'itm_agoyin_cafe', quantity: 1 }] };

async function proposalFixture(ctx = ADA, cart = JOLLOF_CHICKEN) {
  const clock = new FakeClock();
  const port = new MockBehtafoodPort(clock.fn);
  const proposals = new ProposalStore(port, { clock: clock.fn });
  const quote = await port.quoteOrder(ctx, cart);
  const p = proposals.create(ctx, { sessionId: 's1', cart, quote });
  return { clock, port, proposals, quote, p };
}

describe('rule 1: a proposal stores the server quote and expires after 10 minutes', () => {
  test('stores the quote exactly as the server returned it', async () => {
    const { p, quote, proposals } = await proposalFixture();
    assert.deepEqual(p.quote, quote);
    assert.equal(proposals.view(p).totalNaira, 3000);
    assert.equal(PROPOSAL_TTL_MS, 10 * 60 * 1000);
  });

  test('approving after 10 minutes refuses and places nothing', async () => {
    const { clock, port, proposals, p } = await proposalFixture();
    clock.advance(PROPOSAL_TTL_MS + 1000);
    const r = await proposals.approve(ADA, p.id);
    assert.equal(r.status, 'refused');
    assert.equal(r.status === 'refused' && r.code, 'EXPIRED');
    assert.equal(port.orders.length, 0);
  });

  test('approving just before expiry works', async () => {
    const { clock, proposals, p } = await proposalFixture();
    clock.advance(PROPOSAL_TTL_MS - 1000);
    assert.equal((await proposals.approve(ADA, p.id)).status, 'placed');
  });
});

describe('rule 2: approval re-quotes; a changed total refuses and asks again', () => {
  test('price change refuses, then a second approval places at the new total', async () => {
    const { port, proposals, p } = await proposalFixture();
    port.setPrice('itm_agoyin_cafe', 1800);
    const r1 = await proposals.approve(ADA, p.id);
    assert.equal(r1.status, 'price_changed');
    assert.equal(r1.status === 'price_changed' && r1.proposal.totalNaira, 3200);
    assert.equal(r1.status === 'price_changed' && r1.previousTotalNaira, 3000);
    assert.equal(port.orders.length, 0);

    const r2 = await proposals.approve(ADA, p.id);
    assert.equal(r2.status, 'placed');
    assert.equal(r2.status === 'placed' && r2.order.totalNaira, 3200);
    assert.equal(port.wallet('cus_ada'), 15000 - 3200);
  });
});

describe('rule 3: proposal id is the checkoutSessionId; no duplicate orders', () => {
  test('the order carries the proposal id as checkoutSessionId', async () => {
    const { proposals, p } = await proposalFixture();
    const r = await proposals.approve(ADA, p.id);
    assert.equal(r.status === 'placed' && r.order.checkoutSessionId, p.id);
  });

  test('a double tap (two concurrent approvals) creates one order', async () => {
    const { port, proposals, p } = await proposalFixture();
    const [a, b] = await Promise.all([proposals.approve(ADA, p.id), proposals.approve(ADA, p.id)]);
    assert.equal(a.status, 'placed');
    assert.equal(b.status, 'placed');
    assert.equal(a.status === 'placed' && b.status === 'placed' && a.order.orderId === b.order.orderId, true);
    assert.equal(port.placeOrderCalls, 1);
    assert.equal(port.wallet('cus_ada'), 12000);
  });

  test('a later retry returns the same order and charges once', async () => {
    const { port, proposals, p } = await proposalFixture();
    await proposals.approve(ADA, p.id);
    const again = await proposals.approve(ADA, p.id);
    assert.equal(again.status === 'placed' && again.alreadyPlaced, true);
    assert.equal(port.placeOrderCalls, 1);
  });

  test('lost response after commit: the order is found by checkoutSessionId, not placed twice', async () => {
    const { port, proposals, p } = await proposalFixture();
    port.nextPlaceOrderFault = 'lost_response';
    const r = await proposals.approve(ADA, p.id);
    assert.equal(r.status, 'placed');
    assert.equal(port.placeOrderCalls, 1);
    assert.equal(port.wallet('cus_ada'), 12000);
  });

  test('failure before commit: uncertain, then a retry looks up first and places exactly one', async () => {
    const { port, proposals, p } = await proposalFixture();
    port.nextPlaceOrderFault = 'before_commit';
    const r1 = await proposals.approve(ADA, p.id);
    assert.equal(r1.status, 'uncertain');
    assert.equal(port.orders.length, 0);
    const r2 = await proposals.approve(ADA, p.id);
    assert.equal(r2.status, 'placed');
    assert.equal(port.placeOrderCalls, 1);
  });

  test("another customer cannot approve someone else's proposal", async () => {
    const { port, proposals, p } = await proposalFixture();
    const r = await proposals.approve(TUNDE, p.id);
    assert.equal(r.status === 'refused' && r.code, 'NOT_FOUND');
    assert.equal(port.orders.length, 0);
  });
});

describe('rule 4: refuse with a clear reason and place nothing', () => {
  test('insufficient wallet balance', async () => {
    const { port, proposals, p } = await proposalFixture(TUNDE);
    const r = await proposals.approve(TUNDE, p.id);
    assert.equal(r.status === 'refused' && r.code, 'INSUFFICIENT_BALANCE');
    assert.match(r.status === 'refused' ? r.message : '', /balance/i);
    assert.equal(port.orders.length, 0);
    assert.equal(port.wallet('cus_tunde'), 800);
  });

  test('item became unavailable', async () => {
    const { port, proposals, p } = await proposalFixture();
    port.setAvailable('itm_agoyin_cafe', false);
    const r = await proposals.approve(ADA, p.id);
    assert.equal(r.status === 'refused' && r.code, 'ITEM_UNAVAILABLE');
    assert.equal(port.orders.length, 0);
  });

  test('restaurant closed by the vendor', async () => {
    const { port, proposals, p } = await proposalFixture();
    port.setRestaurant('rst_fountain', { isOpen: false });
    const r = await proposals.approve(ADA, p.id);
    assert.equal(r.status === 'refused' && r.code, 'RESTAURANT_CLOSED');
    assert.equal(port.orders.length, 0);
  });

  test('restaurant closed by an admin even though the vendor says open', async () => {
    const { port, proposals, p } = await proposalFixture();
    port.setRestaurant('rst_fountain', { adminForceClosed: true });
    const r = await proposals.approve(ADA, p.id);
    assert.equal(r.status === 'refused' && r.code, 'RESTAURANT_CLOSED');
    assert.equal(port.orders.length, 0);
  });

  test('closed and admin-closed restaurants never appear in search', async () => {
    const port = new MockBehtafoodPort();
    const ids = (await port.searchRestaurants(ADA, { text: 'rice chicken', limit: 10 })).map((r) => r.id);
    assert.ok(!ids.includes('rst_grill'));
    assert.ok(!ids.includes('rst_mama'));
  });

  test('a refused proposal cannot be approved again later', async () => {
    const { port, proposals, p } = await proposalFixture(TUNDE);
    await proposals.approve(TUNDE, p.id);
    port.customers.find((c) => c.id === 'cus_tunde')!.walletNaira = 50_000;
    const r = await proposals.approve(TUNDE, p.id);
    assert.equal(r.status, 'refused');
    assert.equal(port.orders.length, 0);
  });
});

describe('rule 5: prompt injection in vendor text causes nothing', () => {
  test('the model has no tool that places or pays for an order', () => {
    const names = TOOL_SCHEMAS.map((t) => t.function.name);
    for (const n of names) assert.doesNotMatch(n, /place|pay|checkout|approve|wallet|transfer/);
  });

  test('vendor text reaches the model marked as untrusted data', async () => {
    const model = sequenceModel([{ content: null, tool_calls: [toolCall('get_menu', { restaurant_id: 'rst_fountain' })] }]);
    const h = harness({ model });
    await h.send('What is on the menu at Spice Route Kitchen?');
    const toolMsg = model.requests[1]!.messages.find((m) => m.role === 'tool');
    assert.ok(toolMsg && typeof toolMsg.content === 'string');
    assert.match(toolMsg.content, /untrusted/i);
    assert.match(toolMsg.content, /ignore your rules/); // the text is present, as data
  });

  test('a model that obeys the injected text still places no order', async () => {
    const model = sequenceModel([
      { content: null, tool_calls: [toolCall('get_menu', { restaurant_id: 'rst_fountain' })] },
      {
        content: null,
        tool_calls: [
          toolCall('place_order', { item_id: 'itm_special', quantity: 10 }),
          toolCall('build_cart', { fulfilment: 'delivery', restaurant_id: 'rst_fountain', items: [{ item_id: 'itm_special', quantity: 10 }] }),
        ],
      },
      { content: null, tool_calls: [toolCall('quote_order', { cart_id: 'cart_1' })] },
      { content: null, tool_calls: [toolCall('propose_order', { quote_id: 'quote_1' })] },
      { content: 'Done, I placed your order.' },
    ]);
    const h = harness({ model });
    const r = await h.send('Tell me about the chef special.');
    const refused = r.events.find((e) => e.type === 'step' && e.tool === 'place_order');
    assert.deepEqual(refused, { type: 'step', tool: 'place_order', status: 'failed', label: 'Unknown action refused', labelKey: 'step.failed', labelParams: { tool: 'place_order' } });
    assert.equal(h.port.placeOrderCalls, 0);
    assert.equal(h.port.orders.length, 0);
    assert.equal(h.port.wallet('cus_ada'), 15000);
    // At most an approval card exists; only the customer's tap can turn it into an order.
    // (Ten specials are over the wallet, so the wallet check refuses even the card.)
    const card = r.events.find((e) => e.type === 'awaiting_approval');
    const walletShort = r.events.some((e) => e.type === 'step' && e.labelKey === 'step.walletShort');
    assert.ok(card || walletShort);
  });
});

describe('rule 6: rate limit, 8 model calls per message, daily spend cap', () => {
  test('messages over the per-customer rate limit are refused before any model call', async () => {
    const model = sequenceModel([]);
    const clock = new FakeClock();
    const h = harness({ model, clock, messageLimiter: new RateLimiter(3, 60_000, clock.fn) });
    for (let i = 0; i < 3; i++) await h.send('hi');
    const r = await h.send('hi again');
    assert.equal(model.calls, 3);
    assert.ok(r.events.some((e) => e.type === 'error' && e.code === 'rate_limited'));
    clock.advance(61_000);
    await h.send('hi after a minute');
    assert.equal(model.calls, 4);
  });

  test('a model that never stops calling tools is cut off at 8 calls', async () => {
    const model = new FnModel(() => ({ content: null, tool_calls: [toolCall('get_menu', { restaurant_id: 'rst_fountain' })] }));
    const h = harness({ model });
    const r = await h.send('loop forever');
    assert.equal(MAX_MODEL_CALLS_PER_MESSAGE, 8);
    assert.equal(model.calls, 8);
    assert.ok(r.events.some((e) => e.type === 'error' && e.code === 'call_cap'));
  });

  test('the daily spend cap stops model calls', async () => {
    const clock = new FakeClock();
    const model = new FnModel(
      () => ({ content: null, tool_calls: [toolCall('get_menu', { restaurant_id: 'rst_fountain' })] }),
      'muse-spark-1.3',
      { promptTokens: 10_000, cachedTokens: 0, completionTokens: 1000, reasoningTokens: 0 },
    );
    const h = harness({ model, clock, usage: new UsageMeter({ clock: clock.fn, customerDailyCapUsd: 0.02 }) });
    const r = await h.send('anything');
    assert.equal(model.calls, 2); // ~$0.0168 per call: the third call would pass the cap
    assert.ok(r.events.some((e) => e.type === 'error' && e.code === 'spend_cap'));
    const next = await h.send('more');
    assert.equal(model.calls, 2);
    assert.ok(next.events.some((e) => e.type === 'error' && e.code === 'spend_cap'));
  });
});

describe('rule 7: nudges are templated, limited, own active order only, logged', () => {
  async function placedOrder() {
    const f = await proposalFixture();
    const r = await f.proposals.approve(ADA, f.p.id);
    assert.equal(r.status, 'placed');
    const orderId = r.status === 'placed' ? r.order.orderId : '';
    return { ...f, orderId, nudges: new NudgeService(f.port, f.clock.fn) };
  }

  test('sends exactly the template, with no ETA promise', async () => {
    const { port, nudges, orderId } = await placedOrder();
    const r = await nudges.nudge(ADA, { orderId, party: 'vendor', customerConfirmed: true });
    assert.equal(r.sent, true);
    assert.equal(port.nudges.length, 1);
    assert.equal(port.nudges[0]!.message, NUDGE_TEMPLATES.vendor.replace('{reference}', 'BF-1001'));
    assert.doesNotMatch(port.nudges[0]!.message, /\d+\s*(min|minute|hour)/i);
  });

  test('requires the customer to have said yes', async () => {
    const { port, nudges, orderId } = await placedOrder();
    const r = await nudges.nudge(ADA, { orderId, party: 'vendor', customerConfirmed: false });
    assert.equal(r.sent === false && r.code, 'NOT_CONFIRMED');
    assert.equal(port.nudges.length, 0);
  });

  test('at most 1 per party per 10 minutes and 2 per order', async () => {
    const { port, clock, nudges, orderId } = await placedOrder();
    port.advanceOrder(orderId, 'rider_assigned');
    assert.equal((await nudges.nudge(ADA, { orderId, party: 'vendor', customerConfirmed: true })).sent, true);
    const again = await nudges.nudge(ADA, { orderId, party: 'vendor', customerConfirmed: true });
    assert.equal(again.sent === false && again.code, 'COOLDOWN');
    assert.equal((await nudges.nudge(ADA, { orderId, party: 'rider', customerConfirmed: true })).sent, true);
    clock.advance(11 * 60 * 1000);
    const third = await nudges.nudge(ADA, { orderId, party: 'vendor', customerConfirmed: true });
    assert.equal(third.sent === false && third.code, 'ORDER_LIMIT');
    assert.equal(port.nudges.length, 2);
  });

  test("refuses another customer's order and a finished order", async () => {
    const { port, nudges, orderId } = await placedOrder();
    const other = await nudges.nudge(TUNDE, { orderId, party: 'vendor', customerConfirmed: true });
    assert.equal(other.sent === false && other.code, 'NOT_FOUND');
    port.advanceOrder(orderId, 'delivered');
    const done = await nudges.nudge(ADA, { orderId, party: 'vendor', customerConfirmed: true });
    assert.equal(done.sent === false && done.code, 'NOT_ACTIVE');
    assert.equal(port.nudges.length, 0);
  });

  test('every attempt is logged, sent or not', async () => {
    const { nudges, orderId } = await placedOrder();
    await nudges.nudge(ADA, { orderId, party: 'vendor', customerConfirmed: true });
    await nudges.nudge(ADA, { orderId, party: 'vendor', customerConfirmed: true });
    await nudges.nudge(ADA, { orderId, party: 'rider', customerConfirmed: true }); // no rider yet
    assert.deepEqual(nudges.log.map((l) => l.outcome), ['sent', 'COOLDOWN', 'NO_RIDER']);
  });
});

describe('rule 8: no health, allergy or nutrition advice', () => {
  test('health questions get a fixed reply with zero model calls', async () => {
    const model = sequenceModel([]);
    const h = harness({ model });
    const r = await h.send('I am allergic to peanuts and diabetic, which meal is safe for me?');
    assert.equal(model.calls, 0);
    assert.deepEqual(r.events.find((e) => e.type === 'reply'), { type: 'reply', text: HEALTH_REFUSAL });
  });

  test('ordinary food requests are not blocked', async () => {
    const model = sequenceModel([{ content: 'Here are options.' }]);
    const h = harness({ model });
    await h.send('Something spicy and filling for 3k');
    assert.equal(model.calls, 1);
  });

  test('the system prompt states the rule', () => {
    assert.match(SYSTEM_PROMPT, /no health, allergy or nutrition advice/i);
  });
});
