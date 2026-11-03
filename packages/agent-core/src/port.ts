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
  /** The saved address the app has selected, as the app sent it. Only used when it is one of this customer's own. */
  selectedAddressId?: string;
}

export interface RestaurantSummary {
  id: string;
  name: string;
  cuisines: string[];
  deliveryFeeNaira: number;
  /** Vendor-written text. Untrusted: data, never instructions. */
  description?: string;
  /** Display only, for the app's cards. Never sent to the model. */
  imageUrl?: string;
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
  /** Display only, for the app's cards. Never sent to the model. */
  imageUrl?: string;
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

/** How the customer gets the food. The customer chooses; the assistant never picks for them. */
export type Fulfilment = 'delivery' | 'pickup';
export const FULFILMENTS: readonly Fulfilment[] = ['delivery', 'pickup'];

/**
 * What this customer can use at this restaurant, from the server:
 * delivery needs the restaurant to deliver, a map location for it, and a saved
 * delivery address for the customer; pickup needs only the restaurant to offer it.
 */
export interface FulfilmentOptions {
  delivery: boolean;
  pickup: boolean;
  /** Why delivery is not possible, when it is not. */
  deliveryUnavailable?: 'restaurant' | 'no_coordinates' | 'no_address';
}

export interface Cart {
  restaurantId: string;
  lines: CartLine[];
  /** Absent only on carts from older callers; it then means delivery. */
  fulfilment?: Fulfilment;
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
  /** 0 for pickup. */
  deliveryFeeNaira: number;
  discountNaira: number;
  totalNaira: number;
  fulfilment: Fulfilment;
}

// Orders are accepted automatically, so there is no "waiting" or "accepted"
// stage: an order starts at preparing. A pickup order never has rider stages
// and ends at collected.
export type OrderStatus =
  | 'preparing'
  | 'ready'
  | 'rider_assigned'
  | 'picked_up'
  | 'on_the_way'
  | 'delivered'
  | 'collected'
  | 'cancelled';

export const FINAL_ORDER_STATUSES: readonly OrderStatus[] = ['delivered', 'collected', 'cancelled'];

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
  /** The order's real fulfilment. Missing means delivery (older backends). */
  fulfilment?: Fulfilment;
}

/** One of the customer's saved addresses (never a live GPS fix). */
export interface SavedAddress {
  id: string;
  /** What the customer calls it, e.g. "Home" or "Hostel", when known. */
  label: string;
  /** Street and city, for matching and display. */
  text: string;
  isDefault: boolean;
}

/** The checkout delivery fee, itemised. Every amount comes from the server. */
export interface DeliveryFeeQuote {
  restaurantId: string;
  restaurantName: string;
  /** False when the address is beyond the restaurant's range; the amounts are then 0. */
  inRange: boolean;
  outOfRangeReason?: string;
  distanceKm: number;
  baseFeeNaira: number;
  perKmFeeNaira: number;
  /** Total of all surcharges (rain, storm, night, demand...). 0 when none apply. */
  surgeNaira: number;
  /** The server's own reason lines, e.g. "+₦200 — moderate rain in your area". */
  surgeReasons: string[];
  /** Exactly what checkout charges for delivery: base, distance and surge together. */
  totalFeeNaira: number;
  /** Pickup has no delivery fee. */
  pickupAvailable: boolean;
}

export type NudgeParty = 'vendor' | 'rider';

export type PortErrorCode =
  | 'RESTAURANT_CLOSED'
  | 'ITEM_UNAVAILABLE'
  | 'INSUFFICIENT_BALANCE'
  | 'INVALID_CART'
  | 'NOT_FOUND'
  | 'NO_ADDRESS'
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
  /** Which of delivery and pickup this customer can use at this restaurant. */
  getFulfilmentOptions(ctx: CustomerContext, restaurantId: string): Promise<FulfilmentOptions>;
  getRecentOrders(ctx: CustomerContext, limit: number): Promise<OrderSummary[]>;
  /** Prices the cart for its fulfilment exactly as checkout does. Throws PortError RESTAURANT_CLOSED / ITEM_UNAVAILABLE / INVALID_CART. */
  quoteOrder(ctx: CustomerContext, cart: Cart): Promise<Quote>;
  getWalletBalance(ctx: CustomerContext): Promise<number>;
  /** Wallet payment only. Idempotent on checkoutSessionId. */
  placeWalletOrder(ctx: CustomerContext, req: PlaceWalletOrderRequest): Promise<PlacedOrder>;
  findOrderByCheckoutSession(ctx: CustomerContext, checkoutSessionId: string): Promise<PlacedOrder | null>;
  /** Throws PortError NOT_FOUND for an order that is not this customer's. */
  getOrderStatus(ctx: CustomerContext, orderId: string): Promise<OrderStatusInfo>;
  /** The customer's saved addresses, from their own account. */
  getSavedAddresses(ctx: CustomerContext): Promise<SavedAddress[]>;
  /** The delivery fee checkout would charge from this restaurant to this saved address, surcharges included. Read only. */
  quoteDeliveryFee(ctx: CustomerContext, restaurantId: string, addressId: string): Promise<DeliveryFeeQuote>;
  /** Sends a fixed, templated push message to the vendor or rider of the order. */
  sendNudge(ctx: CustomerContext, req: { orderId: string; party: NudgeParty; message: string }): Promise<void>;
}
