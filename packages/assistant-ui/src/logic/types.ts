// Wire types for the Behtafood agent endpoints (/api/agent/*), as the app sees
// them. Kept here rather than imported from agent-core so this package stays a
// plain copy-in folder with no workspace imports.

export interface ProposalChoice {
  group: string;
  option: string;
  priceNaira: number;
}

export interface ProposalLine {
  itemId: string;
  name: string;
  quantity: number;
  unitPriceNaira: number;
  lineTotalNaira: number;
  choices?: ProposalChoice[];
}

/** The approval card, exactly as the server quoted it. */
export interface ProposalView {
  proposalId: string;
  restaurantName: string;
  lines: ProposalLine[];
  subtotalNaira: number;
  deliveryFeeNaira: number;
  discountNaira: number;
  totalNaira: number;
  expiresAt: string;
  state: string;
}

export interface PlacedOrder {
  orderId: string;
  reference: string;
  checkoutSessionId: string;
  restaurantId: string;
  totalNaira: number;
  status: string;
  createdAt: string;
}

export type RefusalCode =
  | 'RESTAURANT_CLOSED'
  | 'ITEM_UNAVAILABLE'
  | 'INSUFFICIENT_BALANCE'
  | 'INVALID_CART'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'EXPIRED'
  | 'CANCELLED';

export type ApproveResult =
  | { status: 'placed'; order: PlacedOrder; alreadyPlaced: boolean }
  | { status: 'price_changed'; proposal: ProposalView; previousTotalNaira: number }
  | { status: 'refused'; code: RefusalCode; message: string }
  /** lookupFailed: the server could not check whether the order exists. */
  | { status: 'uncertain'; message: string; lookupFailed?: boolean };

/** POST /agent/check: a read-only lookup of the order by the proposal id. */
export type CheckResult =
  | { status: 'placed'; order: PlacedOrder }
  | { status: 'not_placed' }
  | { status: 'check_failed'; message: string };

/** One timeline event, as emitted by the agent and stored by the server. */
export type AgentEvent =
  | { type: 'run'; runId: string }
  | { type: 'session'; sessionId: string }
  | { type: 'step'; tool: string; status: 'done' | 'failed'; label: string; data?: unknown }
  | { type: 'awaiting_approval'; proposal: ProposalView; previousTotalNaira?: number }
  | { type: 'reply'; text: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'done'; modelCalls: number; costUsd: number };

export interface StoredEvent {
  seq: number;
  at: string;
  event: AgentEvent;
}

/** A menu item's choice group, as the get_menu step reports it. */
export interface MenuChoiceGroup {
  group: string;
  required: boolean;
  max: number;
  options: { name: string; extra_price_naira: number }[];
}
