// Menu items with choices (size, protein…): the menu shows them, a cart must
// name every required one, the server prices them, and the approval card and
// the order carry them.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ProposalStore, ScriptedDemoModel, type Cart } from '@behtafood-agent/agent-core';
import { MockBehtafoodPort } from '../src/mockPort';
import { ADA, FakeClock, harness, sequenceModel, toolCall } from './helpers';

const lastStep = (events: { type: string }[]) => events.filter((e) => e.type === 'step').at(-1) as any;

describe('menu choices', () => {
  test('get_menu shows each item\'s choice groups, required flag and extra prices', async () => {
    const { send } = harness({ model: sequenceModel([{ content: null, tool_calls: [toolCall('get_menu', { restaurant_id: 'rst_bukka' })] }]) });
    const { events } = await send('menu');
    const step = lastStep(events);
    assert.equal(step.status, 'done');
    const port = new MockBehtafoodPort();
    const menu = await port.getMenu(ADA, 'rst_bukka');
    const shawarma = menu.find((m) => m.id === 'itm_shawarma')!;
    assert.deepEqual(shawarma.choices, [
      { name: 'Size', required: true, maxSelections: 1, options: [{ name: 'Regular', priceNaira: 0 }, { name: 'Jumbo', priceNaira: 1000 }] },
    ]);
    assert.equal(shawarma.available, true);
  });

  test('the model sees the choices in the get_menu result', async () => {
    const h = harness({ model: sequenceModel([{ content: null, tool_calls: [toolCall('get_menu', { restaurant_id: 'rst_bukka' })] }]) });
    await h.send('menu');
    const result = JSON.parse(String((h.agent as any).model.requests[1].messages.at(-1).content));
    const item = result.items.find((i: any) => i.id === 'itm_shawarma');
    assert.deepEqual(item.choices, [{ group: 'Size', required: true, max: 1, options: [{ name: 'Regular', extra_price_naira: 0 }, { name: 'Jumbo', extra_price_naira: 1000 }] }]);
  });
});

describe('timeline data for the app (display only)', () => {
  test('the get_menu step carries each item\'s choices, so the app can show them as buttons', async () => {
    const { send } = harness({ model: sequenceModel([{ content: null, tool_calls: [toolCall('get_menu', { restaurant_id: 'rst_bukka' })] }]) });
    const step = lastStep((await send('menu')).events);
    const item = step.data.items.find((i: any) => i.id === 'itm_shawarma');
    assert.deepEqual(item.choices, [{ group: 'Size', required: true, max: 1, options: [{ name: 'Regular', extra_price_naira: 0 }, { name: 'Jumbo', extra_price_naira: 1000 }] }]);
    assert.equal(step.data.items.find((i: any) => i.id === 'itm_zobo').choices, undefined);
  });

  test('a NEEDS_CHOICE step names the item, the group and every option with its extra price', async () => {
    const { send } = harness({ model: sequenceModel([{ content: null, tool_calls: [toolCall('build_cart', { restaurant_id: 'rst_bukka', items: [{ item_id: 'itm_shawarma', quantity: 1 }] })] }]) });
    const step = lastStep((await send('shawarma')).events);
    assert.equal(step.status, 'failed');
    assert.deepEqual(step.data, {
      needsChoice: { itemId: 'itm_shawarma', itemName: 'Chicken Shawarma', group: 'Size', options: [{ name: 'Regular', extra_price_naira: 0 }, { name: 'Jumbo', extra_price_naira: 1000 }] },
    });
  });
});

describe('timeline data for guided mode (display only)', () => {
  test('a built cart names its restaurant and each dish id, so the app can show the real menu item', async () => {
    const { send } = harness({
      model: sequenceModel([{ content: null, tool_calls: [toolCall('build_cart', { restaurant_id: 'rst_bukka', items: [{ item_id: 'itm_shawarma', quantity: 2, choices: [{ group: 'Size', option: 'Jumbo' }] }, { item_id: 'itm_zobo', quantity: 1 }] })] }]),
    });
    const step = lastStep((await send('2 jumbo shawarma and a zobo')).events);
    assert.equal(step.status, 'done');
    assert.equal(step.data.restaurantId, 'rst_bukka');
    assert.deepEqual(step.data.items, [
      { itemId: 'itm_shawarma', name: 'Chicken Shawarma', quantity: 2, choices: [{ group: 'Size', option: 'Jumbo' }], imageUrl: '/assets/food/dish-shawarma.jpg' },
      { itemId: 'itm_zobo', name: 'Zobo', quantity: 1, imageUrl: '/assets/food/dish-zobo.jpg' },
    ]);
  });

  test('the model still sees the same short cart summary (no ids added to its view)', async () => {
    const h = harness({ model: sequenceModel([{ content: null, tool_calls: [toolCall('build_cart', { restaurant_id: 'rst_bukka', items: [{ item_id: 'itm_zobo', quantity: 1 }] })] }]) });
    await h.send('zobo');
    const result = JSON.parse(String((h.agent as any).model.requests[1].messages.at(-1).content));
    assert.deepEqual(result, { cart_id: 'cart_1', items: [{ name: 'Zobo', quantity: 1 }] });
  });
});

describe('build_cart with choices', () => {
  const cartCall = (items: unknown[]) => sequenceModel([{ content: null, tool_calls: [toolCall('build_cart', { restaurant_id: 'rst_bukka', items })] }]);

  test('a missing required choice fails with the options, so the model can ask', async () => {
    const { send } = harness({ model: cartCall([{ item_id: 'itm_shawarma', quantity: 1 }]) });
    const step = lastStep((await send('shawarma')).events);
    assert.equal(step.status, 'failed');
    const h = harness({ model: cartCall([{ item_id: 'itm_shawarma', quantity: 1 }]) });
    await h.send('shawarma');
    const result = JSON.parse(String((h.agent as any).model.requests[1].messages.at(-1).content));
    assert.equal(result.error, 'NEEDS_CHOICE');
    assert.match(result.message, /Size/);
    assert.match(result.message, /Regular/);
    assert.match(result.message, /Jumbo/);
  });

  test('an unknown option, an unknown group or too many picks is refused', async () => {
    for (const choices of [
      [{ group: 'Size', option: 'Mega' }],
      [{ group: 'Sauce', option: 'Hot' }],
      [{ group: 'Size', option: 'Regular' }, { group: 'Size', option: 'Jumbo' }],
    ]) {
      const h = harness({ model: cartCall([{ item_id: 'itm_shawarma', quantity: 1, choices }]) });
      await h.send('shawarma');
      const result = JSON.parse(String((h.agent as any).model.requests[1].messages.at(-1).content));
      assert.equal(result.error, 'INVALID_CHOICE', JSON.stringify(choices));
    }
  });

  test('a valid choice is quoted by the server, shown on the card and kept on the order', async () => {
    const h = harness({
      model: new (await import('./helpers')).FnModel((messages, n) => {
        const last = messages.at(-1);
        const r = last?.role === 'tool' ? JSON.parse(String(last.content)) : {};
        if (n === 1) return { content: null, tool_calls: [toolCall('build_cart', { restaurant_id: 'rst_bukka', items: [{ item_id: 'itm_shawarma', quantity: 2, choices: [{ group: 'Size', option: 'Jumbo' }] }] })] };
        if (n === 2) return { content: null, tool_calls: [toolCall('quote_order', { cart_id: r.cart_id })] };
        if (n === 3) return { content: null, tool_calls: [toolCall('propose_order', { quote_id: r.quote_id })] };
        return { content: 'ok' };
      }),
    });
    const { events } = await h.send('2 jumbo shawarma');
    const card = (events.find((e) => e.type === 'awaiting_approval') as any).proposal;
    // Behtafood prices a choice ONCE per line (like an add-on), not per unit.
    assert.equal(card.subtotalNaira, 2 * 3500 + 1000);
    assert.deepEqual(card.lines[0].choices, [{ group: 'Size', option: 'Jumbo', priceNaira: 1000 }]);
    const res = await h.agent.proposals.approve(ADA, card.proposalId);
    assert.equal(res.status, 'placed');
    assert.deepEqual(h.port.orders[0]!.lines[0], { itemId: 'itm_shawarma', name: 'Chicken Shawarma', quantity: 2, choices: [{ group: 'Size', option: 'Jumbo' }] });
  });
});

describe('the server enforces choices too', () => {
  test('quoteOrder refuses a cart without a required choice, whatever the tools did', async () => {
    const port = new MockBehtafoodPort();
    const cart: Cart = { restaurantId: 'rst_bukka', lines: [{ itemId: 'itm_shawarma', quantity: 1 }] };
    await assert.rejects(port.quoteOrder(ADA, cart), (e: any) => e.code === 'INVALID_CART');
    const ok = await port.quoteOrder(ADA, { ...cart, lines: [{ itemId: 'itm_shawarma', quantity: 1, choices: [{ group: 'Size', option: 'Regular' }] }] });
    assert.equal(ok.totalNaira, 3500 + 500);
  });

  test('a choice whose price changed forces re-approval', async () => {
    const clock = new FakeClock();
    const port = new MockBehtafoodPort(clock.fn);
    const proposals = new ProposalStore(port, { clock: clock.fn });
    const cart: Cart = { restaurantId: 'rst_bukka', lines: [{ itemId: 'itm_shawarma', quantity: 1, choices: [{ group: 'Size', option: 'Jumbo' }] }] };
    const p = proposals.create(ADA, { sessionId: 's', cart, quote: await port.quoteOrder(ADA, cart) });
    port.menu.find((m) => m.id === 'itm_shawarma')!.choices![0]!.options[1]!.priceNaira = 1500;
    const r = await proposals.approve(ADA, p.id);
    assert.equal(r.status, 'price_changed');
    assert.equal(port.placeOrderCalls, 0);
  });
});

describe('offline scripted demo', () => {
  test('offers the first option of a required choice by name, and the customer\'s pick carries it', async () => {
    const h = harness({ model: new ScriptedDemoModel() });
    const first = await h.send('I want chicken shawarma, budget 5000');
    const reply = (first.events.find((e) => e.type === 'reply') as any).text as string;
    assert.match(reply, /Chicken Shawarma \(Size: Regular\)/);
    const second = await h.send('the first one', first.sessionId);
    const card = (second.events.find((e) => e.type === 'awaiting_approval') as any)?.proposal;
    assert.ok(card, JSON.stringify(second.events));
    assert.deepEqual(card.lines.find((l: any) => l.itemId === 'itm_shawarma').choices, [{ group: 'Size', option: 'Regular', priceNaira: 0 }]);
  });
});
