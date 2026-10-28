// Guided mode, part 1: which real app screen each SUCCESSFUL assistant step
// maps to. Nothing is derived from a failed step, and no action is invented.

import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { VIEWING_LABEL, guideActionForPlaced, guideEffects, initialGuideMap, mapGuideEvent, type GuideAction, type GuideMapState } from '../src/logic/guide';
import type { AgentEvent } from '../src/logic/types';
import { MENU_ITEMS, PLACED, happyRun, resetSeq } from './fixtures';

beforeEach(resetSeq);

/** Feeds events through the map and collects the actions, in order. */
function run(events: AgentEvent[], start: GuideMapState = initialGuideMap()) {
  let s = start;
  const actions: GuideAction[] = [];
  events.forEach((e, i) => {
    const r = mapGuideEvent(s, `k${i}`, e);
    s = r.state;
    if (r.action) actions.push(r.action);
  });
  return { state: s, actions };
}

const SEARCH: AgentEvent = { type: 'step', tool: 'search_restaurants', status: 'done', label: 'Searched restaurants: 2 open', data: { restaurants: [{ id: 'rst_1', name: 'Iya Ewa Kitchen', delivery_fee_naira: 800 }, { id: 'rst_2', name: 'Wrap City', delivery_fee_naira: 500 }] } };
const MENU: AgentEvent = { type: 'step', tool: 'get_menu', status: 'done', label: 'Read menu: Iya Ewa Kitchen', data: { restaurantId: 'rst_1', items: MENU_ITEMS } };

describe('event to navigation map', () => {
  test('search results open the restaurant list with exactly the matching restaurants highlighted', () => {
    const { actions } = run([SEARCH]);
    assert.deepEqual(actions, [{ kind: 'show_restaurants', key: 'k0', restaurantIds: ['rst_1', 'rst_2'], label: 'Behtafood AI is viewing 2 restaurants…' }]);
    assert.deepEqual(guideEffects(actions[0]!), { route: { screen: 'home' }, highlight: { restaurantIds: ['rst_1', 'rst_2'], itemIds: [], label: VIEWING_LABEL } });
  });

  test('a menu read opens that restaurant\'s real menu', () => {
    const { actions } = run([SEARCH, MENU]);
    assert.deepEqual(actions[1], { kind: 'open_menu', key: 'k1', restaurantId: 'rst_1', label: 'Behtafood AI is viewing the menu at Iya Ewa Kitchen…' });
    assert.deepEqual(guideEffects(actions[1]!).route, { screen: 'restaurant', restaurantId: 'rst_1' });
  });

  test('the dish being considered (named in the reply) is scrolled to and highlighted', () => {
    const { actions } = run([SEARCH, MENU, { type: 'reply', text: 'Jollof rice & chicken is ₦2,500 with a protein choice.' }]);
    assert.deepEqual(actions[2], { kind: 'focus_dish', key: 'k2', restaurantId: 'rst_1', itemId: 'itm_jollof_chicken', label: 'Behtafood AI is viewing Jollof rice & chicken…' });
    assert.deepEqual(guideEffects(actions[2]!), {
      route: { screen: 'restaurant', restaurantId: 'rst_1' },
      highlight: { restaurantIds: [], restaurantId: 'rst_1', itemIds: ['itm_jollof_chicken'], label: VIEWING_LABEL },
    });
  });

  test('a choice the assistant needs focuses that dish', () => {
    const { actions } = run([SEARCH, MENU, { type: 'step', tool: 'build_cart', status: 'failed', label: 'Needs your choice', data: { needsChoice: { itemId: 'itm_jollof_chicken', itemName: 'Jollof rice & chicken', group: 'Protein', options: [] } } }]);
    assert.equal(actions[2]!.kind, 'focus_dish');
  });

  test('an added item animates into the AI\'s cart, and says the customer\'s own cart is unchanged', () => {
    const cart = happyRun()[3]!.event;
    const { actions } = run([SEARCH, MENU, cart]);
    const a = actions[2]!;
    assert.equal(a.kind, 'add_to_cart');
    assert.match(a.label, /1 x Jollof rice & chicken \(Protein: Chicken\)/);
    assert.match(a.label, /your own cart is unchanged/);
    const fx = guideEffects(a);
    assert.deepEqual(fx.route, { screen: 'restaurant', restaurantId: 'rst_1' });
    assert.deepEqual(fx.highlight?.itemIds, ['itm_jollof_chicken']);
    assert.deepEqual(fx.fly, [{ itemId: 'itm_jollof_chicken', name: 'Jollof rice & chicken', quantity: 1 }]);
  });

  test('a proposal brings up the approval card without moving screens', () => {
    const p = happyRun()[6]!.event;
    const { actions } = run([p]);
    assert.deepEqual(actions, [{ kind: 'show_approval', key: 'k0', proposalId: 'prop_1', label: 'Waiting for your approval' }]);
    assert.deepEqual(guideEffects(actions[0]!), {});
  });

  test('after approval, the real order tracking screen opens for the new order', () => {
    const a = guideActionForPlaced((PLACED as any).order, 'placed:prop_1');
    assert.deepEqual(a, { kind: 'open_tracking', key: 'placed:prop_1', orderId: 'ord_9', reference: 'ORD-ABC-123', label: 'Order placed: ORD-ABC-123. Opening tracking…' });
    assert.deepEqual(guideEffects(a), { route: { screen: 'tracking', orderId: 'ord_9' }, highlight: null });
  });

  test('truthfulness: failed steps, errors and bookkeeping events never move a screen', () => {
    const { actions } = run([
      { type: 'session', sessionId: 's' },
      { ...SEARCH, status: 'failed' } as AgentEvent,
      { ...MENU, status: 'failed' } as AgentEvent,
      { type: 'step', tool: 'build_cart', status: 'failed', label: 'Cart rejected', data: undefined },
      { type: 'step', tool: 'quote_order', status: 'done', label: 'Got the server quote' },
      { type: 'error', code: 'call_cap', message: 'stopped' },
      { type: 'reply', text: 'Sorry, nothing found.' },
      { type: 'done', modelCalls: 2, costUsd: 0 },
    ]);
    assert.deepEqual(actions, []);
  });

  test('every highlight is labelled "Behtafood AI is viewing…"', () => {
    const { actions } = run(happyRun().map((e) => e.event).concat([{ type: 'reply', text: 'Jollof rice & chicken it is.' }]));
    const highlights = actions.map(guideEffects).filter((fx) => fx.highlight).map((fx) => fx.highlight!.label);
    assert.ok(highlights.length >= 3);
    assert.ok(highlights.every((l) => l === 'Behtafood AI is viewing…'));
  });
});
