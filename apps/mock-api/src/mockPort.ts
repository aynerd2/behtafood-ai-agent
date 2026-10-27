// In-memory BehtafoodPort over the fake data. Behaves like the real backend on
// the points the safety rules depend on: open/admin-closed checks, server-side
// pricing, wallet balance, and idempotency on checkoutSessionId.

import {
  PortError,
  type BehtafoodPort,
  type Cart,
  type CustomerContext,
  type MenuItemSummary,
  type NudgeParty,
  type OrderStatus,
  type OrderStatusInfo,
  type OrderSummary,
  type PlacedOrder,
  type PlaceWalletOrderRequest,
  type Quote,
  type RestaurantSummary,
} from '@behtafood-agent/agent-core';
import { seedCustomers, seedMenu, seedRestaurants, type MockCustomer, type MockMenuItem, type MockRestaurant } from './data';

interface MockOrder extends PlacedOrder {
  customerId: string;
  lines: { itemId: string; name: string; quantity: number }[];
  updatedAt: string;
  riderAssigned: boolean;
}

export interface SentNudge {
  orderId: string;
  party: NudgeParty;
  message: string;
  at: string;
}

/**
 * Failure injection for tests:
 * - 'lost_response': the order IS created, then the call throws (network drop after commit).
 * - 'before_commit': the call throws before anything is created.
 */
export type PlaceOrderFault = 'lost_response' | 'before_commit';

export class MockBehtafoodPort implements BehtafoodPort {
  restaurants: MockRestaurant[] = seedRestaurants();
  menu: MockMenuItem[] = seedMenu();
  customers: MockCustomer[] = seedCustomers();
  orders: MockOrder[] = [];
  nudges: SentNudge[] = [];
  /** Counts real order creations, for the no-duplicate tests. */
  placeOrderCalls = 0;
  nextPlaceOrderFault: PlaceOrderFault | null = null;
  #seq = 0;

  constructor(readonly clock: () => number = Date.now) {}

  // ---- helpers for tests, the CLI and the demo "vendor/rider" controls ----

  customerByToken(token: string): MockCustomer | undefined {
    return this.customers.find((c) => c.token === token);
  }

  wallet(customerId: string): number {
    return this.#customer(customerId).walletNaira;
  }

  setPrice(itemId: string, priceNaira: number): void {
    this.#item(itemId).priceNaira = priceNaira;
  }

  setAvailable(itemId: string, available: boolean): void {
    this.#item(itemId).available = available;
  }

  setRestaurant(id: string, patch: Partial<Pick<MockRestaurant, 'isOpen' | 'adminForceClosed'>>): void {
    Object.assign(this.#restaurant(id), patch);
  }

  advanceOrder(orderId: string, status: OrderStatus): void {
    const o = this.orders.find((x) => x.orderId === orderId);
    if (!o) throw new Error(`no order ${orderId}`);
    o.status = status;
    o.updatedAt = this.#now();
    if (status === 'rider_assigned' || status === 'on_the_way' || status === 'delivered') o.riderAssigned = true;
  }

  // ---- BehtafoodPort ----

  async searchRestaurants(_ctx: CustomerContext, query: { text: string; limit: number }): Promise<RestaurantSummary[]> {
    const words = query.text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
    const score = (r: MockRestaurant) => {
      const hay = [r.name, ...r.cuisines, ...this.menu.filter((m) => m.restaurantId === r.id).map((m) => m.name)]
        .join(' ')
        .toLowerCase();
      return words.filter((w) => hay.includes(w)).length;
    };
    return this.restaurants
      .filter((r) => this.#isOpen(r))
      .map((r) => ({ r, s: score(r) }))
      .filter(({ s }) => words.length === 0 || s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, query.limit)
      .map(({ r }) => ({ id: r.id, name: r.name, cuisines: r.cuisines, deliveryFeeNaira: r.deliveryFeeNaira, description: r.description }));
  }

  async getMenu(_ctx: CustomerContext, restaurantId: string): Promise<MenuItemSummary[]> {
    const r = this.restaurants.find((x) => x.id === restaurantId);
    if (!r) throw new PortError('NOT_FOUND', 'Restaurant not found');
    return this.menu
      .filter((m) => m.restaurantId === restaurantId)
      .map((m) => ({ id: m.id, restaurantId: m.restaurantId, name: m.name, priceNaira: m.priceNaira, available: m.available, description: m.description }));
  }

  async getRecentOrders(ctx: CustomerContext, limit: number): Promise<OrderSummary[]> {
    return this.orders
      .filter((o) => o.customerId === ctx.customerId)
      .slice(-limit)
      .reverse()
      .map((o) => ({
        orderId: o.orderId,
        reference: o.reference,
        restaurantId: o.restaurantId,
        restaurantName: this.#restaurant(o.restaurantId).name,
        lines: o.lines,
        totalNaira: o.totalNaira,
        status: o.status,
        createdAt: o.createdAt,
      }));
  }

  async quoteOrder(_ctx: CustomerContext, cart: Cart): Promise<Quote> {
    const r = this.restaurants.find((x) => x.id === cart.restaurantId);
    if (!r) throw new PortError('NOT_FOUND', 'Restaurant not found');
    if (!this.#isOpen(r)) throw new PortError('RESTAURANT_CLOSED', `${r.name} is closed right now`);
    if (cart.lines.length === 0) throw new PortError('INVALID_CART', 'The cart is empty');
    const lines = cart.lines.map((l) => {
      const m = this.menu.find((x) => x.id === l.itemId && x.restaurantId === r.id);
      if (!m) throw new PortError('INVALID_CART', `Item ${l.itemId} is not on this menu`);
      if (!m.available) throw new PortError('ITEM_UNAVAILABLE', `${m.name} is not available right now`);
      if (!Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 20) throw new PortError('INVALID_CART', 'Invalid quantity');
      return { itemId: m.id, name: m.name, quantity: l.quantity, unitPriceNaira: m.priceNaira, lineTotalNaira: m.priceNaira * l.quantity };
    });
    const subtotal = lines.reduce((s, l) => s + l.lineTotalNaira, 0);
    return {
      restaurantId: r.id,
      restaurantName: r.name,
      lines,
      subtotalNaira: subtotal,
      deliveryFeeNaira: r.deliveryFeeNaira,
      discountNaira: 0,
      totalNaira: subtotal + r.deliveryFeeNaira,
    };
  }

  async getWalletBalance(ctx: CustomerContext): Promise<number> {
    return this.#customer(ctx.customerId).walletNaira;
  }

  async placeWalletOrder(ctx: CustomerContext, req: PlaceWalletOrderRequest): Promise<PlacedOrder> {
    const existing = this.orders.find((o) => o.customerId === ctx.customerId && o.checkoutSessionId === req.checkoutSessionId);
    if (existing) return this.#placed(existing);
    if (this.nextPlaceOrderFault === 'before_commit') {
      this.nextPlaceOrderFault = null;
      throw new Error('socket hang up');
    }
    const quote = await this.quoteOrder(ctx, req.cart); // re-validates open, availability, price
    if (quote.totalNaira !== req.expectedTotalNaira) throw new PortError('INVALID_CART', 'The total changed; re-quote required');
    const customer = this.#customer(ctx.customerId);
    if (customer.walletNaira < quote.totalNaira) throw new PortError('INSUFFICIENT_BALANCE', 'Your wallet balance is too low for this order');
    customer.walletNaira -= quote.totalNaira;
    this.placeOrderCalls += 1;
    this.#seq += 1;
    const now = this.#now();
    const order: MockOrder = {
      orderId: `ord_${this.#seq}`,
      reference: `BF-${String(1000 + this.#seq)}`,
      checkoutSessionId: req.checkoutSessionId,
      customerId: ctx.customerId,
      restaurantId: quote.restaurantId,
      totalNaira: quote.totalNaira,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      riderAssigned: false,
      lines: quote.lines.map((l) => ({ itemId: l.itemId, name: l.name, quantity: l.quantity })),
    };
    this.orders.push(order);
    if (this.nextPlaceOrderFault === 'lost_response') {
      this.nextPlaceOrderFault = null;
      throw new Error('ECONNRESET after commit');
    }
    return this.#placed(order);
  }

  async findOrderByCheckoutSession(ctx: CustomerContext, checkoutSessionId: string): Promise<PlacedOrder | null> {
    const o = this.orders.find((x) => x.customerId === ctx.customerId && x.checkoutSessionId === checkoutSessionId);
    return o ? this.#placed(o) : null;
  }

  async getOrderStatus(ctx: CustomerContext, orderId: string): Promise<OrderStatusInfo> {
    const o = this.orders.find((x) => x.orderId === orderId && x.customerId === ctx.customerId);
    if (!o) throw new PortError('NOT_FOUND', 'Order not found');
    return { orderId: o.orderId, reference: o.reference, status: o.status, updatedAt: o.updatedAt, riderAssigned: o.riderAssigned };
  }

  async sendNudge(ctx: CustomerContext, req: { orderId: string; party: NudgeParty; message: string }): Promise<void> {
    await this.getOrderStatus(ctx, req.orderId); // ownership check
    this.nudges.push({ ...req, at: this.#now() });
  }

  // ---- internals ----

  #isOpen(r: MockRestaurant): boolean {
    return r.isOpen && !r.adminForceClosed;
  }

  #placed(o: MockOrder): PlacedOrder {
    return {
      orderId: o.orderId,
      reference: o.reference,
      checkoutSessionId: o.checkoutSessionId,
      restaurantId: o.restaurantId,
      totalNaira: o.totalNaira,
      status: o.status,
      createdAt: o.createdAt,
    };
  }

  #now(): string {
    return new Date(this.clock()).toISOString();
  }

  #customer(id: string): MockCustomer {
    const c = this.customers.find((x) => x.id === id);
    if (!c) throw new PortError('FORBIDDEN', 'Unknown customer');
    return c;
  }

  #restaurant(id: string): MockRestaurant {
    const r = this.restaurants.find((x) => x.id === id);
    if (!r) throw new PortError('NOT_FOUND', 'Restaurant not found');
    return r;
  }

  #item(id: string): MockMenuItem {
    const m = this.menu.find((x) => x.id === id);
    if (!m) throw new Error(`no item ${id}`);
    return m;
  }
}
