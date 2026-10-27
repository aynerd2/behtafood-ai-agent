// The controller: send, poll every second, approve and cancel, against a fake client.

import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AssistantController } from '../src/logic/controller';
import { AgentApiError, createAgentClient, type AgentClient } from '../src/logic/client';
import type { ApproveResult, StoredEvent } from '../src/logic/types';
import { NOW, PLACED, ev, happyRun, proposal, resetSeq } from './fixtures';

class FakeClient implements AgentClient {
  chats: { text: string; sessionId?: string }[] = [];
  polls: { runId: string; after: number }[] = [];
  approves: string[] = [];
  cancels: string[] = [];
  /** Each poll returns the next batch; `finished` once the batches run out. */
  batches: (StoredEvent[] | AgentApiError)[] = [];
  approveResults: (ApproveResult | AgentApiError)[] = [];
  chatError?: AgentApiError;
  all: StoredEvent[] = [];

  async chat(text: string, sessionId?: string) {
    this.chats.push({ text, sessionId });
    if (this.chatError) throw this.chatError;
    return { runId: `run_${this.chats.length}`, sessionId: null };
  }
  async events(runId: string, after: number) {
    this.polls.push({ runId, after });
    const next = this.batches.shift();
    if (next instanceof AgentApiError) throw next;
    if (next) this.all.push(...next);
    // A real server returns everything after `after`.
    return { finished: this.batches.length === 0, events: this.all.filter((e) => e.seq > after) };
  }
  async approve(id: string) {
    this.approves.push(id);
    const r = this.approveResults.shift() ?? PLACED;
    if (r instanceof AgentApiError) throw r;
    return r;
  }
  async cancel(id: string) {
    this.cancels.push(id);
    return { cancelled: true };
  }
}

function setup() {
  const client = new FakeClient();
  const sleeps: number[] = [];
  let now = NOW;
  const c = new AssistantController({
    client,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    now: () => now,
  });
  return { client, c, sleeps, advance: (ms: number) => (now += ms) };
}

beforeEach(resetSeq);

describe('AssistantController', () => {
  test('sends, polls every second with after=N, and builds the timeline as events arrive', async () => {
    const { client, c, sleeps } = setup();
    const run = happyRun();
    client.batches = [run.slice(0, 2), run.slice(2, 5), run.slice(5)];
    const seen: string[][] = [];
    c.subscribe(() => seen.push(c.getState().turns[0]?.steps.map((s) => s.tool) ?? []));
    await c.send('rice and chicken around 4000');
    assert.deepEqual(client.chats, [{ text: 'rice and chicken around 4000', sessionId: undefined }]);
    assert.deepEqual(client.polls.map((p) => p.after), [0, 2, 5]);
    assert.ok(sleeps.every((ms) => ms === 1000));
    // The timeline grew step by step, never ahead of the events.
    assert.ok(seen.some((s) => s.length === 1));
    assert.ok(seen.some((s) => s.length === 4));
    const s = c.getState();
    assert.equal(s.turns[0]!.status, 'finished');
    assert.equal(s.cards.prop_1!.status, 'awaiting');
    assert.equal(s.busy, false);
  });

  test('the next message carries the session id', async () => {
    const { client, c } = setup();
    client.batches = [happyRun()];
    await c.send('first');
    client.batches = [[ev({ type: 'reply', text: 'ok' }), ev({ type: 'done', modelCalls: 1, costUsd: 0 })]];
    await c.send('second');
    assert.equal(client.chats[1]!.sessionId, 'ses_1');
  });

  test('approve places once, shows the reference; a second tap while approving does nothing', async () => {
    const { client, c } = setup();
    client.batches = [happyRun()];
    await c.send('order');
    await Promise.all([c.approve('prop_1'), c.approve('prop_1')]);
    assert.deepEqual(client.approves, ['prop_1']);
    assert.equal(c.getState().cards.prop_1!.status, 'placed');
    assert.equal(c.getState().cards.prop_1!.order?.reference, 'ORD-ABC-123');
  });

  test('an expired card is not sent to the server; asking again sends a fresh request', async () => {
    const { client, c, advance } = setup();
    client.batches = [happyRun()];
    await c.send('order');
    advance(11 * 60_000);
    await c.approve('prop_1');
    assert.deepEqual(client.approves, []);
    client.batches = [[ev({ type: 'awaiting_approval', proposal: proposal({ proposalId: 'prop_2' }) }), ev({ type: 'done', modelCalls: 4, costUsd: 0 })]];
    await c.askAgain('prop_1');
    assert.match(client.chats.at(-1)!.text, /fresh quote.*Jollof rice & chicken \(Protein: Chicken\)/);
    assert.equal(c.getState().cards.prop_2!.status, 'awaiting');
  });

  test('a proposal the server lost (restart) asks again instead of crashing', async () => {
    const { client, c } = setup();
    client.batches = [happyRun()];
    await c.send('order');
    client.approveResults = [{ status: 'refused', code: 'NOT_FOUND', message: 'This order proposal was not found.' }];
    await c.approve('prop_1');
    const card = c.getState().cards.prop_1!;
    assert.equal(card.status, 'lost');
    assert.match(card.message ?? '', /ask/i);
  });

  test('cancel calls the server and marks the card', async () => {
    const { client, c } = setup();
    client.batches = [happyRun()];
    await c.send('order');
    await c.cancel('prop_1');
    assert.deepEqual(client.cancels, ['prop_1']);
    assert.equal(c.getState().cards.prop_1!.status, 'cancelled');
  });

  test('a choice tap sends the pick as the next message', async () => {
    const { client, c } = setup();
    client.batches = [[
      ev({ type: 'session', sessionId: 'ses_1' }),
      ev({ type: 'step', tool: 'build_cart', status: 'failed', label: 'Needs your choice', data: { needsChoice: { itemId: 'i', itemName: 'Chicken shawarma', group: 'Size', options: [{ name: 'Regular', extra_price_naira: 0 }, { name: 'Jumbo', extra_price_naira: 1000 }] } } }),
      ev({ type: 'reply', text: 'Regular or Jumbo?' }),
      ev({ type: 'done', modelCalls: 2, costUsd: 0 }),
    ]];
    await c.send('shawarma');
    client.batches = [[ev({ type: 'reply', text: 'ok' }), ev({ type: 'done', modelCalls: 1, costUsd: 0 })]];
    await c.pickChoice('Jumbo');
    assert.equal(client.chats.at(-1)!.text, 'Size: Jumbo for the Chicken shawarma, please.');
  });

  test('a poll that fails a few times recovers; too many failures fail the turn with a message', async () => {
    const { client, c } = setup();
    const run = happyRun();
    const net = () => new AgentApiError('network', 'You seem to be offline.');
    client.batches = [net(), net(), run];
    await c.send('order');
    assert.equal(c.getState().turns[0]!.status, 'finished');

    const second = setup();
    second.client.batches = [net(), net(), net(), net(), net(), net()];
    await second.c.send('order');
    const t = second.c.getState().turns[0]!;
    assert.equal(t.status, 'failed');
    assert.match(t.error?.message ?? '', /connection/i);
    assert.equal(second.c.getState().busy, false);
  });

  test('a run that never finishes stops polling after the time limit', async () => {
    const { client, c } = setup();
    client.batches = Array.from({ length: 500 }, () => []);
    await c.send('order');
    assert.equal(c.getState().turns[0]!.status, 'failed');
    assert.ok(client.polls.length <= 181);
  });

  test('signed out at send time is a failed turn with the reason, and nothing is polled', async () => {
    const { client, c } = setup();
    client.chatError = new AgentApiError('signed_out', 'Please sign in again.', 401);
    await c.send('hi');
    assert.equal(c.getState().turns[0]!.status, 'failed');
    assert.equal(c.getState().turns[0]!.error?.message, 'Please sign in again.');
    assert.equal(client.polls.length, 0);
  });

  test('cannot send while a turn is running, or an empty message', async () => {
    const { client, c } = setup();
    client.batches = [happyRun()];
    await Promise.all([c.send('one'), c.send('two'), c.send('   ')]);
    assert.deepEqual(client.chats.map((x) => x.text), ['one']);
  });
});

describe('createAgentClient', () => {
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  test('sends the customer token to the agent endpoints under the API url', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = createAgentClient({
      apiUrl: 'http://10.0.0.2:7001/api/',
      getToken: async () => 'tok',
      fetchImpl: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith('/agent/chat')) return ok({ success: true, data: { runId: 'run_1', sessionId: 'ses_1' } }, 202);
        if (url.includes('/events')) return ok({ success: true, data: { finished: true, events: [] } });
        return ok({ success: true, data: { status: 'placed', alreadyPlaced: false, order: PLACED.status === 'placed' ? PLACED.order : null } });
      }) as typeof fetch,
    });
    assert.deepEqual(await client.chat('hi', 'ses_1'), { runId: 'run_1', sessionId: 'ses_1' });
    await client.events('run_1', 3);
    await client.approve('prop_1');
    assert.deepEqual(calls.map((c) => c.url), [
      'http://10.0.0.2:7001/api/agent/chat',
      'http://10.0.0.2:7001/api/agent/runs/run_1/events?after=3',
      'http://10.0.0.2:7001/api/agent/approve',
    ]);
    for (const c of calls) assert.equal((c.init.headers as Record<string, string>).Authorization, 'Bearer tok');
    assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), { text: 'hi', sessionId: 'ses_1' });
  });

  test('maps HTTP failures to kinds the UI can explain', async () => {
    const cases: [number, string][] = [[401, 'signed_out'], [404, 'unavailable'], [429, 'rate_limited'], [503, 'unavailable'], [500, 'server'], [400, 'bad_request']];
    for (const [status, kind] of cases) {
      const client = createAgentClient({ apiUrl: 'http://x/api', getToken: async () => 't', fetchImpl: (async () => ok({ success: false, message: 'nope' }, status)) as typeof fetch });
      await assert.rejects(client.approve('p'), (e: any) => e instanceof AgentApiError && e.kind === kind, String(status));
    }
    const offline = createAgentClient({ apiUrl: 'http://x/api', getToken: async () => 't', fetchImpl: (async () => { throw new TypeError('Network request failed'); }) as typeof fetch });
    await assert.rejects(offline.chat('hi'), (e: any) => e.kind === 'network');
    const noToken = createAgentClient({ apiUrl: 'http://x/api', getToken: async () => null, fetchImpl: (async () => ok({})) as typeof fetch });
    await assert.rejects(noToken.chat('hi'), (e: any) => e.kind === 'signed_out');
  });
});
