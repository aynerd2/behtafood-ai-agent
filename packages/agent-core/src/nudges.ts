// Templated nudges to the vendor or rider of the customer's own active order.
// Fixed text only (the model never writes the message), no ETA promises,
// at most 1 per party per 10 minutes and 2 per order, and every attempt logged.

import { FINAL_ORDER_STATUSES, PortError, type BehtafoodPort, type CustomerContext, type NudgeParty } from './port';

export const NUDGE_TEMPLATES: Record<NudgeParty, string> = {
  vendor: 'Behtafood: the customer is checking on order {reference}. Please update its status in your app.',
  rider: 'Behtafood: the customer is checking on order {reference}. Please update your delivery status in your app.',
};

export const NUDGE_PARTY_COOLDOWN_MS = 10 * 60 * 1000;
export const NUDGE_MAX_PER_ORDER = 2;

export type NudgeRefusal = 'NOT_CONFIRMED' | 'NOT_FOUND' | 'NOT_ACTIVE' | 'NO_RIDER' | 'COOLDOWN' | 'ORDER_LIMIT';

export type NudgeResult = { sent: true; message: string } | { sent: false; code: NudgeRefusal; message: string };

export interface NudgeLogEntry {
  at: string;
  customerId: string;
  orderId: string;
  party: NudgeParty;
  outcome: 'sent' | NudgeRefusal;
}

const REFUSAL_TEXT: Record<NudgeRefusal, string> = {
  NOT_CONFIRMED: 'Ask the customer first; send only after they say yes.',
  NOT_FOUND: 'Order not found for this customer.',
  NOT_ACTIVE: 'This order is already finished.',
  NO_RIDER: 'No rider is assigned yet.',
  COOLDOWN: 'Already nudged in the last 10 minutes.',
  ORDER_LIMIT: 'This order has had the maximum of 2 nudges.',
};

export class NudgeService {
  readonly log: NudgeLogEntry[] = [];

  constructor(
    readonly port: BehtafoodPort,
    readonly clock: () => number = Date.now,
  ) {}

  async nudge(ctx: CustomerContext, req: { orderId: string; party: NudgeParty; customerConfirmed: boolean }): Promise<NudgeResult> {
    const outcome = await this.#decide(ctx, req);
    this.log.push({ at: new Date(this.clock()).toISOString(), customerId: ctx.customerId, orderId: req.orderId, party: req.party, outcome: outcome.sent ? 'sent' : outcome.code });
    return outcome;
  }

  async #decide(ctx: CustomerContext, req: { orderId: string; party: NudgeParty; customerConfirmed: boolean }): Promise<NudgeResult> {
    const refuse = (code: NudgeRefusal): NudgeResult => ({ sent: false, code, message: REFUSAL_TEXT[code] });
    if (req.customerConfirmed !== true) return refuse('NOT_CONFIRMED');

    let status;
    try {
      status = await this.port.getOrderStatus(ctx, req.orderId);
    } catch (err) {
      if (err instanceof PortError) return refuse('NOT_FOUND');
      throw err;
    }
    if (FINAL_ORDER_STATUSES.includes(status.status)) return refuse('NOT_ACTIVE');
    if (req.party === 'rider' && !status.riderAssigned) return refuse('NO_RIDER');

    const sent = this.log.filter((l) => l.orderId === req.orderId && l.customerId === ctx.customerId && l.outcome === 'sent');
    if (sent.length >= NUDGE_MAX_PER_ORDER) return refuse('ORDER_LIMIT');
    const lastSame = sent.filter((l) => l.party === req.party).at(-1);
    if (lastSame && this.clock() - Date.parse(lastSame.at) < NUDGE_PARTY_COOLDOWN_MS) return refuse('COOLDOWN');

    const message = NUDGE_TEMPLATES[req.party].replace('{reference}', status.reference);
    await this.port.sendNudge(ctx, { orderId: req.orderId, party: req.party, message });
    return { sent: true, message };
  }
}
