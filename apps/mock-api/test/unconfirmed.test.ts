// An approval whose outcome was not confirmed must never become
// "expired" on its own. Every later Approve or check looks the order up by its
// checkoutSessionId first, so a placed order is reported, never placed twice,
// and the customer may ask again only once the lookup confirms there is none.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PROPOSAL_TTL_MS, ProposalStore, type Cart } from '@behtafood-agent/agent-core';
import { MockBehtafoodPort } from '../src/mockPort';
import { ADA, FakeClock, TUNDE } from './helpers';

const CART: Cart = { restaurantId: 'rst_fountain', lines: [{ itemId: 'itm_akara', quantity: 1 }, { itemId: 'itm_agoyin_cafe', quantity: 1 }] };
const LATER = PROPOSAL_TTL_MS + 60_000;

async function fixture() {
  const clock = new FakeClock();
  const port = new MockBehtafoodPort(clock.fn);
  const proposals = new ProposalStore(port, { clock: clock.fn });
  const p = proposals.create(ADA, { sessionId: 's1', cart: CART, quote: await port.quoteOrder(ADA, CART) });
  return { clock, port, proposals, p };
}

/** The order is created, the response is lost, and the immediate lookup fails too. */
async function unconfirmedButPlaced() {
  const f = await fixture();
  f.port.nextPlaceOrderFault = 'lost_response';
  f.port.failLookups = 1;
  const r = await f.proposals.approve(ADA, f.p.id);
  assert.equal(r.status, 'uncertain');
  assert.equal(f.port.orders.length, 1, 'the order really exists');
  return f;
}

/** Nothing is created, and the immediate lookup fails. */
async function unconfirmedNotPlaced() {
  const f = await fixture();
  f.port.nextPlaceOrderFault = 'before_commit';
  f.port.failLookups = 1;
  const r = await f.proposals.approve(ADA, f.p.id);
  assert.equal(r.status, 'uncertain');
  assert.equal(f.port.orders.length, 0);
  return f;
}

describe('an unconfirmed approval', () => {
  test('stays unconfirmed: it is not expired by time, and cannot be cancelled', async () => {
    const { proposals, p, clock } = await unconfirmedButPlaced();
    assert.equal(proposals.get(ADA, p.id)!.state, 'unconfirmed');
    clock.advance(LATER);
    assert.equal(proposals.get(ADA, p.id)!.state, 'unconfirmed');
    assert.equal(proposals.cancel(ADA, p.id), false);
  });

  test('Approve after 10 minutes finds the placed order instead of saying expired', async () => {
    const { proposals, p, port, clock } = await unconfirmedButPlaced();
    clock.advance(LATER);
    const r = await proposals.approve(ADA, p.id);
    assert.equal(r.status, 'placed');
    assert.equal(r.status === 'placed' && r.alreadyPlaced, true);
    assert.equal(r.status === 'placed' && r.order.reference, port.orders[0]!.reference);
    assert.equal(port.placeOrderCalls, 1);
    assert.equal(port.wallet('cus_ada'), 12000);
  });

  test('check() reports the placed order without placing anything', async () => {
    const { proposals, p, port, clock } = await unconfirmedButPlaced();
    clock.advance(LATER);
    const r = await proposals.check(ADA, p.id);
    assert.equal(r.status, 'placed');
    assert.equal(r.status === 'placed' && r.order.checkoutSessionId, p.id);
    assert.equal(port.placeOrderCalls, 1);
  });

  test('when the lookup confirms no order: before expiry Approve places one; after expiry it says expired and the customer may ask again', async () => {
    const early = await unconfirmedNotPlaced();
    const placed = await early.proposals.approve(ADA, early.p.id);
    assert.equal(placed.status, 'placed');
    assert.equal(early.port.placeOrderCalls, 1);

    const late = await unconfirmedNotPlaced();
    late.clock.advance(LATER);
    const r = await late.proposals.approve(ADA, late.p.id);
    assert.equal(r.status === 'refused' && r.code, 'EXPIRED');
    assert.equal(late.port.placeOrderCalls, 0);
    const check = await late.proposals.check(ADA, late.p.id);
    assert.equal(check.status, 'not_placed');
  });

  test('when the lookup itself fails, it says we could not check and points to My Orders; nothing is placed', async () => {
    const { proposals, p, port, clock } = await unconfirmedNotPlaced();
    clock.advance(LATER);
    port.failLookups = 1;
    const r = await proposals.approve(ADA, p.id);
    assert.equal(r.status, 'uncertain');
    assert.equal(r.status === 'uncertain' && r.lookupFailed, true);
    assert.match(r.status === 'uncertain' ? r.message : '', /couldn.t check/i);
    assert.match(r.status === 'uncertain' ? r.message : '', /My Orders/);
    assert.equal(proposals.get(ADA, p.id)!.state, 'unconfirmed');
    port.failLookups = 1;
    const c = await proposals.check(ADA, p.id);
    assert.equal(c.status, 'check_failed');
    assert.match(c.status === 'check_failed' ? c.message : '', /My Orders/);
    assert.equal(port.placeOrderCalls, 0);
  });
});

describe('check() for any card', () => {
  test('a proposal the server no longer knows (restart) is still looked up by its id', async () => {
    const { port, p } = await unconfirmedButPlaced();
    const restarted = new ProposalStore(port);
    const r = await restarted.check(ADA, p.id);
    assert.equal(r.status, 'placed');
    const again = await restarted.approve(ADA, p.id);
    assert.equal(again.status, 'placed');
    assert.equal(port.placeOrderCalls, 1);
  });

  test('a proposal that never reached placement is not_placed; another customer learns nothing', async () => {
    const { proposals, p } = await fixture();
    assert.equal((await proposals.check(ADA, p.id)).status, 'not_placed');
    await proposals.approve(ADA, p.id);
    assert.equal((await proposals.check(ADA, p.id)).status, 'placed');
    assert.equal((await proposals.check(TUNDE, p.id)).status, 'not_placed');
  });
});
