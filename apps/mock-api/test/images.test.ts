// Food images: the mock data has a real, credited image for every restaurant
// and dish; the app's cards get them as display data; the model never does.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { ScriptedDemoModel, type ModelClient, type ModelRequest } from '@behtafood-agent/agent-core';
import { seedMenu, seedRestaurants } from '../src/data';
import { createMockServer } from '../src/server';
import { ADA, harness } from './helpers';

const ASSETS = path.resolve(import.meta.dirname, '../../../assets/food');
const URL_RE = /^\/assets\/food\/[a-z0-9-]+\.jpg$/;
const fileOf = (url: string | undefined) => {
  assert.match(url ?? '', URL_RE);
  const f = path.join(ASSETS, path.basename(url!));
  assert.ok(fs.existsSync(f), `${f} exists`);
  return f;
};
/** The offline scripted model, recording every request it is sent. */
class RecordingModel implements ModelClient {
  readonly model = 'scripted-demo';
  readonly requests: ModelRequest[] = [];
  readonly #inner = new ScriptedDemoModel();
  complete(req: ModelRequest) {
    this.requests.push(structuredClone(req));
    return this.#inner.complete(req);
  }
}

const DEMO_ASK = 'Find me something filling around ₦3,000. I want rice and chicken delivered to my location.';

describe('mock data matches the demo seed', () => {
  test('three open Ado-Ekiti restaurants with 8 dishes each, ₦800 to ₦3,500, every one with a credited image', () => {
    const open = seedRestaurants().filter((r) => r.isOpen && !r.adminForceClosed);
    assert.deepEqual(open.map((r) => r.name), ['Iya Ewa Kitchen', 'Bukka Ekiti Grill', 'Fountain Bites Cafe']);
    for (const r of seedRestaurants()) {
      fileOf(r.logoUrl);
      fileOf(r.coverUrl);
    }
    for (const r of open) {
      const dishes = seedMenu().filter((m) => m.restaurantId === r.id && !m.testProbe);
      assert.equal(dishes.length, 8, r.name);
      for (const d of dishes) {
        assert.ok(d.priceNaira >= 800 && d.priceNaira <= 3500, `${d.name} ${d.priceNaira}`);
        assert.ok((d.description ?? '').length > 15, d.name);
      }
    }
    for (const m of seedMenu()) fileOf(m.imageUrl);
  });

  test('the manifest credits every image file and the folder stays small', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ASSETS, 'manifest.json'), 'utf8'));
    const files = fs.readdirSync(ASSETS).filter((f) => f.endsWith('.jpg')).sort();
    assert.deepEqual(manifest.files.map((m: { file: string }) => m.file).sort(), files);
    let total = 0;
    for (const m of manifest.files) {
      const size = fs.statSync(path.join(ASSETS, m.file)).size;
      total += size;
      assert.ok(size < 150 * 1024, m.file);
      assert.ok(m.title && m.author && m.licence, m.file);
      if (m.source === 'wikimedia-commons') assert.match(m.sourceUrl, /^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      else if (m.source === 'ai-generated') assert.ok(m.prompt && m.model && m.date, m.file);
      else assert.ok(m.source === 'drawn-for-demo' && ['logo', 'avatar'].includes(m.kind), m.file);
    }
    assert.ok(total < 8 * 1024 * 1024);
    assert.ok(fs.existsSync(path.join(ASSETS, 'CREDITS.md')));
  });
});

describe('images reach the app cards, never the model', () => {
  test('search, menu and cart steps and the approval card carry image URLs; no model request does', async () => {
    const model = new RecordingModel();
    const h = harness({ model });
    const t1 = await h.send(DEMO_ASK);
    const search = t1.events.find((e) => e.type === 'step' && e.tool === 'search_restaurants') as any;
    assert.ok(search.data.restaurants.length > 0);
    for (const r of search.data.restaurants) fileOf(r.imageUrl);
    const menu = t1.events.find((e) => e.type === 'step' && e.tool === 'get_menu') as any;
    for (const i of menu.data.items) fileOf(i.imageUrl);

    const t2 = await h.send('I will take option 1', t1.sessionId);
    const cart = t2.events.find((e) => e.type === 'step' && e.tool === 'build_cart') as any;
    for (const i of cart.data.items) fileOf(i.imageUrl);
    const card = t2.events.find((e) => e.type === 'awaiting_approval') as any;
    fileOf(card.proposal.restaurantImageUrl);
    for (const l of card.proposal.lines) fileOf(l.imageUrl);

    const sent = JSON.stringify(model.requests);
    assert.ok(sent.length > 1000, 'the scripted model kept its requests');
    assert.doesNotMatch(sent, /assets\/food|imageUrl|\.jpg/);
  });

  test('a price-changed proposal keeps its images', async () => {
    const h = harness({ model: new ScriptedDemoModel() });
    const t1 = await h.send(DEMO_ASK);
    const t2 = await h.send('I will take option 1', t1.sessionId);
    const card = t2.events.find((e) => e.type === 'awaiting_approval') as any;
    h.port.setPrice(card.proposal.lines[0].itemId, card.proposal.lines[0].unitPriceNaira + 100);
    const r = await h.agent.proposals.approve(ADA, card.proposal.proposalId);
    assert.equal(r.status, 'price_changed');
    if (r.status === 'price_changed') {
      fileOf(r.proposal.restaurantImageUrl);
      for (const l of r.proposal.lines) fileOf(l.imageUrl);
    }
  });
});

describe('mock server serves the images', () => {
  test('GET /assets/food/<file>.jpg, nothing else, with the agent on or off', async () => {
    for (const agentEnabled of [true, false]) {
      const app = createMockServer({ agentEnabled, model: new ScriptedDemoModel() });
      await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
      const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
      try {
        const ok = await fetch(`${base}/assets/food/dish-suya.jpg`);
        assert.equal(ok.status, 200);
        assert.match(ok.headers.get('content-type') ?? '', /image\/jpeg/);
        assert.ok((await ok.arrayBuffer()).byteLength > 1000);
        assert.equal((await fetch(`${base}/assets/food/manifest.json`)).status, 404);
        assert.equal((await fetch(`${base}/assets/food/..%2f..%2fpackage.json`)).status, 404);
        assert.equal((await fetch(`${base}/assets/food/nope.jpg`)).status, 404);
      } finally {
        await new Promise<void>((r) => app.server.close(() => r()));
      }
    }
  });
});
