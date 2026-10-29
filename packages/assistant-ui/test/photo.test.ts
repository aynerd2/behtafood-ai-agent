// Photo input in the app: the photo is resized before sending (longest edge
// 1024 px, JPEG), checked by type, bytes and size, and sent with the message.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, PHOTO_REFUSAL, checkPhoto, scaledSize } from '../src/logic/photo';
import { AssistantController } from '../src/logic/controller';
import { createAgentClient, type AgentClient } from '../src/logic/client';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const jpeg = (size: number) => `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size - 4, 7)]).toString('base64')}`;

describe('checkPhoto (same rule as the server)', () => {
  test('JPEG and PNG up to 1.5 MB pass; anything else is refused', () => {
    assert.equal(PHOTO_MAX_BYTES, 1_500_000);
    assert.equal(checkPhoto(PNG), true);
    assert.equal(checkPhoto(jpeg(PHOTO_MAX_BYTES)), true);
    assert.equal(checkPhoto(jpeg(PHOTO_MAX_BYTES + 1)), false);
    assert.equal(checkPhoto(PNG.replace('image/png', 'image/webp')), false);
    assert.equal(checkPhoto(jpeg(50).replace('image/jpeg', 'image/png')), false);
    assert.equal(checkPhoto('file:///photo.jpg'), false);
  });
});

describe('scaledSize', () => {
  test('shrinks so the longest edge is 1024 px, keeping the shape; never enlarges', () => {
    assert.equal(PHOTO_MAX_EDGE, 1024);
    assert.deepEqual(scaledSize(4000, 3000), { width: 1024, height: 768 });
    assert.deepEqual(scaledSize(3000, 4000), { width: 768, height: 1024 });
    assert.deepEqual(scaledSize(800, 600), { width: 800, height: 600 });
  });
});

class PhotoClient {
  chats: { text: string; sessionId?: string; imageDataUrl?: string }[] = [];
  async chat(text: string, sessionId?: string, imageDataUrl?: string) {
    this.chats.push({ text, sessionId, imageDataUrl });
    return { runId: 'run_1', sessionId: null };
  }
  async events() {
    return { finished: true, events: [] };
  }
}

function controller() {
  const client = new PhotoClient();
  const c = new AssistantController({ client: client as unknown as AgentClient, sleep: async () => {} });
  return { c, client };
}

describe('sending a photo', () => {
  test('a photo goes with the message, and the turn shows it', async () => {
    const { c, client } = controller();
    await c.send('something like this', PNG);
    assert.deepEqual(client.chats, [{ text: 'something like this', sessionId: undefined, imageDataUrl: PNG }]);
    assert.equal(c.getState().turns[0]!.photo, PNG);
  });

  test('a photo alone is enough to send', async () => {
    const { c, client } = controller();
    await c.send('   ', PNG);
    assert.equal(client.chats.length, 1);
    assert.equal(c.getState().turns[0]!.userText, 'Find me something like this.');
  });

  test('a photo that fails the check is not sent; the turn explains why', async () => {
    const { c, client } = controller();
    await c.send('this', jpeg(PHOTO_MAX_BYTES + 100));
    assert.equal(client.chats.length, 0);
    assert.equal(c.getState().turns[0]!.status, 'failed');
    assert.equal(c.getState().turns[0]!.error?.message, PHOTO_REFUSAL);
  });

  test('the client puts the photo in the chat request', async () => {
    let body: any;
    const client = createAgentClient({
      apiUrl: 'http://x/api',
      getToken: async () => 't',
      fetchImpl: (async (_u: string, init: RequestInit) => {
        body = JSON.parse(String(init.body));
        return new Response(JSON.stringify({ success: true, data: { runId: 'r', sessionId: null } }), { status: 202 });
      }) as typeof fetch,
    });
    await client.chat('like this', 'ses_1', PNG);
    assert.deepEqual(body, { text: 'like this', sessionId: 'ses_1', imageDataUrl: PNG, language: 'auto' });
    await client.chat('no photo');
    assert.deepEqual(body, { text: 'no photo', language: 'auto' });
  });
});
