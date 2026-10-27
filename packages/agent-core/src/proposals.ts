// Proposal and approval state machine.
//
//   awaiting_approval --approve--> placing --ok--> placed
//          |                          |---------> refused   (definite business refusal)
//          |                          |---------> awaiting_approval (uncertain or price changed)
//          |--10 min--> expired
//          |--cancel / superseded--> cancelled
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

export type ProposalState = 'awaiting_approval' | 'placing' | 'placed' | 'refused' | 'expired' | 'cancelled';

export interface Proposal {
  id: string;
  customerId: string;
  sessionId: string;
  cart: Cart;
  /** The server's quote, exactly as returned. */
  quote: Quote;
  state: ProposalState;
  createdAt: number;
  expiresAt: number;
  order?: PlacedOrder;
  refusal?: { code: RefusalCode; message: string };
  /** Set after an uncertain outcome: the next attempt must look the order up first. */
  outcomeUncertain: boolean;
}

/** What the approval card shows. */
export interface ProposalView {
  proposalId: string;
  restaurantName: string;
  lines: QuoteLine[];
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
  | { status: 'uncertain'; message: string };

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
  create(ctx: CustomerContext, input: { sessionId: string; cart: Cart; quote: Quote }): Proposal {
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
      lines: p.quote.lines,
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
    if (!p) return { status: 'refused', code: 'NOT_FOUND', message: 'This order proposal was not found.' };
    if (p.state === 'placed' && p.order) return { status: 'placed', order: p.order, alreadyPlaced: true };
    if (p.state === 'refused' && p.refusal) return { status: 'refused', ...p.refusal };
    if (p.state === 'cancelled') return { status: 'refused', code: 'CANCELLED', message: 'This proposal was cancelled.' };
    if (p.state === 'expired' || this.#clock() > p.expiresAt) {
      p.state = 'expired';
      return { status: 'refused', code: 'EXPIRED', message: 'This proposal expired. Ask the assistant for a fresh quote.' };
    }

    p.state = 'placing';
    try {
      // After an uncertain outcome, the order may already exist: look first.
      if (p.outcomeUncertain) {
        const found = await this.port.findOrderByCheckoutSession(ctx, p.id);
        if (found) return this.#placed(p, found, true);
      }

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
      p.outcomeUncertain = true;
      try {
        const found = await this.port.findOrderByCheckoutSession(ctx, p.id);
        if (found) return this.#placed(p, found, false);
      } catch {
        // Lookup failed too; stay retryable. The next attempt looks up first.
      }
      p.state = 'awaiting_approval';
      return { status: 'uncertain', message: 'We could not confirm the order. Nothing is charged twice: tap Approve again to check and finish.' };
    }
  }

  #placed(p: Proposal, order: PlacedOrder, alreadyPlaced: boolean): ApproveResult {
    p.state = 'placed';
    p.order = order;
    p.outcomeUncertain = false;
    return { status: 'placed', order, alreadyPlaced };
  }
}
