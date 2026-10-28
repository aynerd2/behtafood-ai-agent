// T6 in the app: real status changes become timeline steps, a delay posts a
// fixed message with reminder buttons, and reminder results are reported honestly.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aiCallsSinceOrder,
  applySnapshot,
  latestTrackingLabel,
  newTracking,
  openDelay,
  reminderFailed,
  reminderResolved,
  reminderStarted,
  trackingRows,
  type TrackingSnapshot,
} from '../src/logic/tracking';
import { AgentApiError } from '../src/logic/client';
import { NOW } from './fixtures';

const snap = (status: TrackingSnapshot['status'], over: Partial<TrackingSnapshot> = {}): TrackingSnapshot => ({
  orderId: 'ord_9',
  reference: 'ORD-1',
  status,
  riderAssigned: ['rider_assigned', 'picked_up', 'on_the_way', 'delivered'].includes(status),
  updatedAt: new Date(NOW).toISOString(),
  stageSince: new Date(NOW).toISOString(),
  delay: null,
  modelCalls: 7,
  ...over,
});

const READY_DELAY = { kind: 'no_rider' as const, parties: ['vendor' as const], elapsedMs: 660_000, message: 'Your food has been ready for 11 minutes and no rider has been assigned yet. Would you like to send a polite reminder?' };

describe('status steps', () => {
  test('a step is added only when the backend reports a new stage', () => {
    let t = newTracking('ord_9', 'ORD-1');
    t = applySnapshot(t, snap('preparing'), NOW);
    t = applySnapshot(t, snap('preparing'), NOW + 5000);
    t = applySnapshot(t, snap('ready'), NOW + 10_000);
    t = applySnapshot(t, snap('rider_assigned'), NOW + 15_000);
    t = applySnapshot(t, snap('picked_up'), NOW + 20_000);
    t = applySnapshot(t, snap('on_the_way'), NOW + 25_000);
    assert.deepEqual(t.steps.map((s) => s.label), [
      'The restaurant is preparing your order',
      'Your food is ready for pickup',
      'A rider has been assigned',
      'The rider picked up your food',
      'Your order is on the way',
    ]);
    assert.equal(t.finished, false);
    assert.equal(latestTrackingLabel(t), 'Order ORD-1: Your order is on the way');
  });

  test('delivered and cancelled finish tracking', () => {
    assert.equal(applySnapshot(newTracking('o', 'R'), snap('delivered'), NOW).finished, true);
    const c = applySnapshot(newTracking('o', 'R'), snap('cancelled'), NOW);
    assert.equal(c.finished, true);
    assert.equal(c.steps[0]!.label, 'The order was cancelled');
  });

  test('all eight stages have their own wording', () => {
    let t = newTracking('o', 'R');
    for (const s of ['accepted', 'preparing', 'ready', 'rider_assigned', 'picked_up', 'on_the_way', 'delivered'] as const) t = applySnapshot(t, snap(s), NOW);
    assert.equal(new Set(t.steps.map((s) => s.label)).size, 7);
    assert.equal(t.steps[0]!.label, 'The restaurant accepted your order');
    assert.equal(t.steps.at(-1)!.label, 'Delivered. Enjoy your meal!');
  });

  test('model calls since the order are shown, and stay at zero while tracking', () => {
    let t = applySnapshot(newTracking('o', 'R'), snap('preparing', { modelCalls: 7 }), NOW);
    t = applySnapshot(t, snap('ready', { modelCalls: 7 }), NOW);
    assert.equal(aiCallsSinceOrder(t), 0);
    assert.deepEqual(trackingRows(t).at(-1), { key: 'ai-calls', status: 'info', label: 'AI calls since your order: 0' });
  });
});

describe('delays', () => {
  test('a delay posts its fixed message once, with reminder buttons for the right party', () => {
    let t = applySnapshot(newTracking('o', 'R'), snap('ready'), NOW);
    t = applySnapshot(t, snap('ready', { delay: READY_DELAY }), NOW + 1);
    t = applySnapshot(t, snap('ready', { delay: READY_DELAY }), NOW + 2);
    assert.equal(t.delays.length, 1);
    assert.deepEqual(openDelay(t), { kind: 'no_rider', stage: 'ready', message: READY_DELAY.message, parties: ['vendor'] });
    const row = trackingRows(t).find((r) => r.key.startsWith('delay:'))!;
    assert.equal(row.status, 'awaiting');
    assert.equal(row.label, READY_DELAY.message);
  });

  test('the buttons go away once the stage moves on or a reminder was sent', () => {
    let t = applySnapshot(newTracking('o', 'R'), snap('ready', { delay: READY_DELAY }), NOW);
    t = applySnapshot(t, snap('rider_assigned'), NOW + 1);
    assert.equal(openDelay(t), undefined);

    let u = applySnapshot(newTracking('o', 'R'), snap('ready', { delay: READY_DELAY }), NOW);
    u = reminderResolved(reminderStarted(u, 'vendor'), 'vendor', { sent: true, text: 'Reminder sent to the restaurant.' }, NOW);
    assert.equal(openDelay(u), undefined);
    assert.equal(trackingRows(u).find((r) => r.key.startsWith('delay:'))!.status, 'info', 'an answered delay is no longer waiting');
  });

  test('no buttons once the order is finished', () => {
    let t = applySnapshot(newTracking('o', 'R'), snap('ready', { delay: READY_DELAY }), NOW);
    t = applySnapshot(t, snap('delivered'), NOW + 1);
    assert.equal(openDelay(t), undefined);
  });
});

describe('reminder results (honest wording)', () => {
  test('sent and refused results are shown as the server worded them', () => {
    let t = applySnapshot(newTracking('o', 'R'), snap('ready', { delay: READY_DELAY }), NOW);
    t = reminderStarted(t, 'vendor');
    assert.equal(t.sending, 'vendor');
    t = reminderResolved(t, 'vendor', { sent: true, text: 'Reminder sent to the restaurant.' }, NOW);
    t = reminderResolved(t, 'vendor', { sent: false, code: 'COOLDOWN', text: 'You reminded the restaurant less than 10 minutes ago. Please wait a little before reminding again.' }, NOW);
    assert.deepEqual(t.reminders.map((r) => [r.sent, r.text]), [
      [true, 'Reminder sent to the restaurant.'],
      [false, 'You reminded the restaurant less than 10 minutes ago. Please wait a little before reminding again.'],
    ]);
    assert.equal(t.sending, undefined);
    const rows = trackingRows(t).filter((r) => r.key.startsWith('reminder:'));
    assert.deepEqual(rows.map((r) => r.status), ['done', 'info']);
  });

  test('a request that never got an answer says so; it never claims delivered or read', () => {
    const t = reminderFailed(reminderStarted(applySnapshot(newTracking('o', 'R'), snap('ready'), NOW), 'vendor'), 'vendor', new AgentApiError('network', 'offline'), NOW);
    assert.equal(t.reminders[0]!.text, "We couldn't confirm the reminder was sent. Check your connection and try again.");
    for (const r of trackingRows(t)) assert.doesNotMatch(r.label, /delivered to|was read|seen/i);
  });
});
