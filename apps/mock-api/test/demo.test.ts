// The demo path end to end with the offline scripted model, plus the
// timeline and budget rules the UI depends on.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ScriptedDemoModel, type TimelineEvent } from '@behtafood-agent/agent-core';
import { MockBehtafoodPort } from '../src/mockPort';
import { ADA, harness, sequenceModel, toolCall } from './helpers';

const DEMO_ASK = 'Find me something filling around ₦3,000. I want rice and chicken delivered to my location.';

describe('demo path: ask, options, pick, quote, approve, one order', () => {
  test('completes against the mock API', async () => {
    const h = harness({ model: new ScriptedDemoModel() });

    const t1 = await h.send(DEMO_ASK);
    const tools1 = t1.events.flatMap((e) => (e.type === 'step' ? [`${e.tool}:${e.status}`] : []));
    assert.deepEqual(tools1.slice(0, 2), ['search_restaurants:done', 'get_menu:done']);
    const reply1 = t1.events.find((e) => e.type === 'reply');
    assert.ok(reply1 && reply1.type === 'reply');
    assert.match(reply1.text, /1\./);
    assert.ok(!t1.events.some((e) => e.type === 'awaiting_approval'), 'no card before the customer picks');

    const t2 = await h.send('I will take option 1, delivered', t1.sessionId);
    const tools2 = t2.events.flatMap((e) => (e.type === 'step' ? [`${e.tool}:${e.status}`] : []));
    assert.deepEqual(tools2, ['build_cart:done', 'quote_order:done', 'propose_order:done']);
    const card = t2.events.find((e) => e.type === 'awaiting_approval');
    assert.ok(card && card.type === 'awaiting_approval');
    assert.ok(card.proposal.totalNaira <= 3000, 'budget includes the delivery fee');
    assert.equal(h.port.orders.length, 0, 'nothing is bought before Approve');

    const approved = await h.agent.proposals.approve(ADA, card.proposal.proposalId);
    assert.equal(approved.status, 'placed');
    assert.equal(h.port.orders.length, 1);
    assert.equal(h.port.wallet('cus_ada'), 15000 - card.proposal.totalNaira);
  });

  test('every item id offered exists on the restaurant menu', async () => {
    const h = harness({ model: new ScriptedDemoModel() });
    const t1 = await h.send(DEMO_ASK);
    const t2 = await h.send('2, delivery', t1.sessionId);
    const card = t2.events.find((e) => e.type === 'awaiting_approval');
    assert.ok(card && card.type === 'awaiting_approval');
    const menu = new MockBehtafoodPort().menu;
    for (const l of card.proposal.lines) assert.ok(menu.some((m) => m.id === l.itemId));
  });
});

describe('timeline', () => {
  test('a step is emitted only after its tool call has returned', async () => {
    const model = sequenceModel([{ content: null, tool_calls: [toolCall('get_menu', { restaurant_id: 'rst_fountain' })] }]);
    const h = harness({ model });
    let returned = false;
    const realGetMenu = h.port.getMenu.bind(h.port);
    h.port.getMenu = async (ctx, id) => {
      await new Promise((r) => setTimeout(r, 30));
      const out = await realGetMenu(ctx, id);
      returned = true;
      return out;
    };
    const seen: boolean[] = [];
    await h.agent.handleMessage(ADA, { text: 'menu please' }, (e: TimelineEvent) => {
      if (e.type === 'step') seen.push(returned);
    });
    assert.deepEqual(seen, [true]);
  });

  test('a failed tool shows as failed, never as done', async () => {
    const model = sequenceModel([{ content: null, tool_calls: [toolCall('get_menu', { restaurant_id: 'rst_nope' })] }]);
    const h = harness({ model });
    const r = await h.send('menu please');
    const step = r.events.find((e) => e.type === 'step');
    assert.ok(step && step.type === 'step');
    assert.equal(step.status, 'failed');
  });

  test('awaiting approval is its own event, separate from done steps', async () => {
    const h = harness({ model: new ScriptedDemoModel() });
    const t1 = await h.send(DEMO_ASK);
    const t2 = await h.send('1 delivery please', t1.sessionId);
    const types = t2.events.map((e) => e.type);
    assert.ok(types.includes('awaiting_approval'));
    assert.ok(types.indexOf('awaiting_approval') > types.lastIndexOf('step') - 1);
  });
});

describe('budget includes the delivery fee', () => {
  test('propose_order refuses a quote over the stated budget', async () => {
    const model = sequenceModel([
      { content: null, tool_calls: [toolCall('search_restaurants', { query: 'rice chicken', budget_naira: 2800 })] },
      { content: null, tool_calls: [toolCall('build_cart', { fulfilment: 'delivery', restaurant_id: 'rst_fountain', items: [{ item_id: 'itm_akara', quantity: 1 }, { item_id: 'itm_agoyin_cafe', quantity: 1 }] })] },
      { content: null, tool_calls: [toolCall('quote_order', { cart_id: 'cart_1' })] },
      { content: null, tool_calls: [toolCall('propose_order', { quote_id: 'quote_1' })] },
      { content: 'That is over your budget.' },
    ]);
    const h = harness({ model });
    const r = await h.send('rice and chicken, 2800 max');
    const quote = r.events.find((e) => e.type === 'step' && e.tool === 'quote_order');
    assert.ok(quote && quote.type === 'step');
    assert.deepEqual((quote.data as { within_budget: boolean }).within_budget, false); // 2800 food + 200 delivery
    const propose = r.events.find((e) => e.type === 'step' && e.tool === 'propose_order');
    assert.ok(propose && propose.type === 'step' && propose.status === 'failed');
    assert.ok(!r.events.some((e) => e.type === 'awaiting_approval'));
  });
});
