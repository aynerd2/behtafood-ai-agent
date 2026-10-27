// The approval card's state machine.
//
// The card is the only place an order can start: Approve calls the server's
// approval endpoint, which re-quotes and places at most one order for this
// proposal id. The card never shows "placed" unless the server said so.
//
//   awaiting --Approve--> approving --> placed
//      |                      |------> price_changed (new total; approve again)
//      |                      |------> refused   (reason shown; ask again)
//      |                      |------> expired / lost (ask again)
//      |                      '------> uncertain (not confirmed)
//      |--Cancel--> cancelling --> cancelled
//      |--time passes--> expired (locally, without a tap)
//      '--newer card--> superseded
//
// Not confirmed (uncertain) means the order may exist. Such a card never
// expires or gets replaced on its own. Approve lets the server look it up
// first; Ask again looks it up here first (checking -> placed / not_placed /
// unverified), and a fresh quote is requested only when there is no order.

import { AgentApiError } from './client';
import { naira } from './format';
import type { ApproveResult, CheckResult, PlacedOrder, ProposalView } from './types';

export type ApprovalStatus =
  | 'awaiting'
  | 'approving'
  | 'placed'
  | 'price_changed'
  | 'refused'
  | 'expired'
  | 'lost'
  | 'superseded'
  | 'cancelling'
  | 'cancelled'
  | 'uncertain'
  | 'checking'
  | 'not_placed'
  | 'unverified'
  | 'failed';

export interface ApprovalCardState {
  proposal: ProposalView;
  status: ApprovalStatus;
  /** Customer-facing explanation of the current state, when there is one. */
  message?: string;
  order?: PlacedOrder;
  previousTotalNaira?: number;
}

export interface CardActions {
  approve: boolean;
  cancel: boolean;
  askAgain: boolean;
  openOrder: boolean;
}

const EXPIRED_TEXT = 'This quote expired. Ask the assistant for a fresh one.';
const LOST_TEXT = 'This quote is no longer available. Ask the assistant again for a fresh one.';
const UNCERTAIN_TEXT = 'We could not confirm the order. Nothing is charged twice: tap Approve again to check.';
const COULD_NOT_CHECK_TEXT = "We couldn't check whether your order went through. Please look in My Orders before trying again.";
const NOT_PLACED_TEXT = 'No order was placed. Asking the assistant for a fresh quote.';

export function placedMessage(order: PlacedOrder): string {
  return `Your order was placed: ${order.reference}`;
}

export function newCard(proposal: ProposalView): ApprovalCardState {
  return { proposal, status: 'awaiting' };
}

/** Open cards past their expiry time are expired, even before anyone taps. */
export function effectiveStatus(card: ApprovalCardState, now: number): ApprovalStatus {
  if ((card.status === 'awaiting' || card.status === 'price_changed') && now > Date.parse(card.proposal.expiresAt)) return 'expired';
  return card.status;
}

export function cardActions(card: ApprovalCardState, now: number): CardActions {
  const s = effectiveStatus(card, now);
  return {
    // For uncertain/unverified, Approve makes the server look the order up first.
    approve: s === 'awaiting' || s === 'price_changed' || s === 'uncertain' || s === 'unverified',
    cancel: s === 'awaiting' || s === 'price_changed',
    // Ask again always checks for an order first (see the controller).
    askAgain: s === 'expired' || s === 'lost' || s === 'refused' || s === 'uncertain' || s === 'not_placed',
    openOrder: s === 'placed',
  };
}

export function minutesLeft(card: ApprovalCardState, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(card.proposal.expiresAt) - now) / 60_000));
}

export function statusMessage(card: ApprovalCardState, now: number): string | undefined {
  const s = effectiveStatus(card, now);
  if (s === 'expired') return card.message ?? EXPIRED_TEXT;
  return card.message;
}

export function approveStarted(card: ApprovalCardState): ApprovalCardState {
  return { ...card, status: 'approving', message: undefined };
}

export function approveResolved(card: ApprovalCardState, result: ApproveResult): ApprovalCardState {
  if (card.status === 'placed') return card; // a late duplicate answer changes nothing
  switch (result.status) {
    case 'placed':
      return { ...card, status: 'placed', order: result.order, message: placedMessage(result.order) };
    case 'price_changed':
      return {
        ...card,
        proposal: result.proposal,
        status: 'price_changed',
        previousTotalNaira: result.previousTotalNaira,
        message: `The price changed from ${naira(result.previousTotalNaira)} to ${naira(result.proposal.totalNaira)}. Check it and approve again.`,
      };
    case 'refused':
      if (result.code === 'EXPIRED') return { ...card, status: 'expired', message: EXPIRED_TEXT };
      if (result.code === 'NOT_FOUND' || result.code === 'CANCELLED') return { ...card, status: 'lost', message: LOST_TEXT };
      return { ...card, status: 'refused', message: result.message };
    case 'uncertain':
      if (result.lookupFailed) return { ...card, status: 'unverified', message: result.message || COULD_NOT_CHECK_TEXT };
      return { ...card, status: 'uncertain', message: result.message || UNCERTAIN_TEXT };
  }
}

export function checkStarted(card: ApprovalCardState): ApprovalCardState {
  return { ...card, status: 'checking', message: undefined };
}

export function checkResolved(card: ApprovalCardState, result: CheckResult): ApprovalCardState {
  switch (result.status) {
    case 'placed':
      return { ...card, status: 'placed', order: result.order, message: placedMessage(result.order) };
    case 'not_placed':
      return { ...card, status: 'not_placed', message: NOT_PLACED_TEXT };
    case 'check_failed':
      return { ...card, status: 'unverified', message: result.message || COULD_NOT_CHECK_TEXT };
  }
}

/** The check request itself failed: we do not know, so nothing is re-sent. */
export function checkFailed(card: ApprovalCardState, _err: unknown): ApprovalCardState {
  return { ...card, status: 'unverified', message: COULD_NOT_CHECK_TEXT };
}

export function approveFailed(card: ApprovalCardState, err: unknown): ApprovalCardState {
  if (card.status === 'placed') return card;
  const kind = err instanceof AgentApiError ? err.kind : 'network';
  const message = err instanceof AgentApiError ? err.message : undefined;
  switch (kind) {
    case 'signed_out':
    case 'bad_request':
      return { ...card, status: 'failed', message };
    case 'unavailable':
      return { ...card, status: 'lost', message: LOST_TEXT };
    case 'rate_limited':
      return { ...card, status: 'awaiting', message };
    default:
      // The approval may or may not have reached the server. Approving again
      // is safe: the server finds the order by the proposal id first.
      return { ...card, status: 'uncertain', message: UNCERTAIN_TEXT };
  }
}

export function cancelStarted(card: ApprovalCardState): ApprovalCardState {
  return { ...card, status: 'cancelling', message: undefined };
}

export function cancelResolved(card: ApprovalCardState, cancelled: boolean): ApprovalCardState {
  if (cancelled) return { ...card, status: 'cancelled', message: 'Cancelled. Nothing was ordered.' };
  return { ...card, status: 'lost', message: LOST_TEXT };
}

export function cancelFailed(card: ApprovalCardState, err: unknown): ApprovalCardState {
  const message = err instanceof AgentApiError ? err.message : 'Could not cancel. Try again.';
  return { ...card, status: 'awaiting', message };
}
