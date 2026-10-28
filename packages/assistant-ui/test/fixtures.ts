// Shared fixtures: run events exactly as the Behtafood agent endpoints return them.

import type { AgentEvent, ApproveResult, ProposalView, StoredEvent } from '../src/logic/types';

export const NOW = Date.parse('2026-10-29T12:00:00Z');

export function proposal(over: Partial<ProposalView> = {}): ProposalView {
  return {
    proposalId: 'prop_1',
    restaurantName: 'Spice Route Kitchen',
    lines: [
      {
        itemId: 'itm_jollof_chicken',
        name: 'Jollof rice & chicken',
        quantity: 1,
        unitPriceNaira: 2500,
        lineTotalNaira: 2500,
        choices: [{ group: 'Protein', option: 'Chicken', priceNaira: 0 }],
      },
    ],
    subtotalNaira: 2500,
    deliveryFeeNaira: 800,
    discountNaira: 0,
    totalNaira: 3300,
    expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
    state: 'awaiting_approval',
    ...over,
  };
}

let seq = 0;
export function resetSeq() {
  seq = 0;
}
export function ev(event: AgentEvent): StoredEvent {
  seq += 1;
  return { seq, at: new Date(NOW + seq * 1000).toISOString(), event };
}

export const MENU_ITEMS = [
  { id: 'itm_ofada', name: 'Ofada rice', price_naira: 2800 },
  {
    id: 'itm_jollof_chicken',
    name: 'Jollof rice & chicken',
    price_naira: 2500,
    choices: [
      {
        group: 'Protein',
        required: true,
        max: 1,
        options: [
          { name: 'Chicken', extra_price_naira: 0 },
          { name: 'Beef', extra_price_naira: 0 },
          { name: 'Turkey', extra_price_naira: 800 },
        ],
      },
      { group: 'Extras', required: false, max: 2, options: [{ name: 'Coleslaw', extra_price_naira: 300 }] },
    ],
  },
];

/** A full happy run: search, menu, cart, quote, proposal, reply, done. */
export function happyRun(p = proposal()): StoredEvent[] {
  return [
    ev({ type: 'session', sessionId: 'ses_1' }),
    ev({ type: 'step', tool: 'search_restaurants', status: 'done', label: 'Searched restaurants: 2 open', data: { restaurants: [{ id: 'rst_1', name: 'Spice Route Kitchen', delivery_fee_naira: 800 }, { id: 'rst_2', name: 'Wrap City', delivery_fee_naira: 500 }] } }),
    ev({ type: 'step', tool: 'get_menu', status: 'done', label: 'Read menu: Spice Route Kitchen', data: { restaurantId: 'rst_1', items: MENU_ITEMS } }),
    ev({ type: 'step', tool: 'build_cart', status: 'done', label: 'Built cart', data: { cartId: 'cart_1', restaurantId: 'rst_1', items: [{ itemId: 'itm_jollof_chicken', name: 'Jollof rice & chicken', quantity: 1, choices: [{ group: 'Protein', option: 'Chicken' }] }] } }),
    ev({ type: 'step', tool: 'quote_order', status: 'done', label: 'Got the server quote: ₦3,300' }),
    ev({ type: 'step', tool: 'propose_order', status: 'done', label: 'Prepared the approval card' }),
    ev({ type: 'awaiting_approval', proposal: p }),
    ev({ type: 'reply', text: 'Tap Approve to order. Nothing is charged until you do.' }),
    ev({ type: 'done', modelCalls: 6, costUsd: 0.01 }),
  ];
}

export const PLACED: ApproveResult = {
  status: 'placed',
  alreadyPlaced: false,
  order: { orderId: 'ord_9', reference: 'ORD-ABC-123', checkoutSessionId: 'prop_1', restaurantId: 'rst_1', totalNaira: 3300, status: 'preparing', createdAt: new Date(NOW).toISOString() },
};
