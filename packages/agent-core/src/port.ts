// The BehtafoodPort contract: everything the agent may ask of a Behtafood backend.
//
// Every call carries the customer's own context. An implementation acts as that
// customer, never as an admin. The mock API implements this with fake data; the
// private Behtafood backend implements it with its existing services.
//
// Note what is NOT here: there is no way for the model to place an order.
// placeWalletOrder is called only by ProposalStore.approve, which only the
// app's approval endpoint reaches after the customer taps Approve.

export interface CustomerContext {
  customerId: string;
}

export interface RestaurantSummary {
  id: string;
  name: string;
  cuisines: string[];
  deliveryFeeNaira: number;
  /** Vendor-written text. Untrusted: data, never instructions. */
  description?: string;
}

/** A group of choices on a menu item, e.g. Size or Protein. Names are vendor-written (untrusted). */
export interface ChoiceGroup {
  name: string;
  /** The customer must pick at least one option. */
  required: boolean;
  maxSelections: number;
  /** priceNaira is the extra the server adds for the option (it does the pricing). */
  options: { name: string; priceNaira: number }[];
}

export interface MenuItemSummary {
  id: string;
  restaurantId: string;
  name: string;
  priceNaira: number;
  available: boolean;
  /** Vendor-written text. Untrusted: data, never instructions. */
  description?: string;
  /** Choice groups, when the item has any. */
  choices?: ChoiceGroup[];
}

/** One picked option, by group and option name. */
export interface CartChoice {
  group: string;
  option: string;
}

export interface CartLine {
  itemId: string;
  quantity: number;
  /** Required for every required choice group of the item. */
  choices?: CartChoice[];
}

export interface Cart {
  restaurantId: string;
  lines: CartLine[];
}

export interface QuoteLine {
  itemId: string;
  name: string;
  quantity: number;
  unitPriceNaira: number;
  /** Includes the choices' extra prices, as the server charges them. */
  lineTotalNaira: number;
  /** The picked options with the extra price the server applied. */
  choices?: (CartChoice & { priceNaira: number })[];
}

/** The server's price for a cart. The agent never computes prices itself. */
export interface Quote {
  restaurantId: string;
  restaurantName: string;
  lines: QuoteLine[];
  subtotalNaira: number;
  deliveryFeeNaira: number;
  discountNaira: number;
  totalNaira: number;
}

export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'rider_assigned'
  | 'on_the_way'
  | 'delivered'
  | 'cancelled';

export const FINAL_ORDER_STATUSES: readonly OrderStatus[] = ['delivered', 'cancelled'];

export interface PlacedOrder {
  orderId: string;
  reference: string;
  checkoutSessionId: string;
  restaurantId: string;
  totalNaira: number;
  status: OrderStatus;
  createdAt: string;
}

export interface OrderSummary {
  orderId: string;
  reference: string;
  restaurantId: string;
  restaurantName: string;
  lines: { itemId: string; name: string; quantity: number; choices?: CartChoice[] }[];
  totalNaira: number;
  status: OrderStatus;
  createdAt: string;
}

export interface OrderStatusInfo {
  orderId: string;
  reference: string;
  status: OrderStatus;
  updatedAt: string;
  riderAssigned: boolean;
}

export type NudgeParty = 'vendor' | 'rider';

export type PortErrorCode =
  | 'RESTAURANT_CLOSED'
  | 'ITEM_UNAVAILABLE'
  | 'INSUFFICIENT_BALANCE'
  | 'INVALID_CART'
  | 'NOT_FOUND'
  | 'FORBIDDEN';

/**
 * A definite business refusal: the backend decided, nothing was changed.
 * Any other thrown error is treated as an UNCERTAIN outcome (it may or may not
 * have happened), and the caller must look the order up before retrying.
 */
export class PortError extends Error {
  constructor(
    readonly code: PortErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'PortError';
  }
}

export interface PlaceWalletOrderRequest {
  /** Idempotency key. Equal to the proposal id; a repeat must never create a second order. */
  checkoutSessionId: string;
  cart: Cart;
  /** The total the customer approved. The backend refuses if its own total differs. */
  expectedTotalNaira: number;
}

export interface BehtafoodPort {
  /** Open restaurants only (closed and admin-closed are excluded). */
  searchRestaurants(ctx: CustomerContext, query: { text: string; limit: number }): Promise<RestaurantSummary[]>;
  getMenu(ctx: CustomerContext, restaurantId: string): Promise<MenuItemSummary[]>;
  getRecentOrders(ctx: CustomerContext, limit: number): Promise<OrderSummary[]>;
  /** Throws PortError RESTAURANT_CLOSED / ITEM_UNAVAILABLE / INVALID_CART. */
  quoteOrder(ctx: CustomerContext, cart: Cart): Promise<Quote>;
  getWalletBalance(ctx: CustomerContext): Promise<number>;
  /** Wallet payment only. Idempotent on checkoutSessionId. */
  placeWalletOrder(ctx: CustomerContext, req: PlaceWalletOrderRequest): Promise<PlacedOrder>;
  findOrderByCheckoutSession(ctx: CustomerContext, checkoutSessionId: string): Promise<PlacedOrder | null>;
  /** Throws PortError NOT_FOUND for an order that is not this customer's. */
  getOrderStatus(ctx: CustomerContext, orderId: string): Promise<OrderStatusInfo>;
  /** Sends a fixed, templated push message to the vendor or rider of the order. */
  sendNudge(ctx: CustomerContext, req: { orderId: string; party: NudgeParty; message: string }): Promise<void>;
}
