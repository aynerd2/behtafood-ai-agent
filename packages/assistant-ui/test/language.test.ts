// The language dropdown, Chat as the default mode, and the presentation-only
// motion helpers (typing indicator, status line, reply reveal).

import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AssistantController } from '../src/logic/controller';
import { createAgentClient, type AgentClient } from '../src/logic/client';
import { LANGUAGE_OPTIONS, initialLanguage } from '../src/logic/language';
import { initialGuideMode } from '../src/logic/guidedMode';
import { REVEAL_MAX_MS, REVEAL_MS_PER_CHAR, revealDurationMs, revealedLength, typingStatus, typingVisible } from '../src/logic/motion';
import { applyRunEvents, initialState, startTurn, turnAccepted, turnFailed } from '../src/logic/conversation';
import { NOW, ev, happyRun, resetSeq } from './fixtures';

beforeEach(resetSeq);

describe('language options', () => {
  test('Auto, English, Pidgin, then Yoruba, Hausa and Igbo marked beta', () => {
    assert.deepEqual(
      LANGUAGE_OPTIONS.map((o) => [o.code, o.label, o.beta]),
      [
        ['auto', 'Auto (match my message)', false],
        ['en', 'English', false],
        ['pcm', 'Nigerian Pidgin', false],
        ['yo', 'Yoruba', true],
        ['ha', 'Hausa', true],
        ['ig', 'Igbo', true],
      ],
    );
  });

  test('a stored choice is restored; anything unknown falls back to Auto', () => {
    for (const code of ['auto', 'en', 'pcm', 'yo', 'ha', 'ig']) assert.equal(initialLanguage(code), code);
    for (const bad of [null, undefined, '', 'fr', 'Yoruba']) assert.equal(initialLanguage(bad), 'auto');
  });
});

describe('Chat is the default when guided mode is turned off', () => {
  test('a stored "guided" preference is ignored while guided mode is off', () => {
    for (const stored of [null, 'guided', 'chat', 'nonsense']) assert.equal(initialGuideMode(stored, { guidedEnabled: false }), 'chat');
  });

  test('with guided mode on, the old behaviour stays', () => {
    assert.equal(initialGuideMode('guided', { guidedEnabled: true }), 'guided');
    assert.equal(initialGuideMode('chat', { guidedEnabled: true }), 'chat');
    assert.equal(initialGuideMode(null, { guidedEnabled: true }), 'guided');
  });
});

describe('every chat message carries the language', () => {
  test('the client sends language, Auto when none is given', async () => {
    const bodies: any[] = [];
    const client = createAgentClient({
      apiUrl: 'http://x/api',
      getToken: async () => 't',
      fetchImpl: (async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ data: { runId: 'r', sessionId: null } }), { status: 202 });
      }) as typeof fetch,
    });
    await client.chat('hi');
    await client.chat('bawo', 'ses_1', undefined, 'yo');
    assert.deepEqual(bodies, [
      { text: 'hi', language: 'auto' },
      { text: 'bawo', sessionId: 'ses_1', language: 'yo' },
    ]);
  });

  test('the controller sends the chosen language with each message, including choice taps', async () => {
    const sent: (string | undefined)[] = [];
    const client = {
      chat: async (_t: string, _s?: string, _p?: string, language?: string) => {
        sent.push(language);
        return { runId: 'run', sessionId: null };
      },
      events: async () => ({ finished: true, events: [] }),
    } as unknown as AgentClient;
    const c = new AssistantController({ client, sleep: async () => {}, now: () => NOW });
    assert.equal(c.getState().language, 'auto');
    await c.send('one');
    c.setLanguage('ha');
    assert.equal(c.getState().language, 'ha');
    await c.send('two');
    c.setLanguage('nonsense' as any);
    assert.equal(c.getState().language, 'ha');
    assert.deepEqual(sent, ['auto', 'ha']);
  });

  test('the controller starts with the language it is given', () => {
    const c = new AssistantController({ client: {} as AgentClient, language: 'ig' });
    assert.equal(c.getState().language, 'ig');
  });
});

describe('typing indicator and status line', () => {
  const started = () => turnAccepted(startTurn(initialState(), 't1', 'rice'), 't1', { runId: 'r', sessionId: null });

  test('shows from send until the reply, an error or the end of the turn', () => {
    const sending = startTurn(initialState(), 't1', 'rice').turns[0]!;
    assert.equal(typingVisible(sending), true);
    assert.equal(typingVisible(started().turns[0]!), true);
    const run = happyRun();
    const midway = applyRunEvents(started(), 't1', run.slice(0, 3), false).turns[0]!;
    assert.equal(typingVisible(midway), true);
    const replied = applyRunEvents(started(), 't1', [ev({ type: 'reply', text: 'Here you go' })], false).turns[0]!;
    assert.equal(typingVisible(replied), false);
    assert.equal(typingVisible(turnFailed(started(), 't1', 'offline').turns[0]!), false);
    assert.equal(typingVisible(applyRunEvents(started(), 't1', [], true).turns[0]!), false);
  });

  test('the status line is only ever a real step name from the server', () => {
    assert.equal(typingStatus(started().turns[0]!), null);
    const s = applyRunEvents(
      started(),
      't1',
      [
        ev({ type: 'session', sessionId: 's' }),
        ev({ type: 'step', tool: 'search_restaurants', status: 'done', label: 'Searched restaurants: 3 open' }),
        ev({ type: 'step', tool: 'get_menu', status: 'done', label: 'Read menu: Spice Route Kitchen' }),
      ],
      false,
    );
    assert.equal(typingStatus(s.turns[0]!), 'Read menu: Spice Route Kitchen');
  });
});

describe('reply reveal', () => {
  test('about 20 ms per character, never more than 1.5 s', () => {
    assert.equal(REVEAL_MS_PER_CHAR, 20);
    assert.equal(REVEAL_MAX_MS, 1500);
    assert.equal(revealDurationMs('hello'), 100);
    assert.equal(revealDurationMs('x'.repeat(5000)), 1500);
    assert.equal(revealDurationMs(''), 0);
  });

  test('reveals in proportion to time and ends on the full text', () => {
    const text = 'x'.repeat(50); // 1000 ms
    assert.equal(revealedLength(text, 0), 0);
    assert.equal(revealedLength(text, 500), 25);
    assert.equal(revealedLength(text, 1000), 50);
    assert.equal(revealedLength(text, 99_999), 50);
    const long = 'y'.repeat(300); // capped at 1500 ms
    assert.equal(revealedLength(long, 750), 150);
    assert.equal(revealedLength(long, 1500), 300);
  });
});
