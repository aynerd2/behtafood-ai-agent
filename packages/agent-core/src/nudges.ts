// Templated nudges to the vendor or rider of the customer's own active order.
// Fixed, polite text only (the model never writes the message): no pressure,
// no times, no ETA promises. At most 1 per party per 10 minutes and 2 per
// order, and every attempt is logged with who, when and the result.
//
// Results are reported honestly: a reminder is "sent" (handed to the push
// service) or "couldn't send". Nothing here can know it was delivered or read.

import { FINAL_ORDER_STATUSES, PortError, type BehtafoodPort, type CustomerContext, type NudgeParty } from './port';

export const NUDGE_TEMPLATES: Record<NudgeParty, string> = {
  vendor: 'Hello from Behtafood. The customer is checking on order {reference}. When you can, please update its status in your app. Thank you.',
  rider: 'Hello from Behtafood. The customer is checking on order {reference}. When it is safe, please update the delivery status in your app. Thank you.',
};

export const NUDGE_PARTY_COOLDOWN_MS = 10 * 60 * 1000;
export const NUDGE_MAX_PER_ORDER = 2;

export type NudgeRefusal = 'NOT_CONFIRMED' | 'NOT_FOUND' | 'NOT_ACTIVE' | 'NO_RIDER' | 'COOLDOWN' | 'ORDER_LIMIT' | 'SEND_FAILED';

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
  SEND_FAILED: 'The reminder could not be sent.',
};

const PARTY_NAME: Record<NudgeParty, string> = { vendor: 'the restaurant', rider: 'the rider' };

/** What the customer is told. Never "delivered" or "read": we cannot know that. */
export function nudgeResultText(party: NudgeParty, r: NudgeResult): string {
  if (r.sent) return `Reminder sent to ${PARTY_NAME[party]}.`;
  switch (r.code) {
    case 'SEND_FAILED':
      return "Couldn't send the reminder. Please try again later.";
    case 'COOLDOWN':
      return `You reminded ${PARTY_NAME[party]} less than 10 minutes ago. Please wait a little before reminding again.`;
    case 'ORDER_LIMIT':
      return 'This order has had 2 reminders, the most we send.';
    case 'NO_RIDER':
      return 'No rider is assigned yet, so there is no rider to remind.';
    case 'NOT_ACTIVE':
      return 'This order is finished, so no reminder is needed.';
    case 'NOT_FOUND':
      return "We couldn't find this order on your account.";
    case 'NOT_CONFIRMED':
      return 'Reminders are only sent when you ask for one.';
  }
}

export class NudgeService {
  readonly log: NudgeLogEntry[] = [];

  constructor(
    readonly port: BehtafoodPort,
    readonly clock: () => number = Date.now,
  ) {}

  /** The fixed explanation for a refusal (what the model is told). */
  refusalText(code: NudgeRefusal): string {
    return REFUSAL_TEXT[code];
  }

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
    // A pickup order has no rider, whatever else the record says.
    if (req.party === 'rider' && (status.fulfilment === 'pickup' || !status.riderAssigned)) return refuse('NO_RIDER');

    const sent = this.log.filter((l) => l.orderId === req.orderId && l.customerId === ctx.customerId && l.outcome === 'sent');
    if (sent.length >= NUDGE_MAX_PER_ORDER) return refuse('ORDER_LIMIT');
    const lastSame = sent.filter((l) => l.party === req.party).at(-1);
    if (lastSame && this.clock() - Date.parse(lastSame.at) < NUDGE_PARTY_COOLDOWN_MS) return refuse('COOLDOWN');

    const message = NUDGE_TEMPLATES[req.party].replace('{reference}', status.reference);
    try {
      await this.port.sendNudge(ctx, { orderId: req.orderId, party: req.party, message });
    } catch {
      // Logged by nudge(); a failed send does not count towards the limits.
      return refuse('SEND_FAILED');
    }
    return { sent: true, message };
  }
}
