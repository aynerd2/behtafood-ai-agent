// HTTP surface: flag off means 404, auth required, chat streams timeline events,
// approval goes through its own endpoint.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { ScriptedDemoModel, type TimelineEvent } from '@behtafood-agent/agent-core';
import { createMockServer } from '../src/server';

async function start(agentEnabled: boolean) {
  const app = createMockServer({ agentEnabled, model: new ScriptedDemoModel() });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  return { ...app, base, close: () => new Promise<void>((r) => app.server.close(() => r())) };
}

async function chat(base: string, body: object, token = 'demo-token-ada'): Promise<TimelineEvent[]> {
  const res = await fetch(`${base}/api/agent/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((b) => b.startsWith('data: '))
    .map((b) => JSON.parse(b.slice(6)) as TimelineEvent);
}

describe('mock API server', () => {
  test('with AGENT_ENABLED off, every agent route is 404', async () => {
    const s = await start(false);
    try {
      for (const path of ['/api/agent/chat', '/api/agent/approve', '/api/agent/usage']) {
        const res = await fetch(s.base + path, { method: path.endsWith('usage') ? 'GET' : 'POST', headers: { Authorization: 'Bearer demo-token-ada' } });
        assert.equal(res.status, 404, path);
      }
    } finally {
      await s.close();
    }
  });

  test('requires a customer token', async () => {
    const s = await start(true);
    try {
      const res = await fetch(`${s.base}/api/agent/chat`, { method: 'POST', body: '{"message":"hi"}' });
      assert.equal(res.status, 401);
    } finally {
      await s.close();
    }
  });

  test('streams the demo path and approves through the approval endpoint', async () => {
    const s = await start(true);
    try {
      const e1 = await chat(s.base, { message: 'rice and chicken around ₦3,000' });
      const session = e1.find((e) => e.type === 'session');
      assert.ok(session && session.type === 'session');
      assert.ok(e1.some((e) => e.type === 'reply'));

      const e2 = await chat(s.base, { message: '1', sessionId: session.sessionId });
      const card = e2.find((e) => e.type === 'awaiting_approval');
      assert.ok(card && card.type === 'awaiting_approval');

      // Another customer cannot approve it.
      const stolen = await fetch(`${s.base}/api/agent/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo-token-tunde' },
        body: JSON.stringify({ proposalId: card.proposal.proposalId }),
      });
      assert.equal(((await stolen.json()) as { status: string }).status, 'refused');

      const approve = () =>
        fetch(`${s.base}/api/agent/approve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo-token-ada' },
          body: JSON.stringify({ proposalId: card.proposal.proposalId }),
        }).then((r) => r.json() as Promise<{ status: string; order?: { reference: string } }>);
      const [a, b] = await Promise.all([approve(), approve()]);
      assert.equal(a.status, 'placed');
      assert.equal(b.status, 'placed');
      assert.equal(s.port.orders.length, 1);

      const usage = await fetch(`${s.base}/api/agent/usage`, { headers: { Authorization: 'Bearer demo-token-ada' } });
      const u = (await usage.json()) as { modelCalls: number };
      assert.ok(u.modelCalls > 0);
    } finally {
      await s.close();
    }
  });
});
