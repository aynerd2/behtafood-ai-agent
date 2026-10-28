// Guided mode: which real app screen each assistant step corresponds to.
//
// Truthfulness rules this encodes:
//   - An action is derived only from an event that says the step SUCCEEDED
//     (status 'done'), from the assistant's own reply, from a needed choice,
//     or from a placed order the server confirmed. Failures move nothing.
//   - Guided mode SHOWS what the assistant did; it never performs anything.
//     It never taps Pay or Place order and never touches the customer's own
//     cart: "added to cart" is the AI's cart, animated and labelled as such.
//   - Every highlight is labelled "Behtafood AI is viewing…".

import { choicesText } from './format';
import type { AgentEvent, PlacedOrder } from './types';

export const VIEWING_LABEL = 'Behtafood AI is viewing…';

export interface GuideCartItem {
  itemId: string;
  name: string;
  quantity: number;
  choices?: { group: string; option: string }[];
}

export type GuideAction =
  | { kind: 'show_restaurants'; key: string; restaurantIds: string[]; label: string }
  | { kind: 'open_menu'; key: string; restaurantId: string; label: string }
  | { kind: 'focus_dish'; key: string; restaurantId: string; itemId: string; label: string }
  | { kind: 'add_to_cart'; key: string; restaurantId: string; items: GuideCartItem[]; label: string }
  | { kind: 'show_approval'; key: string; proposalId: string; label: string }
  | { kind: 'open_tracking'; key: string; orderId: string; reference: string; label: string };

export type GuideRoute = { screen: 'home' } | { screen: 'restaurant'; restaurantId: string } | { screen: 'tracking'; orderId: string };

export interface GuideHighlight {
  restaurantIds: string[];
  restaurantId?: string;
  itemIds: string[];
  label: string;
}

export interface GuideEffects {
  route?: GuideRoute;
  /** null clears highlights; undefined leaves them as they are. */
  highlight?: GuideHighlight | null;
  /** Dishes to animate into the AI's cart. */
  fly?: { itemId: string; name: string; quantity: number }[];
}

export interface GuideMapState {
  /** Restaurant id -> name, from searches. */
  names: Record<string, string>;
  /** Restaurant id -> the dishes the assistant read, most recent menu last. */
  menus: Record<string, { id: string; name: string }[]>;
}

export function initialGuideMap(): GuideMapState {
  return { names: {}, menus: {} };
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' ? (v as Record<string, any>) : {});
const norm = (s: string) => ` ${s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** The first dish (by position in the text) from any menu read so far. */
function dishMentioned(s: GuideMapState, text: string): { restaurantId: string; id: string; name: string } | undefined {
  const hay = norm(text);
  let best: { restaurantId: string; id: string; name: string; at: number } | undefined;
  for (const [restaurantId, items] of Object.entries(s.menus)) {
    for (const it of items) {
      const at = hay.indexOf(norm(it.name));
      if (at >= 0 && (!best || at < best.at)) best = { restaurantId, id: it.id, name: it.name, at };
    }
  }
  return best;
}

function restaurantOf(s: GuideMapState, itemId: string): string | undefined {
  return Object.entries(s.menus).find(([, items]) => items.some((i) => i.id === itemId))?.[0];
}

export function mapGuideEvent(s: GuideMapState, key: string, e: AgentEvent): { state: GuideMapState; action?: GuideAction } {
  if (e.type === 'awaiting_approval') {
    return { state: s, action: { kind: 'show_approval', key, proposalId: e.proposal.proposalId, label: 'Waiting for your approval' } };
  }
  if (e.type === 'reply') {
    const dish = dishMentioned(s, e.text);
    if (!dish) return { state: s };
    return { state: s, action: { kind: 'focus_dish', key, restaurantId: dish.restaurantId, itemId: dish.id, label: `Behtafood AI is viewing ${dish.name}…` } };
  }
  if (e.type !== 'step') return { state: s };
  const data = obj(e.data);

  // A required choice is a question, not a failure of the app: show the dish.
  if (e.tool === 'build_cart' && e.status === 'failed' && data.needsChoice) {
    const n = obj(data.needsChoice);
    const restaurantId = restaurantOf(s, String(n.itemId));
    if (!restaurantId) return { state: s };
    return { state: s, action: { kind: 'focus_dish', key, restaurantId, itemId: String(n.itemId), label: `Behtafood AI is viewing ${String(n.itemName)}…` } };
  }
  if (e.status !== 'done') return { state: s };

  if (e.tool === 'search_restaurants' && Array.isArray(data.restaurants)) {
    const names = { ...s.names };
    const ids: string[] = [];
    for (const r of data.restaurants) {
      names[String(r.id)] = String(r.name);
      ids.push(String(r.id));
    }
    const state = { ...s, names };
    if (ids.length === 0) return { state };
    return { state, action: { kind: 'show_restaurants', key, restaurantIds: ids, label: `Behtafood AI is viewing ${ids.length} restaurant${ids.length === 1 ? '' : 's'}…` } };
  }
  if (e.tool === 'get_menu' && typeof data.restaurantId === 'string') {
    const restaurantId = data.restaurantId;
    const items = (Array.isArray(data.items) ? data.items : []).map((i: any) => ({ id: String(i.id), name: String(i.name) }));
    const state = { ...s, menus: { ...s.menus, [restaurantId]: items } };
    const name = s.names[restaurantId] ?? (e.label.startsWith('Read menu: ') ? e.label.slice('Read menu: '.length) : 'this restaurant');
    return { state, action: { kind: 'open_menu', key, restaurantId, label: `Behtafood AI is viewing the menu at ${name}…` } };
  }
  if (e.tool === 'build_cart' && typeof data.restaurantId === 'string' && Array.isArray(data.items)) {
    const items: GuideCartItem[] = data.items
      .filter((i: any) => typeof i?.itemId === 'string')
      .map((i: any) => ({ itemId: i.itemId, name: String(i.name), quantity: Number(i.quantity) || 1, ...(i.choices?.length ? { choices: i.choices } : {}) }));
    if (items.length === 0) return { state: s };
    const text = items.map((i) => `${i.quantity} x ${i.name}${i.choices ? ` (${choicesText(i.choices)})` : ''}`).join(', ');
    return { state: s, action: { kind: 'add_to_cart', key, restaurantId: data.restaurantId, items, label: `Added to the AI's cart: ${text} (your own cart is unchanged)` } };
  }
  return { state: s };
}

/** After the server confirms an order: open its real tracking screen. */
export function guideActionForPlaced(order: PlacedOrder, key: string): GuideAction {
  return { kind: 'open_tracking', key, orderId: order.orderId, reference: order.reference, label: `Order placed: ${order.reference}. Opening tracking…` };
}

export function guideEffects(a: GuideAction): GuideEffects {
  switch (a.kind) {
    case 'show_restaurants':
      return { route: { screen: 'home' }, highlight: { restaurantIds: a.restaurantIds, itemIds: [], label: VIEWING_LABEL } };
    case 'open_menu':
      return { route: { screen: 'restaurant', restaurantId: a.restaurantId }, highlight: { restaurantIds: [], restaurantId: a.restaurantId, itemIds: [], label: VIEWING_LABEL } };
    case 'focus_dish':
      return { route: { screen: 'restaurant', restaurantId: a.restaurantId }, highlight: { restaurantIds: [], restaurantId: a.restaurantId, itemIds: [a.itemId], label: VIEWING_LABEL } };
    case 'add_to_cart':
      return {
        route: { screen: 'restaurant', restaurantId: a.restaurantId },
        highlight: { restaurantIds: [], restaurantId: a.restaurantId, itemIds: a.items.map((i) => i.itemId), label: VIEWING_LABEL },
        fly: a.items.map(({ itemId, name, quantity }) => ({ itemId, name, quantity })),
      };
    case 'show_approval':
      return {};
    case 'open_tracking':
      return { route: { screen: 'tracking', orderId: a.orderId }, highlight: null };
  }
}
