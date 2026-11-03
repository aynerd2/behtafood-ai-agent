// Delivery or pickup, budgets per fulfilment, and wallet-only payment.
// Fake models; no key needed.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { SERVER_MESSAGES, SYSTEM_PROMPT, serverMessage } from '@behtafood-agent/agent-core';
import { ADA, FnModel, harness, toolCall, type FakeClock } from './helpers';

type Turn = ReturnType<ConstructorParameters<typeof FnModel>[0]>;

/** Runs a fixed list of model turns and returns every event and the tool results the model saw. */
async function run(turns: Turn[], opts: { text?: string; language?: 'en' | 'yo' | 'pcm' | 'ha' | 'ig'; setup?: (h: ReturnType<typeof harness>) => void; clock?: FakeClock } = {}) {
  const model = new FnModel((_m, n) => turns[n - 1] ?? { content: 'ok' });
  const h = harness({ model, ...(opts.clock ? { clock: opts.clock } : {}) });
  opts.setup?.(h);
  const events: any[] = [];
  await h.agent.handleMessage(ADA, { text: opts.text ?? 'akara', ...(opts.language ? { language: opts.language } : {}) }, (e) => events.push(e));
  const toolResults = model.requests.at(-1)!.messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(String(m.content)));
  return { h, events, toolResults, steps: events.filter((e) => e.type === 'step'), card: events.find((e) => e.type === 'awaiting_approval')?.proposal };
}

const cart = (fulfilment?: 'delivery' | 'pickup', restaurant = 'rst_fountain', item = 'itm_akara') =>
  toolCall('build_cart', { restaurant_id: restaurant, items: [{ item_id: item, quantity: 1 }], ...(fulfilment ? { fulfilment } : {}) });
const quote = (id = 'cart_1') => toolCall('quote_order', { cart_id: id });
const propose = (id = 'quote_1') => toolCall('propose_order', { quote_id: id });
const AKARA = 1200;
const FOUNTAIN_FEE = 200;

describe('the customer chooses delivery or pickup', () => {
  test('when both are possible and the customer has not said, no cart is built and the model is told to ask', async () => {
    const r = await run([{ content: null, tool_calls: [cart()] }]);
    assert.equal(r.toolResults[0].error, 'NEEDS_FULFILMENT');
    assert.match(r.toolResults[0].message, /Ask the customer/);
    assert.deepEqual(r.toolResults[0].options, ['delivery', 'pickup']);
    assert.equal(r.steps[0].labelKey, 'step.needsFulfilment');
  });

  test('delivery: the fee is the server figure and the total includes it', async () => {
    const r = await run([{ content: null, tool_calls: [cart('delivery')] }, { content: null, tool_calls: [quote()] }]);
    assert.equal(r.toolResults[0].fulfilment, 'delivery');
    assert.equal(r.toolResults[1].fulfilment, 'delivery');
    assert.equal(r.toolResults[1].delivery_fee_naira, FOUNTAIN_FEE);
    assert.equal(r.toolResults[1].total_naira, AKARA + FOUNTAIN_FEE);
  });

  test('pickup: no delivery fee and no address needed', async () => {
    const r = await run([{ content: null, tool_calls: [cart('pickup')] }, { content: null, tool_calls: [quote()] }], {
      setup: (h) => (h.port.customers.find((c) => c.id === 'cus_ada')!.hasAddress = false),
    });
    assert.equal(r.toolResults[1].fulfilment, 'pickup');
    assert.equal(r.toolResults[1].delivery_fee_naira, 0);
    assert.equal(r.toolResults[1].total_naira, AKARA);
  });

  test('a restaurant that offers only pickup: it is used, and the model is told to say so', async () => {
    const r = await run([{ content: null, tool_calls: [cart()] }], { setup: (h) => (h.port.restaurants.find((x) => x.id === 'rst_fountain')!.deliveryEnabled = false) });
    assert.equal(r.toolResults[0].fulfilment, 'pickup');
    assert.equal(r.toolResults[0].only_option, true);
    assert.match(r.toolResults[0].note, /only pickup/i);
  });

  test('a restaurant with no map location is pickup only', async () => {
    const r = await run([{ content: null, tool_calls: [cart('delivery')] }], { setup: (h) => (h.port.restaurants.find((x) => x.id === 'rst_fountain')!.hasCoordinates = false) });
    assert.equal(r.toolResults[0].error, 'FULFILMENT_UNAVAILABLE');
    assert.deepEqual(r.toolResults[0].options, ['pickup']);
  });

  test('a restaurant that offers only delivery: it is used', async () => {
    const r = await run([{ content: null, tool_calls: [cart()] }], { setup: (h) => (h.port.restaurants.find((x) => x.id === 'rst_fountain')!.pickupEnabled = false) });
    assert.equal(r.toolResults[0].fulfilment, 'delivery');
    assert.equal(r.toolResults[0].only_option, true);
  });

  test('delivery with no saved address: the customer is asked to add one in the app, and nothing is built', async () => {
    const r = await run([{ content: null, tool_calls: [cart('delivery')] }], {
      language: 'yo',
      setup: (h) => (h.port.customers.find((c) => c.id === 'cus_ada')!.hasAddress = false),
    });
    assert.equal(r.toolResults[0].error, 'NO_ADDRESS');
    assert.equal(r.toolResults[0].customer_message, SERVER_MESSAGES.yo.addAddress);
    assert.match(r.toolResults[0].message, /stop/i);
    assert.equal(r.steps[0].labelKey, 'step.noAddress');
  });

  test('only delivery offered and no saved address: no option at all, and the same instruction', async () => {
    const r = await run([{ content: null, tool_calls: [cart()] }], {
      setup: (h) => {
        h.port.restaurants.find((x) => x.id === 'rst_fountain')!.pickupEnabled = false;
        h.port.customers.find((c) => c.id === 'cus_ada')!.hasAddress = false;
      },
    });
    assert.equal(r.toolResults[0].error, 'NO_ADDRESS');
  });
});

describe('budgets: each fulfilment total next to the budget, tool figures only', () => {
  test('with a budget: delivery over by the fee, pickup within', async () => {
    const r = await run([
      { content: null, tool_calls: [toolCall('build_cart', { restaurant_id: 'rst_fountain', items: [{ item_id: 'itm_akara', quantity: 1 }], fulfilment: 'delivery', budget_naira: 1300 })] },
      { content: null, tool_calls: [quote()] },
    ]);
    const q = r.toolResults[1];
    assert.equal(q.budget_naira, 1300);
    assert.equal(q.total_naira, AKARA + FOUNTAIN_FEE);
    assert.equal(q.within_budget, false);
    assert.equal(q.over_budget_by_naira, AKARA + FOUNTAIN_FEE - 1300);
    assert.deepEqual(q.other_fulfilment, { fulfilment: 'pickup', quote_id: 'quote_2', total_naira: AKARA, within_budget: true, over_budget_by_naira: 0 });
  });
});

describe('wallet only', () => {
  const flow = (f: 'delivery' | 'pickup' = 'delivery') => [
    { content: null, tool_calls: [cart(f)] },
    { content: null, tool_calls: [quote()] },
    { content: null, tool_calls: [propose()] },
  ];
  const setBalance = (n: number) => (h: ReturnType<typeof harness>) => (h.port.customers.find((c) => c.id === 'cus_ada')!.walletNaira = n);

  test('enough: the card shows the wallet balance, the total and the fulfilment', async () => {
    const r = await run(flow(), { setup: setBalance(5000) });
    assert.ok(r.card);
    assert.equal(r.card.walletBalanceNaira, 5000);
    assert.equal(r.card.totalNaira, AKARA + FOUNTAIN_FEE);
    assert.equal(r.card.fulfilment, 'delivery');
  });

  test('exactly enough: the card is shown', async () => {
    const r = await run(flow(), { setup: setBalance(AKARA + FOUNTAIN_FEE) });
    assert.ok(r.card);
    assert.equal(r.card.walletBalanceNaira, AKARA + FOUNTAIN_FEE);
  });

  test('short: no approval, the shortfall in the chosen language, and the cheaper pickup total offered', async () => {
    const r = await run(flow(), { setup: setBalance(1250), language: 'ha' });
    assert.equal(r.card, undefined);
    const p = r.toolResults[2];
    assert.equal(p.error, 'INSUFFICIENT_BALANCE');
    assert.equal(p.wallet_balance_naira, 1250);
    assert.equal(p.total_naira, AKARA + FOUNTAIN_FEE);
    assert.equal(p.shortfall_naira, AKARA + FOUNTAIN_FEE - 1250);
    assert.equal(p.customer_message, serverMessage('ha', 'walletShort', { amount: '₦150' }));
    assert.equal(p.pickup_total_naira, AKARA);
    assert.equal(r.steps.at(-1).labelKey, 'step.walletShort');
    assert.equal(r.h.port.orders.length, 0);
  });

  test('pickup approval places one pickup order at the quoted total; a second approve places nothing new', async () => {
    const r = await run(flow('pickup'), { setup: setBalance(5000) });
    assert.equal(r.card.fulfilment, 'pickup');
    assert.equal(r.card.deliveryFeeNaira, 0);
    const [a, b] = await Promise.all([r.h.agent.proposals.approve(ADA, r.card.proposalId), r.h.agent.proposals.approve(ADA, r.card.proposalId)]);
    assert.equal(a.status, 'placed');
    assert.equal(b.status, 'placed');
    assert.equal(r.h.port.orders.length, 1);
    assert.equal(r.h.port.orders[0]!.fulfilment, 'pickup');
    assert.equal(r.h.port.orders[0]!.totalNaira, AKARA);
    assert.equal(r.h.port.wallet('cus_ada'), 5000 - AKARA);
  });

  test('the wallet-only message exists in every language', () => {
    for (const lang of ['en', 'pcm', 'yo', 'ha', 'ig'] as const) {
      assert.ok(SERVER_MESSAGES[lang].walletOnly);
      assert.match(SERVER_MESSAGES[lang].walletShort, /\{amount\}/);
      assert.ok(SERVER_MESSAGES[lang].addAddress);
    }
  });
});

describe('the prompt', () => {
  test('states the fulfilment, budget and wallet rules', () => {
    assert.match(SYSTEM_PROMPT, /never choose delivery or pickup for them/i);
    assert.match(SYSTEM_PROMPT, /only from the customer's Behtafood wallet/i);
    assert.match(SYSTEM_PROMPT, /Never ask whether to pay by wallet or card/i);
    assert.match(SYSTEM_PROMPT, /never add, estimate or round a fee/i);
  });
});
