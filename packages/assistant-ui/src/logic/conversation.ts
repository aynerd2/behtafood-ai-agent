// The conversation as the chat panel draws it, built only from server events.
//
// Rules this encodes:
//   - A step appears only when its event has arrived, with the status the
//     event gives it. Nothing is ever shown as done ahead of the server.
//   - Failures stay failures. An error event is a failed row with its message.
//   - "Waiting for your approval" is its own row, not a done step.
//   - Events are applied once each, by sequence number, so a repeated or
//     overlapping poll never duplicates anything.

import { newCard, type ApprovalCardState } from './approval';
import { choicesText } from './format';
import type { MenuChoiceGroup, ProposalView, StoredEvent } from './types';

export interface TimelineStep {
  seq: number;
  tool: string;
  status: 'done' | 'failed';
  label: string;
}

export interface RestaurantCardData {
  id: string;
  name: string;
  deliveryFeeNaira: number;
  imageUrl?: string;
}

export interface CartCardData {
  cartId: string;
  items: { name: string; quantity: number; choices?: { group: string; option: string }[]; imageUrl?: string }[];
}

/** `{ imageUrl }` only for a string value (display data from the server). */
const imageOf = (v: unknown): { imageUrl?: string } => (typeof v === 'string' && v ? { imageUrl: v } : {});

export interface ChoiceOption {
  name: string;
  extraPriceNaira: number;
}

/** A required pick the assistant asked the customer to make. Never pre-selected. */
export interface ChoicePrompt {
  itemId: string;
  itemName: string;
  group: string;
  options: ChoiceOption[];
  selected?: undefined;
}

export interface MenuChoiceEntry {
  itemId: string;
  itemName: string;
  groups: MenuChoiceGroup[];
}

export type TurnStatus = 'sending' | 'running' | 'finished' | 'failed';

export interface Turn {
  id: string;
  userText: string;
  runId?: string;
  status: TurnStatus;
  lastSeq: number;
  steps: TimelineStep[];
  restaurants?: RestaurantCardData[];
  carts: CartCardData[];
  proposalIds: string[];
  reply?: string;
  error?: { code?: string; message: string };
  /** The photo sent with this message (shown as a thumbnail; kept in the app only). */
  photo?: string;
  /** From a NEEDS_CHOICE step in this turn. */
  choicePrompt?: ChoicePrompt;
}

export interface ConversationState {
  sessionId?: string;
  turns: Turn[];
  cards: Record<string, ApprovalCardState>;
  /** Items with choice groups, from every menu read in this conversation. */
  menuItems: Record<string, MenuChoiceEntry>;
}

export type RowStatus = 'done' | 'failed' | 'working' | 'awaiting' | 'info';

export interface TimelineRow {
  key: string;
  status: RowStatus;
  label: string;
}

export function initialState(): ConversationState {
  return { turns: [], cards: {}, menuItems: {} };
}

function updateTurn(s: ConversationState, turnId: string, fn: (t: Turn) => Turn): ConversationState {
  return { ...s, turns: s.turns.map((t) => (t.id === turnId ? fn(t) : t)) };
}

export function startTurn(s: ConversationState, turnId: string, userText: string, photo?: string): ConversationState {
  const turn: Turn = { id: turnId, userText, status: 'sending', lastSeq: 0, steps: [], carts: [], proposalIds: [], ...(photo ? { photo } : {}) };
  return { ...s, turns: [...s.turns, turn] };
}

export function turnAccepted(s: ConversationState, turnId: string, r: { runId: string; sessionId: string | null }): ConversationState {
  const next = updateTurn(s, turnId, (t) => ({ ...t, runId: r.runId, status: 'running' }));
  return r.sessionId ? { ...next, sessionId: r.sessionId } : next;
}

export function turnFailed(s: ConversationState, turnId: string, message: string): ConversationState {
  return updateTurn(s, turnId, (t) => ({ ...t, status: 'failed', error: { message } }));
}

/** Cards that may still lead to an order: no choice buttons while one is open. */
const OPEN_CARD = new Set(['awaiting', 'price_changed', 'uncertain', 'unverified', 'checking', 'failed']);
/** Cards a newer quote replaces. Never a not-confirmed one: its order may exist. */
const SUPERSEDABLE = new Set(['awaiting', 'price_changed', 'failed']);

const asObj = (v: unknown): Record<string, any> => (v && typeof v === 'object' ? (v as Record<string, any>) : {});

export function applyRunEvents(s: ConversationState, turnId: string, events: StoredEvent[], finished: boolean): ConversationState {
  let state = s;
  const fresh = [...events].sort((a, b) => a.seq - b.seq);
  for (const stored of fresh) {
    const turn = state.turns.find((t) => t.id === turnId);
    if (!turn || stored.seq <= turn.lastSeq) continue;
    state = applyOne(state, turnId, stored);
    state = updateTurn(state, turnId, (t) => ({ ...t, lastSeq: stored.seq }));
  }
  if (finished) state = updateTurn(state, turnId, (t) => (t.status === 'failed' ? t : { ...t, status: 'finished' }));
  return state;
}

function applyOne(s: ConversationState, turnId: string, stored: StoredEvent): ConversationState {
  const e = stored.event;
  switch (e.type) {
    case 'session':
      return { ...s, sessionId: e.sessionId };
    case 'step': {
      let next = updateTurn(s, turnId, (t) => ({ ...t, steps: [...t.steps, { seq: stored.seq, tool: e.tool, status: e.status, label: e.label }] }));
      const data = asObj(e.data);
      if (e.tool === 'search_restaurants' && e.status === 'done' && Array.isArray(data.restaurants)) {
        const restaurants = data.restaurants.map((r: any) => ({ id: String(r.id), name: String(r.name), deliveryFeeNaira: Number(r.delivery_fee_naira), ...imageOf(r.imageUrl) }));
        next = updateTurn(next, turnId, (t) => ({ ...t, restaurants }));
      }
      if (e.tool === 'get_menu' && e.status === 'done' && Array.isArray(data.items)) {
        const menuItems = { ...next.menuItems };
        for (const it of data.items) {
          if (Array.isArray(it?.choices) && it.choices.length) {
            menuItems[String(it.id)] = { itemId: String(it.id), itemName: String(it.name), groups: it.choices };
          }
        }
        next = { ...next, menuItems };
      }
      if (e.tool === 'build_cart' && e.status === 'done' && Array.isArray(data.items)) {
        const items = data.items.map(({ imageUrl, ...it }: any) => ({ ...it, ...imageOf(imageUrl) }));
        const cart: CartCardData = { cartId: String(data.cartId ?? stored.seq), items };
        next = updateTurn(next, turnId, (t) => ({ ...t, carts: [...t.carts, cart] }));
      }
      if (e.tool === 'build_cart' && e.status === 'failed' && data.needsChoice) {
        const n = asObj(data.needsChoice);
        const prompt: ChoicePrompt = {
          itemId: String(n.itemId),
          itemName: String(n.itemName),
          group: String(n.group),
          options: (Array.isArray(n.options) ? n.options : []).map((o: any) => ({ name: String(o.name), extraPriceNaira: Number(o.extra_price_naira) || 0 })),
        };
        next = updateTurn(next, turnId, (t) => ({ ...t, choicePrompt: prompt }));
      }
      return next;
    }
    case 'awaiting_approval': {
      const id = e.proposal.proposalId;
      const existing = s.cards[id];
      if (existing && (existing.status === 'placed' || existing.status === 'approving')) return s;
      const cards: Record<string, ApprovalCardState> = {};
      for (const [k, c] of Object.entries(s.cards)) cards[k] = k !== id && SUPERSEDABLE.has(c.status) ? { ...c, status: 'superseded', message: 'Replaced by a newer quote.' } : c;
      cards[id] =
        e.previousTotalNaira !== undefined
          ? { ...(existing ?? newCard(e.proposal)), proposal: e.proposal, status: 'price_changed', previousTotalNaira: e.previousTotalNaira }
          : existing && existing.status === 'price_changed'
            ? { ...existing, proposal: e.proposal }
            : newCard(e.proposal);
      const next = { ...s, cards };
      return updateTurn(next, turnId, (t) => (t.proposalIds.includes(id) ? t : { ...t, proposalIds: [...t.proposalIds, id] }));
    }
    case 'reply':
      return updateTurn(s, turnId, (t) => ({ ...t, reply: e.text }));
    case 'error':
      return updateTurn(s, turnId, (t) => ({ ...t, error: { code: e.code, message: e.message } }));
    default:
      return s;
  }
}

// Approval steps are drawn from the card's own state (one row per card).
const CARD_TOOLS = new Set(['place_order', 'cancel_order']);

export function timelineRows(turn: Turn, cards: Record<string, ApprovalCardState>, now: number): TimelineRow[] {
  const rows: TimelineRow[] = turn.steps
    .filter((st) => !CARD_TOOLS.has(st.tool))
    .map((st) => ({ key: `step:${st.seq}`, status: st.status, label: st.label }));
  for (const id of turn.proposalIds) {
    const card = cards[id];
    if (card) rows.push(cardRow(id, card, now));
  }
  if (turn.error) rows.push({ key: 'error', status: 'failed', label: turn.error.message });
  if (turn.status === 'sending' || turn.status === 'running') rows.push({ key: 'working', status: 'working', label: turn.status === 'sending' ? 'Sending…' : 'Working…' });
  return rows;
}

function cardRow(id: string, card: ApprovalCardState, now: number): TimelineRow {
  const key = `approval:${id}`;
  const expired = (card.status === 'awaiting' || card.status === 'price_changed') && now > Date.parse(card.proposal.expiresAt);
  if (expired) return { key, status: 'failed', label: 'Quote expired' };
  switch (card.status) {
    case 'awaiting':
    case 'price_changed':
    case 'uncertain':
      return { key, status: 'awaiting', label: 'Waiting for your approval' };
    case 'approving':
      return { key, status: 'working', label: 'Placing your order…' };
    case 'cancelling':
      return { key, status: 'working', label: 'Cancelling…' };
    case 'checking':
      return { key, status: 'working', label: 'Checking your order…' };
    case 'unverified':
      return { key, status: 'failed', label: "Couldn't check your order" };
    case 'not_placed':
      return { key, status: 'info', label: 'No order was placed' };
    case 'placed':
      return { key, status: 'done', label: `Order placed: ${card.order?.reference ?? ''}`.trim() };
    case 'cancelled':
      return { key, status: 'info', label: 'Cancelled. Nothing was ordered.' };
    case 'superseded':
      return { key, status: 'info', label: 'Replaced by a newer quote' };
    case 'expired':
      return { key, status: 'failed', label: 'Quote expired' };
    case 'lost':
      return { key, status: 'failed', label: 'Quote no longer available' };
    default:
      return { key, status: 'failed', label: card.message ?? 'Order not placed' };
  }
}

// ── dish choices ──────────────────────────────────────────────────────────

const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const mentions = (hay: string, needle: string) => ` ${hay} `.includes(` ${norm(needle)} `);

/**
 * The required pick a reply is asking for, from items whose menus were read.
 * It counts as asking when the reply names the item and, outside the item's
 * own name, names the group or at least two of its options.
 */
export function inferChoicePrompt(reply: string | undefined, items: MenuChoiceEntry[]): ChoicePrompt | undefined {
  if (!reply) return undefined;
  const text = norm(reply);
  const candidates: { item: MenuChoiceEntry; group: MenuChoiceGroup; named: boolean }[] = [];
  for (const item of items) {
    const named = mentions(text, item.itemName);
    const rest = named ? ` ${text} `.split(` ${norm(item.itemName)} `).join(' ') : text;
    for (const g of item.groups) {
      if (!g.required || g.options.length === 0) continue;
      const optionHits = g.options.filter((o) => mentions(rest, o.name)).length;
      if (mentions(rest, g.group) || optionHits >= 2) candidates.push({ item, group: g, named });
    }
  }
  const pick = candidates.find((c) => c.named) ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!pick) return undefined;
  return {
    itemId: pick.item.itemId,
    itemName: pick.item.itemName,
    group: pick.group.group,
    options: pick.group.options.map((o) => ({ name: o.name, extraPriceNaira: Number(o.extra_price_naira) || 0 })),
  };
}

/** Choice buttons for the latest finished turn, when it asked and nothing is awaiting approval. */
export function latestChoicePrompt(s: ConversationState): ChoicePrompt | undefined {
  const t = s.turns.at(-1);
  if (!t || t.status !== 'finished') return undefined;
  if (t.proposalIds.some((id) => OPEN_CARD.has(s.cards[id]?.status ?? ''))) return undefined;
  return t.choicePrompt ?? inferChoicePrompt(t.reply, Object.values(s.menuItems));
}

/** The customer's pick, in plain words, sent as their next message. */
export function choiceMessage(p: ChoicePrompt, option: string): string {
  return `${p.group}: ${option} for the ${p.itemName}, please.`;
}

/** Asks for a fresh quote of a card that expired or was lost. */
export function askAgainMessage(p: ProposalView): string {
  const lines = p.lines
    .map((l) => {
      const c = choicesText(l.choices);
      return `${l.quantity} x ${l.name}${c ? ` (${c})` : ''}`;
    })
    .join(', ');
  return `That quote is no longer valid. Please prepare a fresh quote for the same order: ${lines} from ${p.restaurantName}.`;
}
