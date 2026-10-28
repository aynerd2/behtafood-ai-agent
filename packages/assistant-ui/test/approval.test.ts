// The approval card's states: what each server answer and each failure turns it into.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  approveFailed,
  approveResolved,
  approveStarted,
  cancelResolved,
  cancelStarted,
  cardActions,
  checkFailed,
  checkResolved,
  checkStarted,
  effectiveStatus,
  minutesLeft,
  newCard,
} from '../src/logic/approval';
import { AgentApiError } from '../src/logic/client';
import { NOW, PLACED, proposal } from './fixtures';

describe('approval card', () => {
  test('a new card can be approved or cancelled, and says how long it is valid', () => {
    const c = newCard(proposal());
    assert.equal(effectiveStatus(c, NOW), 'awaiting');
    assert.deepEqual(cardActions(c, NOW), { approve: true, cancel: true, askAgain: false, openOrder: false });
    assert.equal(minutesLeft(c, NOW), 10);
  });

  test('while approving, nothing can be tapped (no double order from the UI either)', () => {
    const c = approveStarted(newCard(proposal()));
    assert.equal(c.status, 'approving');
    assert.deepEqual(cardActions(c, NOW), { approve: false, cancel: false, askAgain: false, openOrder: false });
  });

  test('placed shows the order reference and offers to open the order', () => {
    const c = approveResolved(approveStarted(newCard(proposal())), PLACED);
    assert.equal(c.status, 'placed');
    assert.equal(c.order?.reference, 'ORD-ABC-123');
    assert.deepEqual(cardActions(c, NOW), { approve: false, cancel: false, askAgain: false, openOrder: true });
  });

  test('a price change shows the new total and the old one, and asks to approve again', () => {
    const c = approveResolved(approveStarted(newCard(proposal())), {
      status: 'price_changed',
      previousTotalNaira: 3300,
      proposal: proposal({ totalNaira: 3500, subtotalNaira: 2700 }),
    });
    assert.equal(c.status, 'price_changed');
    assert.equal(c.proposal.totalNaira, 3500);
    assert.equal(c.previousTotalNaira, 3300);
    assert.match(c.message ?? '', /₦3,300.*₦3,500/);
    assert.equal(cardActions(c, NOW).approve, true);
  });

  test('a business refusal (low balance) is shown as failed with its reason; nothing to approve', () => {
    const c = approveResolved(approveStarted(newCard(proposal())), { status: 'refused', code: 'INSUFFICIENT_BALANCE', message: 'Your wallet balance is too low.' });
    assert.equal(c.status, 'refused');
    assert.equal(c.message, 'Your wallet balance is too low.');
    assert.deepEqual(cardActions(c, NOW), { approve: false, cancel: false, askAgain: true, openOrder: false });
  });

  test('expired or lost on the server: the card asks the customer again instead of failing', () => {
    for (const code of ['EXPIRED', 'NOT_FOUND', 'CANCELLED'] as const) {
      const c = approveResolved(approveStarted(newCard(proposal())), { status: 'refused', code, message: 'x' });
      assert.equal(c.status, code === 'EXPIRED' ? 'expired' : 'lost', code);
      assert.deepEqual(cardActions(c, NOW), { approve: false, cancel: false, askAgain: true, openOrder: false });
    }
  });

  test('a card past its expiry time is expired locally, before any tap', () => {
    const c = newCard(proposal());
    const later = NOW + 10 * 60_000 + 1;
    assert.equal(effectiveStatus(c, later), 'expired');
    assert.equal(cardActions(c, later).approve, false);
    assert.equal(cardActions(c, later).askAgain, true);
    assert.equal(minutesLeft(c, later), 0);
  });

  test('an uncertain outcome or a network failure lets the customer tap Approve again (it is safe)', () => {
    const u = approveResolved(approveStarted(newCard(proposal())), { status: 'uncertain', message: 'We could not confirm the order.' });
    assert.equal(u.status, 'uncertain');
    assert.equal(cardActions(u, NOW).approve, true);
    const n = approveFailed(approveStarted(newCard(proposal())), new AgentApiError('network', 'You seem to be offline.'));
    assert.equal(n.status, 'uncertain');
    assert.equal(cardActions(n, NOW).approve, true);
  });

  test('signed out, assistant switched off and rate limited are explained', () => {
    const signedOut = approveFailed(approveStarted(newCard(proposal())), new AgentApiError('signed_out', 'Please sign in again.', 401));
    assert.equal(signedOut.status, 'failed');
    assert.equal(signedOut.message, 'Please sign in again.');
    const off = approveFailed(approveStarted(newCard(proposal())), new AgentApiError('unavailable', 'The assistant is not available right now.', 404));
    assert.equal(off.status, 'lost');
    const limited = approveFailed(approveStarted(newCard(proposal())), new AgentApiError('rate_limited', 'Too many taps.', 429));
    assert.equal(limited.status, 'awaiting');
    assert.equal(limited.message, 'Too many taps.');
  });

  test('cancel: cancelled when the server agrees, lost when it no longer knows the card', () => {
    assert.equal(cancelResolved(cancelStarted(newCard(proposal())), true).status, 'cancelled');
    assert.equal(cancelResolved(cancelStarted(newCard(proposal())), false).status, 'lost');
  });

  test('a not-confirmed card never expires on its own; it offers Approve (server checks first) and Ask again (app checks first), not Cancel', () => {
    const u = approveResolved(approveStarted(newCard(proposal())), { status: 'uncertain', message: 'We could not confirm the order.' });
    const later = NOW + 60 * 60_000;
    assert.equal(effectiveStatus(u, later), 'uncertain');
    assert.deepEqual(cardActions(u, later), { approve: true, cancel: false, askAgain: true, openOrder: false });
  });

  test('when the server could not check, the card says so, points to My Orders, and offers only Check again', () => {
    const c = approveResolved(approveStarted(newCard(proposal())), {
      status: 'uncertain',
      lookupFailed: true,
      message: "We couldn't check whether your order went through. Please look in My Orders before trying again.",
    });
    assert.equal(c.status, 'unverified');
    assert.match(c.message ?? '', /My Orders/);
    assert.deepEqual(cardActions(c, NOW + 60 * 60_000), { approve: true, cancel: false, askAgain: false, openOrder: false });
  });

  test('a check that finds the order shows "Your order was placed: <reference>" with View order', () => {
    const u = approveResolved(approveStarted(newCard(proposal())), { status: 'uncertain', message: 'x' });
    const c = checkResolved(checkStarted(u), { status: 'placed', order: (PLACED as any).order });
    assert.equal(c.status, 'placed');
    assert.equal(c.message, 'Your order was placed: ORD-ABC-123');
    assert.deepEqual(cardActions(c, NOW), { approve: false, cancel: false, askAgain: false, openOrder: true });
  });

  test('a check that confirms no order allows asking again; a failed check does not', () => {
    const u = approveResolved(approveStarted(newCard(proposal())), { status: 'uncertain', message: 'x' });
    const none = checkResolved(checkStarted(u), { status: 'not_placed' });
    assert.equal(none.status, 'not_placed');
    assert.equal(cardActions(none, NOW).askAgain, true);
    const failed = checkResolved(checkStarted(u), { status: 'check_failed', message: "We couldn't check. Please look in My Orders before trying again." });
    assert.equal(failed.status, 'unverified');
    assert.equal(cardActions(failed, NOW).askAgain, false);
    const offline = checkFailed(checkStarted(u), new AgentApiError('network', 'offline'));
    assert.equal(offline.status, 'unverified');
    assert.match(offline.message ?? '', /My Orders/);
  });

  test('a placed card ignores a late duplicate result', () => {
    const placed = approveResolved(approveStarted(newCard(proposal())), PLACED);
    const again = approveResolved(placed, { status: 'refused', code: 'NOT_FOUND', message: 'x' });
    assert.equal(again.status, 'placed');
  });
});
