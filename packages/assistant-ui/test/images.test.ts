// Card thumbnails: image URLs come from display data only, are resolved
// against the API's own host when relative, and anything that is not a plain
// http(s) image link is dropped (so a card shows its icon, never a broken slot).

import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRunEvents, initialState, startTurn, turnAccepted } from '../src/logic/conversation';
import { imageSource } from '../src/logic/format';
import { ev, proposal, resetSeq } from './fixtures';

beforeEach(resetSeq);

describe('imageSource', () => {
  const API = 'http://192.168.0.5:7001/api';
  test('keeps absolute http(s) URLs', () => {
    assert.equal(imageSource('https://res.cloudinary.com/x/y.jpg', API), 'https://res.cloudinary.com/x/y.jpg');
    assert.equal(imageSource('http://10.0.0.2:7001/dev-assets/food/a.jpg', API), 'http://10.0.0.2:7001/dev-assets/food/a.jpg');
  });
  test('resolves a root-relative path against the API host', () => {
    assert.equal(imageSource('/assets/food/dish-suya.jpg', API), 'http://192.168.0.5:7001/assets/food/dish-suya.jpg');
    assert.equal(imageSource('/assets/food/dish-suya.jpg', 'https://api.example.test'), 'https://api.example.test/assets/food/dish-suya.jpg');
  });
  test('drops anything else', () => {
    for (const bad of [undefined, null, '', 42, 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///etc/passwd', '//evil.test/x.jpg', 'assets/x.jpg', 'http://', 'https://a b/c.jpg']) {
      assert.equal(imageSource(bad, API), undefined, String(bad));
    }
    assert.equal(imageSource('/assets/food/a.jpg', 'not a url'), undefined);
  });
});

describe('cards carry thumbnails from the events', () => {
  test('restaurants, cart lines and the approval card get their image URLs; bad values are dropped', () => {
    let s = startTurn(initialState(), 't1', 'rice');
    s = turnAccepted(s, 't1', { runId: 'run_1', sessionId: null });
    const p = proposal({ restaurantImageUrl: '/assets/food/cover-iya-ewa-kitchen.jpg' });
    p.lines[0]!.imageUrl = '/assets/food/dish-jollof-rice-chicken.jpg';
    s = applyRunEvents(s, 't1', [
      ev({ type: 'step', tool: 'search_restaurants', status: 'done', label: 'Searched', data: { restaurants: [
        { id: 'rst_1', name: 'Iya Ewa Kitchen', delivery_fee_naira: 300, imageUrl: '/assets/food/cover-iya-ewa-kitchen.jpg' },
        { id: 'rst_2', name: 'No Picture', delivery_fee_naira: 500, imageUrl: 42 },
      ] } }),
      ev({ type: 'step', tool: 'build_cart', status: 'done', label: 'Built cart', data: { cartId: 'cart_1', restaurantId: 'rst_1', items: [
        { itemId: 'itm_1', name: 'Jollof Rice & Chicken', quantity: 1, imageUrl: '/assets/food/dish-jollof-rice-chicken.jpg' },
        { itemId: 'itm_2', name: 'Zobo', quantity: 1, imageUrl: { x: 1 } },
      ] } }),
      ev({ type: 'awaiting_approval', proposal: p }),
    ], false);
    const t = s.turns[0]!;
    assert.equal(t.restaurants![0]!.imageUrl, '/assets/food/cover-iya-ewa-kitchen.jpg');
    assert.equal('imageUrl' in t.restaurants![1]!, false);
    assert.equal(t.carts[0]!.items[0]!.imageUrl, '/assets/food/dish-jollof-rice-chicken.jpg');
    assert.equal('imageUrl' in t.carts[0]!.items[1]!, false);
    assert.equal(s.cards.prop_1!.proposal.restaurantImageUrl, '/assets/food/cover-iya-ewa-kitchen.jpg');
    assert.equal(s.cards.prop_1!.proposal.lines[0]!.imageUrl, '/assets/food/dish-jollof-rice-chicken.jpg');
  });
});
