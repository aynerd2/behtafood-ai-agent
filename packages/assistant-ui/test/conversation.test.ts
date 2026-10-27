// Turning run events into what the chat shows: timeline rows, cards and choice buttons.

import { beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyRunEvents,
  askAgainMessage,
  choiceMessage,
  inferChoicePrompt,
  initialState,
  latestChoicePrompt,
  startTurn,
  timelineRows,
  turnAccepted,
  turnFailed,
  type ConversationState,
} from '../src/logic/conversation';
import { MENU_ITEMS, NOW, ev, happyRun, proposal, resetSeq } from './fixtures';

function started(): ConversationState {
  let s = startTurn(initialState(), 't1', 'Find me rice and chicken around ₦4,000');
  s = turnAccepted(s, 't1', { runId: 'run_1', sessionId: null });
  return s;
}

beforeEach(resetSeq);

describe('timeline rows', () => {
  test('a step is shown only once its event has arrived, and the rest of the run shows as working', () => {
    const run = happyRun();
    let s = applyRunEvents(started(), 't1', run.slice(0, 2), false);
    const rows = timelineRows(s.turns[0]!, s.cards, NOW);
    assert.deepEqual(rows.map((r) => [r.status, r.label]), [
      ['done', 'Searched restaurants: 2 open'],
      ['working', 'Working…'],
    ]);
    s = applyRunEvents(s, 't1', run.slice(2), true);
    const done = timelineRows(s.turns[0]!, s.cards, NOW);
    assert.equal(done.filter((r) => r.status === 'done').length, 5);
    assert.equal(done.some((r) => r.status === 'working'), false);
  });

  test('waiting for approval is its own row, not a done step', () => {
    const s = applyRunEvents(started(), 't1', happyRun(), true);
    const rows = timelineRows(s.turns[0]!, s.cards, NOW);
    assert.deepEqual(rows.at(-1), { key: 'approval:prop_1', status: 'awaiting', label: 'Waiting for your approval' });
  });

  test('after approval the row says the order is placed, with the reference', () => {
    let s = applyRunEvents(started(), 't1', happyRun(), true);
    s = { ...s, cards: { ...s.cards, prop_1: { ...s.cards.prop_1!, status: 'placed', order: { orderId: 'ord_9', reference: 'ORD-1', checkoutSessionId: 'prop_1', restaurantId: 'r', totalNaira: 3300, status: 'preparing', createdAt: '' } } } };
    assert.deepEqual(timelineRows(s.turns[0]!, s.cards, NOW).at(-1), { key: 'approval:prop_1', status: 'done', label: 'Order placed: ORD-1' });
  });

  test('a failed step stays failed, and an error event is a failed row with its message', () => {
    const s = applyRunEvents(started(), 't1', [
      ev({ type: 'session', sessionId: 'ses_1' }),
      ev({ type: 'step', tool: 'get_menu', status: 'failed', label: 'get menu failed', data: undefined }),
      ev({ type: 'error', code: 'call_cap', message: 'That took too many steps, so I stopped.' }),
      ev({ type: 'done', modelCalls: 8, costUsd: 0.02 }),
    ], true);
    const rows = timelineRows(s.turns[0]!, s.cards, NOW);
    assert.deepEqual(rows.map((r) => r.status), ['failed', 'failed']);
    assert.equal(rows[1]!.label, 'That took too many steps, so I stopped.');
    assert.equal(s.turns[0]!.status, 'finished');
  });

  test('events already seen are ignored, so a repeated poll never duplicates a step', () => {
    const run = happyRun();
    let s = applyRunEvents(started(), 't1', run.slice(0, 3), false);
    s = applyRunEvents(s, 't1', run.slice(0, 4), false);
    assert.equal(s.turns[0]!.steps.length, 3);
    assert.equal(s.turns[0]!.lastSeq, 4);
  });

  test('the session id from the first event is kept for the next message', () => {
    const s = applyRunEvents(started(), 't1', happyRun(), true);
    assert.equal(s.sessionId, 'ses_1');
  });

  test('a turn that could not start is failed with a readable message', () => {
    const s = turnFailed(startTurn(initialState(), 't1', 'hi'), 't1', 'You are offline.');
    assert.equal(s.turns[0]!.status, 'failed');
    assert.deepEqual(timelineRows(s.turns[0]!, s.cards, NOW).map((r) => [r.status, r.label]), [['failed', 'You are offline.']]);
  });
});

describe('cards', () => {
  test('restaurants, the cart with its picks, and the approval card come from the events', () => {
    const s = applyRunEvents(started(), 't1', happyRun(), true);
    const t = s.turns[0]!;
    assert.deepEqual(t.restaurants?.map((r) => r.name), ['Spice Route Kitchen', 'Wrap City']);
    assert.deepEqual(t.carts[0]!.items[0]!.choices, [{ group: 'Protein', option: 'Chicken' }]);
    assert.deepEqual(t.proposalIds, ['prop_1']);
    assert.equal(s.cards.prop_1!.status, 'awaiting');
    assert.equal(s.cards.prop_1!.proposal.totalNaira, 3300);
    assert.equal(t.reply, 'Tap Approve to order. Nothing is charged until you do.');
  });

  test('a newer proposal in the session supersedes an open older one', () => {
    let s = applyRunEvents(started(), 't1', happyRun(), true);
    s = startTurn(s, 't2', 'make it beef');
    s = turnAccepted(s, 't2', { runId: 'run_2', sessionId: 'ses_1' });
    s = applyRunEvents(s, 't2', [ev({ type: 'awaiting_approval', proposal: proposal({ proposalId: 'prop_2' }) })], true);
    assert.equal(s.cards.prop_1!.status, 'superseded');
    assert.equal(s.cards.prop_2!.status, 'awaiting');
  });
});

describe('dish choices', () => {
  const menu = { jollof: { itemId: 'itm_jollof_chicken', itemName: 'Jollof rice & chicken', groups: MENU_ITEMS[1]!.choices! } };

  test('a reply asking for the protein of a known item becomes tappable options with extra prices, none selected', () => {
    const p = inferChoicePrompt('Jollof rice & chicken needs a Protein: Chicken, Beef or Turkey (+₦800). Which one?', Object.values(menu));
    assert.ok(p);
    assert.equal(p.group, 'Protein');
    assert.deepEqual(p.options.map((o) => [o.name, o.extraPriceNaira]), [['Chicken', 0], ['Beef', 0], ['Turkey', 800]]);
    assert.equal(p.selected, undefined);
  });

  test('optional groups and replies that do not ask are not turned into buttons', () => {
    assert.equal(inferChoicePrompt('Here is Ofada rice for ₦2,800.', Object.values(menu)), undefined);
    assert.equal(inferChoicePrompt('Would you like Coleslaw with your jollof rice & chicken?', Object.values(menu)), undefined);
  });

  test('the latest finished turn offers the prompt from the menu it read', () => {
    let s = started();
    s = applyRunEvents(s, 't1', [
      ev({ type: 'session', sessionId: 'ses_1' }),
      ev({ type: 'step', tool: 'get_menu', status: 'done', label: 'Read menu', data: { restaurantId: 'rst_1', items: MENU_ITEMS } }),
      ev({ type: 'reply', text: 'Jollof rice & chicken comes with a Protein choice: Chicken, Beef or Turkey. Which one?' }),
      ev({ type: 'done', modelCalls: 3, costUsd: 0 }),
    ], true);
    assert.equal(latestChoicePrompt(s)?.itemName, 'Jollof rice & chicken');
  });

  test('a NEEDS_CHOICE step offers its options even when the reply wording is unusual', () => {
    let s = started();
    s = applyRunEvents(s, 't1', [
      ev({ type: 'step', tool: 'build_cart', status: 'failed', label: 'Needs your choice', data: { needsChoice: { itemId: 'itm_shawarma', itemName: 'Chicken shawarma', group: 'Size', options: [{ name: 'Regular', extra_price_naira: 0 }, { name: 'Jumbo', extra_price_naira: 1000 }] } } }),
      ev({ type: 'reply', text: 'Which one you want?' }),
      ev({ type: 'done', modelCalls: 2, costUsd: 0 }),
    ], true);
    assert.deepEqual(latestChoicePrompt(s)?.options.map((o) => o.name), ['Regular', 'Jumbo']);
  });

  test('no buttons while the run is still going, or when a proposal is waiting', () => {
    let s = started();
    const run = happyRun();
    s = applyRunEvents(s, 't1', run.slice(0, 3), false);
    assert.equal(latestChoicePrompt(s), undefined);
    s = applyRunEvents(s, 't1', run.slice(3), true);
    assert.equal(latestChoicePrompt(s), undefined);
  });

  test('tapping sends the pick in plain words as the customer\'s next message', () => {
    const p = inferChoicePrompt('Jollof rice & chicken: which Protein? Chicken, Beef or Turkey', Object.values(menu))!;
    assert.equal(choiceMessage(p, 'Turkey'), 'Protein: Turkey for the Jollof rice & chicken, please.');
  });
});

describe('reply text', () => {
  test('Markdown marks from the model are shown as plain text', async () => {
    const { plainReply } = await import('../src/logic/format');
    assert.equal(
      plainReply('Found **Jollof Rice & Chicken** - ₦2,500\n- Chicken\n* Beef\n## Total\n`₦3,300`'),
      'Found Jollof Rice & Chicken - ₦2,500\n• Chicken\n• Beef\nTotal\n₦3,300',
    );
  });
});

describe('asking again', () => {
  test('rebuilds the request from the card, picks included', () => {
    assert.equal(
      askAgainMessage(proposal()),
      'That quote is no longer valid. Please prepare a fresh quote for the same order: 1 x Jollof rice & chicken (Protein: Chicken) from Spice Route Kitchen.',
    );
  });
});
