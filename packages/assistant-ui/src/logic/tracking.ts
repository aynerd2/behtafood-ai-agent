// Order tracking after the order is placed. No model is involved: the app
// polls the backend's status endpoint, and every step shown is a stage the
// backend reported. A delay is the backend's fixed message (fixed rules, see
// agent-core delays.ts) with buttons to send a polite reminder. Reminder
// results are shown exactly as the server worded them ("sent" or "couldn't
// send"); nothing here ever claims a reminder was delivered or read.

import { AgentApiError } from './client';
import type { TimelineRow } from './conversation';

// Orders are accepted automatically, so tracking starts at preparing. A pickup
// order has no rider stages and ends at collected.
export type TrackStage = 'preparing' | 'ready' | 'rider_assigned' | 'picked_up' | 'on_the_way' | 'delivered' | 'collected' | 'cancelled';
export type TrackFulfilment = 'delivery' | 'pickup';
export type ReminderParty = 'vendor' | 'rider';

export interface TrackingDelay {
  kind: 'long_preparing' | 'no_rider' | 'not_collected' | 'long_delivery';
  parties: ReminderParty[];
  elapsedMs: number;
  message: string;
}

/** GET /agent/orders/:id/status */
export interface TrackingSnapshot {
  orderId: string;
  reference: string;
  status: TrackStage;
  riderAssigned: boolean;
  /** Missing on older servers: treated as delivery. */
  fulfilment?: TrackFulfilment;
  updatedAt: string;
  stageSince: string;
  delay: TrackingDelay | null;
  /** The customer's model calls so far (to show tracking adds none). */
  modelCalls: number;
}

/** POST /agent/nudge */
export interface ReminderResult {
  sent: boolean;
  code?: string;
  text: string;
}

export interface TrackingState {
  orderId: string;
  reference: string;
  steps: { stage: TrackStage; label: string; at: number }[];
  lastStage?: TrackStage;
  riderAssigned: boolean;
  fulfilment: TrackFulfilment;
  finished: boolean;
  delays: { kind: TrackingDelay['kind']; stage: TrackStage; message: string; parties: ReminderParty[] }[];
  reminders: { party: ReminderParty; sent: boolean; text: string; at: number }[];
  sending?: ReminderParty;
  modelCallsAtStart?: number;
  modelCallsNow?: number;
  error?: string;
}

export const STAGE_LABEL: Record<TrackStage, string> = {
  preparing: 'The restaurant is preparing your order',
  ready: 'Your food is ready',
  rider_assigned: 'A rider has been assigned',
  picked_up: 'The rider picked up your food',
  on_the_way: 'Your order is on the way',
  delivered: 'Delivered. Enjoy your meal!',
  collected: 'You collected your order. Enjoy your meal!',
  cancelled: 'The order was cancelled',
};

/** The stages a pickup order can show; anything else is never a pickup step. */
const PICKUP_STAGES = new Set<TrackStage>(['preparing', 'ready', 'collected', 'cancelled']);

/** A stage's label for this order's fulfilment, or undefined when it cannot apply. */
export function stageLabel(stage: TrackStage, fulfilment: TrackFulfilment): string | undefined {
  if (fulfilment === 'pickup') {
    if (!PICKUP_STAGES.has(stage)) return undefined;
    if (stage === 'ready') return 'Your food is ready for pickup';
  } else if (stage === 'collected') {
    return undefined;
  }
  return STAGE_LABEL[stage];
}

const FINAL = new Set<TrackStage>(['delivered', 'collected', 'cancelled']);

export function newTracking(orderId: string, reference: string, fulfilment: TrackFulfilment = 'delivery'): TrackingState {
  return { orderId, reference, steps: [], riderAssigned: false, fulfilment, finished: false, delays: [], reminders: [] };
}

export function applySnapshot(t: TrackingState, s: TrackingSnapshot, now: number): TrackingState {
  const fulfilment = s.fulfilment ?? t.fulfilment;
  let next: TrackingState = {
    ...t,
    reference: s.reference || t.reference,
    fulfilment,
    riderAssigned: fulfilment === 'delivery' && s.riderAssigned,
    modelCallsAtStart: t.modelCallsAtStart ?? s.modelCalls,
    modelCallsNow: s.modelCalls,
    error: undefined,
  };
  const label = stageLabel(s.status, fulfilment);
  if (!label) return next; // a stage this kind of order cannot have is never shown
  if (s.status !== t.lastStage) {
    next = { ...next, lastStage: s.status, steps: [...next.steps, { stage: s.status, label, at: now }] };
  }
  if (FINAL.has(s.status)) next = { ...next, finished: true };
  // A pickup order is only ever reminded through the restaurant.
  const parties = s.delay ? s.delay.parties.filter((p) => p === 'vendor' || fulfilment === 'delivery') : [];
  if (s.delay && parties.length > 0 && !next.delays.some((d) => d.kind === s.delay!.kind && d.stage === s.status)) {
    next = { ...next, delays: [...next.delays, { kind: s.delay.kind, stage: s.status, message: s.delay.message, parties }] };
  }
  return next;
}

/** The delay the customer can still act on: current stage, order active, no reminder sent since. */
export function openDelay(t: TrackingState): TrackingState['delays'][number] | undefined {
  const d = t.delays.at(-1);
  if (!d || t.finished || d.stage !== t.lastStage) return undefined;
  if (t.reminders.some((r) => r.sent && d.parties.includes(r.party))) return undefined;
  return d;
}

export function reminderStarted(t: TrackingState, party: ReminderParty): TrackingState {
  return { ...t, sending: party };
}

export function reminderResolved(t: TrackingState, party: ReminderParty, r: ReminderResult, now: number): TrackingState {
  return { ...t, sending: undefined, reminders: [...t.reminders, { party, sent: r.sent, text: r.text, at: now }] };
}

export function reminderFailed(t: TrackingState, party: ReminderParty, err: unknown, now: number): TrackingState {
  const text =
    err instanceof AgentApiError && err.kind === 'rate_limited'
      ? err.message
      : "We couldn't confirm the reminder was sent. Check your connection and try again.";
  return { ...t, sending: undefined, reminders: [...t.reminders, { party, sent: false, text, at: now }] };
}

export function aiCallsSinceOrder(t: TrackingState): number {
  return Math.max(0, (t.modelCallsNow ?? 0) - (t.modelCallsAtStart ?? 0));
}

export function latestTrackingLabel(t: TrackingState): string {
  const last = t.steps.at(-1);
  return `Order ${t.reference}: ${last ? last.label : 'checking status…'}`;
}

/** Tracking rows for the timeline, in the order things happened. */
export function trackingRows(t: TrackingState): TimelineRow[] {
  type Row = TimelineRow & { at: number; order: number };
  const rows: Row[] = [];
  t.steps.forEach((s, i) => rows.push({ key: `stage:${i}:${s.stage}`, status: s.stage === 'cancelled' ? 'failed' : 'done', label: s.label, at: s.at, order: 0 }));
  const open = openDelay(t);
  t.delays.forEach((d, i) => {
    const step = t.steps.findLast((s) => s.stage === d.stage);
    // Waiting on the customer only while its buttons are still offered.
    rows.push({ key: `delay:${i}`, status: d === open ? 'awaiting' : 'info', label: d.message, at: step?.at ?? 0, order: 1 });
  });
  t.reminders.forEach((r, i) => rows.push({ key: `reminder:${i}`, status: r.sent ? 'done' : 'info', label: r.text, at: r.at, order: 2 }));
  rows.sort((a, b) => a.at - b.at || a.order - b.order);
  const out: TimelineRow[] = rows.map(({ key, status, label }) => ({ key, status, label }));
  if (t.error) out.push({ key: 'tracking-error', status: 'failed', label: t.error });
  if (!t.finished && !t.error) {
    out.push({ key: 'tracking', status: 'working', label: t.fulfilment === 'pickup' ? 'Watching for updates from the restaurant…' : 'Watching for updates from the restaurant and rider…' });
  }
  out.push({ key: 'ai-calls', status: 'info', label: `AI calls since your order: ${aiCallsSinceOrder(t)}` });
  return out;
}
