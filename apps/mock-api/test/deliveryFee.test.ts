// estimate_delivery_fee: the checkout fee, surge included, to a saved address.
// Fake models; no key needed.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSavedAddress, type CustomerContext } from '@behtafood-agent/agent-core';
import { ADA, FnModel, harness, toolCall } from './helpers';

type Turn = ReturnType<ConstructorParameters<typeof FnModel>[0]>;

async function run(turns: Turn[], ctx: CustomerContext = ADA, setup?: (h: ReturnType<typeof harness>) => void) {
  const model = new FnModel((_m, n) => turns[n - 1] ?? { content: 'ok' });
  const h = harness({ model });
  setup?.(h);
  const events: any[] = [];
  await h.agent.handleMessage(ctx, { text: 'how much is delivery' }, (e) => events.push(e));
  const toolResults = model.requests.at(-1)!.messages.filter((m) => m.role === 'tool').map((m) => JSON.parse(String(m.content)));
  return { h, toolResults, steps: events.filter((e) => e.type === 'step') };
}

const fee = (args: Record<string, unknown> = {}) => toolCall('estimate_delivery_fee', { restaurant_id: 'rst_fountain', ...args });
const build = toolCall('build_cart', { restaurant_id: 'rst_fountain', items: [{ item_id: 'itm_akara', quantity: 1 }], fulfilment: 'delivery' });
const quote = toolCall('quote_order', { cart_id: 'cart_1' });
const RAIN = { amountNaira: 200, reason: '+₦200 — moderate rain in your area' };

describe('estimate_delivery_fee', () => {
  for (const surge of [null, RAIN]) {
    test(`equals the checkout quote's delivery fee ${surge ? 'with' : 'without'} a surge`, async () => {
      const r = await run([{ content: null, tool_calls: [fee(), build] }, { content: null, tool_calls: [quote] }], ADA, (h) => (h.port.surge = surge));
      const [est, , q] = r.toolResults;
      assert.equal(est.total_delivery_fee_naira, q.delivery_fee_naira);
      assert.equal(est.surge_naira, surge ? 200 : 0);
      assert.deepEqual(est.surge_reasons, surge ? [RAIN.reason] : []);
      assert.equal(est.total_delivery_fee_naira, est.base_fee_naira + est.distance_fee_naira + est.surge_naira);
      assert.match(est.pickup, /no delivery fee/);
      assert.equal(r.steps[0].labelKey, 'step.feeChecked');
    });
  }

  test('uses the address selected in the app, then the default, then a named one', async () => {
    const selected = await run([{ content: null, tool_calls: [fee()] }], { ...ADA, selectedAddressId: 'adr_hostel' });
    assert.equal(selected.toolResults[0].to, 'Hostel');
    assert.equal(selected.toolResults[0].address_source, 'selected');
    const fallback = await run([{ content: null, tool_calls: [fee()] }], { ...ADA, selectedAddressId: 'someone_elses' });
    assert.equal(fallback.toolResults[0].to, 'Home');
    assert.equal(fallback.toolResults[0].address_source, 'default');
    const named = await run([{ content: null, tool_calls: [fee({ destination: 'my hostel' })] }]);
    assert.equal(named.toolResults[0].address_source, 'named');
    assert.equal(named.toolResults[0].distance_fee_naira, 150);
  });

  test('no saved address, or a name that is not saved: tell them to add it in the app', async () => {
    const none = await run([{ content: null, tool_calls: [fee()] }], ADA, (h) => (h.port.customers.find((c) => c.id === 'cus_ada')!.hasAddress = false));
    assert.equal(none.toolResults[0].error, 'NO_ADDRESS');
    assert.match(none.toolResults[0].message, /add one in the app/);
    const unknown = await run([{ content: null, tool_calls: [fee({ destination: 'office' })] }]);
    assert.equal(unknown.toolResults[0].error, 'NO_ADDRESS');
    assert.match(unknown.toolResults[0].message, /no saved address called "office"/);
  });

  test('pickSavedAddress never matches loosely across customers', () => {
    assert.equal(pickSavedAddress([], { selectedId: 'x' }).address, null);
  });
});

describe('pickup tracking never has a rider', () => {
  test('an order starts at preparing; a pickup order cannot get rider stages or reminders and ends collected', async () => {
    const h = harness({ model: new FnModel(() => ({ content: 'ok' })) });
    const placed = await h.port.placeWalletOrder(ADA, { checkoutSessionId: 'p1', cart: { restaurantId: 'rst_fountain', lines: [{ itemId: 'itm_akara', quantity: 1 }], fulfilment: 'pickup' }, expectedTotalNaira: 1200 });
    assert.equal(placed.status, 'preparing');
    assert.throws(() => h.port.advanceOrder(placed.orderId, 'rider_assigned'), /no rider/);
    const nudge = await h.agent.nudges.nudge(ADA, { orderId: placed.orderId, party: 'rider', customerConfirmed: true });
    assert.equal(nudge.sent, false);
    h.port.advanceOrder(placed.orderId, 'delivered');
    const s = await h.port.getOrderStatus(ADA, placed.orderId);
    assert.deepEqual([s.status, s.fulfilment, s.riderAssigned], ['collected', 'pickup', false]);
  });
});
