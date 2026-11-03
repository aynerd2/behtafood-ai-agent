// Reply language: the customer picks Auto, English, Nigerian Pidgin, Yoruba,
// Hausa or Igbo. Auto keeps the original prompt exactly; any other choice adds
// one instruction after it, so every safety rule still applies.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { ASSISTANT_LANGUAGES, SYSTEM_PROMPT, isAssistantLanguage, languageInstruction, systemPromptFor } from '@behtafood-agent/agent-core';
import { ADA, FnModel, harness, sequenceModel, toolCall } from './helpers';

const NAMES = { en: /standard English/, pcm: /Nigerian Pidgin/, yo: /Yoruba/, ha: /Hausa/, ig: /Igbo/ } as const;

const systemOf = (model: FnModel, request = 0) => model.requests[request]!.messages[0]!;

describe('language codes', () => {
  test('exactly auto, en, pcm, yo, ha and ig are accepted', () => {
    assert.deepEqual([...ASSISTANT_LANGUAGES], ['auto', 'en', 'pcm', 'yo', 'ha', 'ig']);
    for (const code of ASSISTANT_LANGUAGES) assert.equal(isAssistantLanguage(code), true, code);
    for (const bad of ['', 'EN', 'fr', 'yoruba', 'pidgin', undefined, null, 1, {}]) assert.equal(isAssistantLanguage(bad), false, String(bad));
  });

  test('Auto adds no language rule, only the English button names', () => {
    assert.equal(languageInstruction('auto'), '');
    const prompt = systemPromptFor('auto');
    assert.ok(prompt.startsWith(SYSTEM_PROMPT));
    assert.match(prompt.slice(SYSTEM_PROMPT.length), /approve = "Approve"/);
    assert.doesNotMatch(prompt.slice(SYSTEM_PROMPT.length), /Chosen reply language/);
  });

  for (const [code, name] of Object.entries(NAMES)) {
    test(`${code}: the instruction names the language and keeps data and safety rules`, () => {
      const prompt = systemPromptFor(code as keyof typeof NAMES);
      // The original prompt (with every safety rule) comes first, unchanged.
      assert.ok(prompt.startsWith(SYSTEM_PROMPT));
      const extra = languageInstruction(code as keyof typeof NAMES);
      assert.equal(prompt, `${SYSTEM_PROMPT}\n\n${extra}`);
      assert.match(extra, name);
      assert.match(extra, /every sentence the customer reads/i);
      assert.match(extra, /restaurant names, dish names, prices \(₦\) and order references exactly/i);
      assert.match(extra, /simple, everyday words/i);
      assert.match(extra, /every rule above still applies/i);
    });
  }

  test('a non-English choice says not to answer in English; English says no Pidgin', () => {
    for (const code of ['pcm', 'yo', 'ha', 'ig'] as const) assert.match(languageInstruction(code), /even if the customer writes in English/i, code);
    assert.match(languageInstruction('en'), /no Pidgin/i);
  });
});

describe('the agent sends the chosen language to the model', () => {
  test('no language, or Auto, behaves exactly as before', async () => {
    for (const language of [undefined, 'auto'] as const) {
      const model = new FnModel(() => ({ content: 'ok' }));
      const h = harness({ model });
      await h.agent.handleMessage(ADA, { text: 'rice under 3k', ...(language ? { language } : {}) }, () => {});
      assert.deepEqual(systemOf(model), { role: 'system', content: systemPromptFor('auto') });
    }
  });

  for (const code of ['en', 'pcm', 'yo', 'ha', 'ig'] as const) {
    test(`${code}: every model call in the message carries the instruction`, async () => {
      // Two calls: a tool call, then the reply.
      const model = sequenceModel([{ content: null, tool_calls: [toolCall('get_my_recent_orders', {})] }, { content: 'ok' }]);
      const h = harness({ model });
      await h.agent.handleMessage(ADA, { text: 'rice under 3k', language: code }, () => {});
      assert.equal(model.requests.length, 2);
      for (let i = 0; i < 2; i++) assert.equal(systemOf(model, i).content, systemPromptFor(code));
    });
  }

  test('changing the language mid-conversation replaces the instruction; it never piles up', async () => {
    const model = new FnModel(() => ({ content: 'ok' }));
    const h = harness({ model });
    const first = await h.agent.handleMessage(ADA, { text: 'rice', language: 'yo' }, () => {});
    await h.agent.handleMessage(ADA, { sessionId: first.sessionId, text: 'cheaper', language: 'ha' }, () => {});
    await h.agent.handleMessage(ADA, { sessionId: first.sessionId, text: 'ok', language: 'auto' }, () => {});
    assert.equal(systemOf(model, 1).content, systemPromptFor('ha'));
    assert.equal(systemOf(model, 2).content, systemPromptFor('auto'));
    assert.equal(model.requests[2]!.messages.filter((m) => m.role === 'system').length, 1);
  });

  test('an invalid code is refused with a clear message and no model call', async () => {
    const model = new FnModel(() => ({ content: 'ok' }));
    const h = harness({ model });
    const events: any[] = [];
    await h.agent.handleMessage(ADA, { text: 'rice', language: 'fr' as any }, (e) => events.push(e));
    assert.deepEqual(events.find((e) => e.type === 'error'), {
      type: 'error',
      code: 'bad_request',
      message: 'language must be one of: auto, en, pcm, yo, ha, ig.',
    });
    assert.equal(model.calls, 0);
  });
});
