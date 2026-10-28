// Delay detection for a placed order: fixed rules and fixed messages, no model.
//
//   accepted but not preparing   > acceptedMs       -> remind the restaurant
//   ready but no rider           > readyNoRiderMs   -> remind the restaurant
//   on the way                   > onTheWayMs       -> remind the rider
//
// Messages state how long a stage has lasted, measured from the backend's own
// timestamps. They never promise or estimate a delivery time.

import type { NudgeParty, OrderStatus, OrderStatusInfo } from './port';

export interface DelayThresholds {
  acceptedMs: number;
  readyNoRiderMs: number;
  onTheWayMs: number;
}

const MIN = 60_000;

export const DEFAULT_DELAY_THRESHOLDS: DelayThresholds = { acceptedMs: 10 * MIN, readyNoRiderMs: 10 * MIN, onTheWayMs: 40 * MIN };

type Env = Record<string, string | undefined>;

function minutes(raw: string | undefined, fallbackMs: number): number {
  const n = Number(raw);
  return raw !== undefined && raw.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * MIN) : fallbackMs;
}

/**
 * AGENT_DELAY_ACCEPTED_MINUTES, AGENT_DELAY_READY_NO_RIDER_MINUTES and
 * AGENT_DELAY_ON_THE_WAY_MINUTES (decimals allowed). AGENT_DELAY_DEMO_SECONDS
 * sets all three to a few seconds for a live demo; it is ignored in production.
 */
export function delayThresholdsFromEnv(env: Env): DelayThresholds {
  const demo = Number(env.AGENT_DELAY_DEMO_SECONDS);
  if (env.NODE_ENV !== 'production' && Number.isFinite(demo) && demo > 0) {
    const ms = Math.round(demo * 1000);
    return { acceptedMs: ms, readyNoRiderMs: ms, onTheWayMs: ms };
  }
  return {
    acceptedMs: minutes(env.AGENT_DELAY_ACCEPTED_MINUTES, DEFAULT_DELAY_THRESHOLDS.acceptedMs),
    readyNoRiderMs: minutes(env.AGENT_DELAY_READY_NO_RIDER_MINUTES, DEFAULT_DELAY_THRESHOLDS.readyNoRiderMs),
    onTheWayMs: minutes(env.AGENT_DELAY_ON_THE_WAY_MINUTES, DEFAULT_DELAY_THRESHOLDS.onTheWayMs),
  };
}

export type DelayKind = 'not_preparing' | 'no_rider' | 'long_delivery';

export interface Delay {
  kind: DelayKind;
  /** Who a reminder may go to. */
  parties: NudgeParty[];
  /** How long the stage has lasted, in ms. */
  elapsedMs: number;
  message: string;
}

function duration(ms: number): string {
  if (ms < MIN) {
    const s = Math.floor(ms / 1000);
    return `${s} second${s === 1 ? '' : 's'}`;
  }
  const m = Math.floor(ms / MIN);
  return `${m} minute${m === 1 ? '' : 's'}`;
}

const ASK = ' Would you like to send a polite reminder?';

export function detectDelay(
  order: { status: OrderStatus; riderAssigned: boolean },
  sinceMs: number,
  now: number,
  t: DelayThresholds,
): Delay | null {
  const elapsedMs = Math.max(0, now - sinceMs);
  const d = duration(elapsedMs);
  if (order.status === 'accepted' && elapsedMs > t.acceptedMs) {
    return { kind: 'not_preparing', parties: ['vendor'], elapsedMs, message: `Your order was accepted ${d} ago and hasn't started preparing yet.${ASK}` };
  }
  if (order.status === 'ready' && !order.riderAssigned && elapsedMs > t.readyNoRiderMs) {
    return { kind: 'no_rider', parties: ['vendor'], elapsedMs, message: `Your food has been ready for ${d} and no rider has been assigned yet.${ASK}` };
  }
  if (order.status === 'on_the_way' && elapsedMs > t.onTheWayMs) {
    return { kind: 'long_delivery', parties: ['rider'], elapsedMs, message: `Your rider has been on the way for ${d}.${ASK}` };
  }
  return null;
}

/** What the tracking endpoint returns: the backend's status plus any delay. */
export interface OrderTrackingSnapshot extends OrderStatusInfo {
  /** When the current stage began, as observed by the server. */
  stageSince: string;
  delay: Delay | null;
}

export function trackingSnapshot(info: OrderStatusInfo, clock: StageClock, thresholds: DelayThresholds, now: number): OrderTrackingSnapshot {
  const updated = Date.parse(info.updatedAt);
  const since = clock.observe(info.orderId, info.status, Number.isFinite(updated) ? updated : now, now);
  return { ...info, stageSince: new Date(since).toISOString(), delay: detectDelay(info, since, now, thresholds) };
}

/**
 * When did the order's current stage begin? The first sighting uses the
 * order's last update time; a stage change starts at its update time; an
 * unrelated save (same stage) does not restart the clock. Never in the future.
 */
export class StageClock {
  readonly #seen = new Map<string, { stage: string; since: number }>();

  observe(orderId: string, stage: string, updatedAtMs: number, now: number): number {
    const prev = this.#seen.get(orderId);
    if (prev && prev.stage === stage) return prev.since;
    const since = Math.min(updatedAtMs, now);
    this.#seen.set(orderId, { stage, since });
    return since;
  }
}
