// Approval cards survive a server restart (within their 10 minutes) when the
// store has durable persistence. A fake in-memory "database" stands in for it.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ProposalStore, type Proposal, type ProposalPersistence } from '@behtafood-agent/agent-core';
import { ADA, TUNDE, FakeClock, FnModel, harness, toolCall } from './helpers';

class FakeDb implements ProposalPersistence {
  readonly rows = new Map<string, string>();
  async save(p: Proposal) { this.rows.set(p.id, JSON.stringify(p)); }
  async load(id: string) { const r = this.rows.get(id); return r ? (JSON.parse(r) as Proposal) : null; }
}

async function proposeAkara(db: FakeDb, clock = new FakeClock()) {
  const model = new FnModel((_m, n) => {
    if (n === 1) return { content: null, tool_calls: [toolCall('build_cart', { fulfilment: 'delivery', restaurant_id: 'rst_fountain', items: [{ item_id: 'itm_akara', quantity: 1 }] })] };
    if (n === 2) return { content: null, tool_calls: [toolCall('quote_order', { cart_id: 'cart_1' })] };
    if (n === 3) return { content: null, tool_calls: [toolCall('propose_order', { quote_id: 'quote_1' })] };
    return { content: 'Tap Approve.' };
  });
  const h = harness({ model, clock, proposals: undefined });
  // Swap in a store that persists, wired to the same port.
  const store = new ProposalStore(h.port, { clock: clock.fn, persistence: db });
  (h.agent as any).proposals = store;
  const events: any[] = [];
  await h.agent.handleMessage(ADA, { text: 'akara' }, (e) => events.push(e));
  const card = events.find((e) => e.type === 'awaiting_approval');
  assert.ok(card);
  return { h, clock, id: card.proposal.proposalId as string };
}

describe('approval survives a restart', () => {
  test('the card is saved before it is shown, and a fresh store can approve it once', async () => {
    const db = new FakeDb();
    const { h, clock, id } = await proposeAkara(db);
    assert.ok(db.rows.has(id));

    const restarted = new ProposalStore(h.port, { clock: clock.fn, persistence: db });
    const r = await restarted.approve(ADA, id);
    assert.equal(r.status, 'placed');
    assert.equal(h.port.orders.length, 1);

    // Approving again (another restart) never places a second order.
    const again = await new ProposalStore(h.port, { clock: clock.fn, persistence: db }).approve(ADA, id);
    assert.equal(again.status, 'placed');
    assert.equal(h.port.orders.length, 1);
  });

  test('still expires after 10 minutes', async () => {
    const db = new FakeDb();
    const { h, clock, id } = await proposeAkara(db);
    clock.advance(10 * 60 * 1000 + 1);
    const r = await new ProposalStore(h.port, { clock: clock.fn, persistence: db }).approve(ADA, id);
    assert.deepEqual({ status: r.status, code: (r as any).code }, { status: 'refused', code: 'EXPIRED' });
    assert.equal(h.port.orders.length, 0);
  });

  test('another customer cannot load it', async () => {
    const db = new FakeDb();
    const { h, clock, id } = await proposeAkara(db);
    const r = await new ProposalStore(h.port, { clock: clock.fn, persistence: db }).approve(TUNDE, id);
    assert.equal(r.status, 'refused');
    assert.equal(h.port.orders.length, 0);
  });

  test('a card cancelled before the restart stays cancelled', async () => {
    const db = new FakeDb();
    const { h, clock, id } = await proposeAkara(db);
    (h.agent.proposals as ProposalStore).cancel(ADA, id);
    await new Promise((r) => setImmediate(r));
    const r = await new ProposalStore(h.port, { clock: clock.fn, persistence: db }).approve(ADA, id);
    assert.deepEqual({ status: r.status, code: (r as any).code }, { status: 'refused', code: 'CANCELLED' });
  });

  test('a card caught mid-placement is looked up first, never placed twice', async () => {
    const db = new FakeDb();
    const { h, clock, id } = await proposeAkara(db);
    // Place it, then rewrite the saved row as if the server died while placing.
    await new ProposalStore(h.port, { clock: clock.fn, persistence: db }).approve(ADA, id);
    const row = JSON.parse(db.rows.get(id)!);
    db.rows.set(id, JSON.stringify({ ...row, state: 'placing', order: undefined }));
    const r = await new ProposalStore(h.port, { clock: clock.fn, persistence: db }).approve(ADA, id);
    assert.equal(r.status, 'placed');
    assert.equal(h.port.orders.length, 1);
  });
});
