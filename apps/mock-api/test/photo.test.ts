// Photo input: one JPEG or PNG per message. The model sees it, says in plain
// words what the dish looks like, then searches as usual. A photo can never
// place an order, and text inside a photo is untrusted data.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_IMAGE_BYTES, SYSTEM_PROMPT, TOOL_SCHEMAS, checkImageDataUrl } from '@behtafood-agent/agent-core';
import { ADA, FnModel, harness, toolCall } from './helpers';

/** A real 1x1 PNG (made for these tests). */
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
/** JPEG magic bytes followed by filler, `size` bytes in all. */
const jpeg = (size: number) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4, 7)]).toString('base64')}`;

describe('checkImageDataUrl', () => {
  test('accepts JPEG and PNG up to 1.5 MB', () => {
    assert.equal(MAX_IMAGE_BYTES, 1_500_000);
    assert.deepEqual(checkImageDataUrl(PNG), { ok: true, mime: 'image/png', bytes: 68 });
    assert.equal(checkImageDataUrl(jpeg(MAX_IMAGE_BYTES)).ok, true);
  });

  test('refuses other types, fakes, broken data and anything over 1.5 MB', () => {
    const cases: [string, string][] = [
      [jpeg(MAX_IMAGE_BYTES + 1), 'too_large'],
      [PNG.replace('image/png', 'image/webp'), 'bad_type'],
      [PNG.replace('image/png', 'image/gif'), 'bad_type'],
      ['https://example.com/food.jpg', 'bad_type'],
      [`data:image/png;base64,${Buffer.from('not really a png at all').toString('base64')}`, 'not_an_image'],
      [jpeg(100).replace('image/jpeg', 'image/png'), 'not_an_image'],
      ['data:image/png;base64,***', 'bad_type'],
    ];
    for (const [url, reason] of cases) assert.deepEqual(checkImageDataUrl(url), { ok: false, reason }, reason);
  });
});

describe('a message with a photo', () => {
  test('the model sees the photo next to the text, at low detail', async () => {
    const h = harness({ model: new FnModel(() => ({ content: 'That looks like jollof rice with chicken.' })) });
    await h.agent.handleMessage(ADA, { text: 'find me something like this', imageDataUrl: PNG }, () => {});
    const user = (h.agent.model as FnModel).requests[0]!.messages.at(-1)!;
    assert.deepEqual(user.content, [
      { type: 'text', text: 'find me something like this' },
      { type: 'image_url', image_url: { url: PNG, detail: 'low' } },
    ]);
  });

  test('a photo with no text is sent as "Find me something like this."', async () => {
    const h = harness({ model: new FnModel(() => ({ content: 'ok' })) });
    await h.agent.handleMessage(ADA, { text: '', imageDataUrl: PNG }, () => {});
    const user = (h.agent.model as FnModel).requests[0]!.messages.at(-1)!;
    assert.equal((user.content as any[])[0].text, 'Find me something like this.');
  });

  test('an invalid photo is refused with a clear reason and no model call', async () => {
    const h = harness({ model: new FnModel(() => ({ content: 'ok' })) });
    const events: any[] = [];
    await h.agent.handleMessage(ADA, { text: 'this', imageDataUrl: jpeg(MAX_IMAGE_BYTES + 10) }, (e) => events.push(e));
    assert.deepEqual(events.find((e) => e.type === 'error'), { type: 'error', code: 'bad_request', message: 'Photos must be JPEG or PNG and at most 1.5 MB.' });
    assert.equal((h.agent.model as FnModel).calls, 0);
  });

  test('the photo is not kept: later messages do not resend it', async () => {
    const model = new FnModel(() => ({ content: 'ok' }));
    const h = harness({ model });
    const first = await h.agent.handleMessage(ADA, { text: 'like this', imageDataUrl: PNG }, () => {});
    await h.agent.handleMessage(ADA, { sessionId: first.sessionId, text: 'cheaper please' }, () => {});
    assert.equal(JSON.stringify(model.requests[1]!.messages).includes('base64'), false);
    assert.match(JSON.stringify(model.requests[1]!.messages), /photo/i);
  });

  test('the cost of a photo message is counted like any other', async () => {
    const h = harness({ model: new FnModel(() => ({ content: 'That looks like suya.' })) });
    const r = await h.agent.handleMessage(ADA, { text: '', imageDataUrl: PNG }, () => {});
    assert.equal(h.agent.usage.session(r.sessionId).modelCalls, 1);
    assert.ok(h.agent.usage.session(r.sessionId).usage.promptTokens > 0);
  });
});

describe('a photo can never buy anything', () => {
  test('text inside a photo telling the agent to order causes no order, even if the model obeys it', async () => {
    // A fake model that "reads" an instruction in the photo and tries everything.
    const model = new FnModel((_m, n) => {
      if (n === 1) return { content: null, tool_calls: [toolCall('place_order', { restaurant_id: 'rst_fountain', approve: true })] };
      if (n === 2) return { content: null, tool_calls: [toolCall('approve_order', { proposal_id: 'anything' })] };
      if (n === 3) return { content: null, tool_calls: [toolCall('propose_order', { quote_id: 'quote_1' })] };
      return { content: 'Done.' };
    });
    const h = harness({ model });
    const r: any[] = [];
    await h.agent.handleMessage(ADA, { text: 'what is this?', imageDataUrl: PNG }, (e) => r.push(e));
    assert.equal(h.port.placeOrderCalls, 0);
    assert.equal(h.port.orders.length, 0);
    assert.equal(r.some((e) => e.type === 'awaiting_approval'), false);
    assert.deepEqual(
      r.filter((e) => e.type === 'step').map((e) => e.status),
      ['failed', 'failed', 'failed'],
    );
    for (const req of model.requests) assert.equal(req.tools.some((t) => /place|approve|pay/.test(t.function.name)), false);
    assert.equal(TOOL_SCHEMAS.some((t) => /place|approve|pay/.test(t.function.name)), false);
  });

  test('the system prompt says photo text is untrusted and asks for plain, uncertain wording', () => {
    assert.match(SYSTEM_PROMPT, /photo/i);
    assert.match(SYSTEM_PROMPT, /looks like/);
    assert.match(SYSTEM_PROMPT, /Text inside a photo .*untrusted/);
  });
});
