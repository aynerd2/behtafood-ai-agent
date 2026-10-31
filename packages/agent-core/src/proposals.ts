// Proposal and approval state machine.
//
//   awaiting_approval --approve--> placing --ok--> placed
//          |                          |---------> refused   (definite business refusal)
//          |                          |---------> awaiting_approval (price changed)
//          |                          '---------> unconfirmed (outcome unknown)
//          |--10 min--> expired
//          '--cancel / superseded--> cancelled
//
//   unconfirmed --any approve or check--> look up by checkoutSessionId first:
//          found -> placed | none -> awaiting_approval (or expired) | lookup failed -> stays unconfirmed
//
// An unconfirmed proposal is never expired, cancelled or superseded on its
// own: the order may exist, so only a successful lookup may settle it.
//
// The model can create a proposal (propose_order) but can never approve one.
// approve() is reached only from the app's approval endpoint, after the
// customer taps Approve. The proposal id doubles as the checkoutSessionId, so
// a double tap or a retry can never create a second order.

import { randomUUID } from 'node:crypto';
import {
  PortError,
  type BehtafoodPort,
  type Cart,
  type CustomerContext,
  type PlacedOrder,
  type PortErrorCode,
  type Quote,
  type QuoteLine,
} from './port';

export const PROPOSAL_TTL_MS = 10 * 60 * 1000;

export type ProposalState = 'awaiting_approval' | 'placing' | 'placed' | 'refused' | 'expired' | 'cancelled' | 'unconfirmed';

export interface Proposal {
  id: string;
  customerId: string;
  sessionId: string;
  cart: Cart;
  /** The server's quote, exactly as returned. */
  quote: Quote;
  /** Card images (display only). */
  images?: ProposalImages;
  state: ProposalState;
  createdAt: number;
  expiresAt: number;
  order?: PlacedOrder;
  refusal?: { code: RefusalCode; message: string };
  /** Set after an uncertain outcome (state 'unconfirmed'): the next attempt must look the order up first. */
  outcomeUncertain: boolean;
}

/** What the approval card shows. */
/** Images for the approval card. Display only: never part of a model message. */
export interface ProposalImages {
  restaurantImageUrl?: string;
  /** By item id. */
  items?: Record<string, string>;
}

export interface ProposalView {
  proposalId: string;
  restaurantName: string;
  restaurantImageUrl?: string;
  lines: (QuoteLine & { imageUrl?: string })[];
  subtotalNaira: number;
  deliveryFeeNaira: number;
  discountNaira: number;
  totalNaira: number;
  expiresAt: string;
  state: ProposalState;
}

export type RefusalCode = PortErrorCode | 'EXPIRED' | 'CANCELLED';

export type ApproveResult =
  | { status: 'placed'; order: PlacedOrder; alreadyPlaced: boolean }
  | { status: 'price_changed'; proposal: ProposalView; previousTotalNaira: number }
  | { status: 'refused'; code: RefusalCode; message: string }
  /** lookupFailed: the order may exist and we could not check; the customer should look in My Orders. */
  | { status: 'uncertain'; message: string; lookupFailed?: boolean };

/** A read-only lookup by checkoutSessionId. Places nothing. */
export type CheckResult =
  | { status: 'placed'; order: PlacedOrder }
  | { status: 'not_placed' }
  | { status: 'check_failed'; message: string };

export const UNCERTAIN_MESSAGE = 'We could not confirm the order. Nothing is charged twice: tap Approve again to check and finish.';
export const LOOKUP_FAILED_MESSAGE =
  "We couldn't check whether your order went through. Please look in My Orders before trying again.";

export interface ProposalStoreOptions {
  clock?: () => number;
  ttlMs?: number;
  newId?: () => string;
}

export class ProposalStore {
  readonly #byId = new Map<string, Proposal>();
  readonly #inFlight = new Map<string, Promise<ApproveResult>>();
  readonly #clock: () => number;
  readonly #ttl: number;
  readonly #newId: () => string;

  constructor(
    readonly port: BehtafoodPort,
    opts: ProposalStoreOptions = {},
  ) {
    this.#clock = opts.clock ?? Date.now;
    this.#ttl = opts.ttlMs ?? PROPOSAL_TTL_MS;
    this.#newId = opts.newId ?? (() => `prop_${randomUUID()}`);
  }

  /** Records a quoted cart for approval. Any earlier open proposal in the same session is superseded. */
  create(ctx: CustomerContext, input: { sessionId: string; cart: Cart; quote: Quote; images?: ProposalImages }): Proposal {
    for (const p of this.#byId.values()) {
      if (p.sessionId === input.sessionId && p.customerId === ctx.customerId && p.state === 'awaiting_approval') p.state = 'cancelled';
    }
    const now = this.#clock();
    const p: Proposal = {
      id: this.#newId(),
      customerId: ctx.customerId,
      sessionId: input.sessionId,
      cart: structuredClone(input.cart),
      quote: structuredClone(input.quote),
      ...(input.images ? { images: structuredClone(input.images) } : {}),
      state: 'awaiting_approval',
      createdAt: now,
      expiresAt: now + this.#ttl,
      outcomeUncertain: false,
    };
    this.#byId.set(p.id, p);
    return p;
  }

  /** Only the owner can see a proposal. */
  get(ctx: CustomerContext, id: string): Proposal | undefined {
    const p = this.#byId.get(id);
    return p && p.customerId === ctx.customerId ? p : undefined;
  }

  view(p: Proposal): ProposalView {
    return {
      proposalId: p.id,
      restaurantName: p.quote.restaurantName,
      ...(p.images?.restaurantImageUrl ? { restaurantImageUrl: p.images.restaurantImageUrl } : {}),
      lines: p.quote.lines.map((l) => (p.images?.items?.[l.itemId] ? { ...l, imageUrl: p.images.items[l.itemId] } : l)),
      subtotalNaira: p.quote.subtotalNaira,
      deliveryFeeNaira: p.quote.deliveryFeeNaira,
      discountNaira: p.quote.discountNaira,
      totalNaira: p.quote.totalNaira,
      expiresAt: new Date(p.expiresAt).toISOString(),
      state: p.state,
    };
  }

  cancel(ctx: CustomerContext, id: string): boolean {
    const p = this.get(ctx, id);
    if (!p || p.state !== 'awaiting_approval') return false;
    p.state = 'cancelled';
    return true;
  }

  /**
   * Read-only: is there an order for this proposal? Works even for a proposal
   * this store no longer holds (after a restart), because the proposal id is
   * the order's checkoutSessionId and the lookup is scoped to the customer.
   */
  async check(ctx: CustomerContext, id: string): Promise<CheckResult> {
    const p = this.get(ctx, id);
    if (p?.state === 'placed' && p.order) return { status: 'placed', order: p.order };
    const found = await this.#lookup(ctx, id);
    if (found === 'failed') return { status: 'check_failed', message: LOOKUP_FAILED_MESSAGE };
    if (found) {
      if (p) this.#placed(p, found, true);
      return { status: 'placed', order: found };
    }
    if (p?.state === 'unconfirmed') this.#settleNoOrder(p);
    return { status: 'not_placed' };
  }

  /** Called only by the approval endpoint. Concurrent calls for one proposal share one attempt. */
  approve(ctx: CustomerContext, id: string): Promise<ApproveResult> {
    const running = this.#inFlight.get(id);
    if (running && this.get(ctx, id)) return running;
    const attempt = this.#approve(ctx, id).finally(() => this.#inFlight.delete(id));
    this.#inFlight.set(id, attempt);
    return attempt;
  }

  async #approve(ctx: CustomerContext, id: string): Promise<ApproveResult> {
    const p = this.get(ctx, id);
    if (!p) {
      // Unknown here (e.g. after a restart), but an order may still exist for it.
      const found = await this.#lookup(ctx, id);
      if (found === 'failed') return { status: 'uncertain', lookupFailed: true, message: LOOKUP_FAILED_MESSAGE };
      if (found) return { status: 'placed', order: found, alreadyPlaced: true };
      return { status: 'refused', code: 'NOT_FOUND', message: 'This order proposal was not found.' };
    }
    if (p.state === 'placed' && p.order) return { status: 'placed', order: p.order, alreadyPlaced: true };
    if (p.state === 'refused' && p.refusal) return { status: 'refused', ...p.refusal };
    if (p.state === 'cancelled') return { status: 'refused', code: 'CANCELLED', message: 'This proposal was cancelled.' };

    // Unconfirmed: settle it by lookup before anything else, expiry included.
    if (p.state === 'unconfirmed') {
      const found = await this.#lookup(ctx, p.id);
      if (found === 'failed') return { status: 'uncertain', lookupFailed: true, message: LOOKUP_FAILED_MESSAGE };
      if (found) return this.#placed(p, found, true);
      this.#settleNoOrder(p);
    }

    if (p.state === 'expired' || this.#clock() > p.expiresAt) {
      p.state = 'expired';
      return { status: 'refused', code: 'EXPIRED', message: 'This proposal expired. Ask the assistant for a fresh quote.' };
    }

    p.state = 'placing';
    try {
      // Re-quote. A changed total refuses and asks again with the new quote.
      const fresh = await this.port.quoteOrder(ctx, p.cart);
      if (fresh.totalNaira !== p.quote.totalNaira) {
        const previousTotalNaira = p.quote.totalNaira;
        p.quote = fresh;
        p.expiresAt = this.#clock() + this.#ttl;
        p.state = 'awaiting_approval';
        return { status: 'price_changed', proposal: this.view(p), previousTotalNaira };
      }

      const balance = await this.port.getWalletBalance(ctx);
      if (balance < fresh.totalNaira) {
        throw new PortError('INSUFFICIENT_BALANCE', 'Your wallet balance is too low for this order. Top up your wallet and try again.');
      }

      const order = await this.port.placeWalletOrder(ctx, { checkoutSessionId: p.id, cart: p.cart, expectedTotalNaira: fresh.totalNaira });
      return this.#placed(p, order, false);
    } catch (err) {
      if (err instanceof PortError) {
        p.state = 'refused';
        p.refusal = { code: err.code, message: err.message };
        return { status: 'refused', ...p.refusal };
      }
      // Uncertain: it may have been placed. Check by checkoutSessionId before anything else.
      const found = await this.#lookup(ctx, p.id);
      if (found && found !== 'failed') return this.#placed(p, found, false);
      // Not found yet, or the lookup failed: the request may still land, so
      // the proposal stays unconfirmed until a later lookup settles it.
      p.state = 'unconfirmed';
      p.outcomeUncertain = true;
      return { status: 'uncertain', message: UNCERTAIN_MESSAGE };
    }
  }

  async #lookup(ctx: CustomerContext, id: string): Promise<PlacedOrder | null | 'failed'> {
    try {
      return await this.port.findOrderByCheckoutSession(ctx, id);
    } catch {
      return 'failed';
    }
  }

  /** A lookup confirmed there is no order: back to an ordinary proposal (which may then expire). */
  #settleNoOrder(p: Proposal): void {
    p.state = 'awaiting_approval';
    p.outcomeUncertain = false;
  }

  #placed(p: Proposal, order: PlacedOrder, alreadyPlaced: boolean): ApproveResult {
    p.state = 'placed';
    p.order = order;
    p.outcomeUncertain = false;
    return { status: 'placed', order, alreadyPlaced };
  }
}
