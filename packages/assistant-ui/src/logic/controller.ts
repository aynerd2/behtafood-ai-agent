// The assistant controller: sends a message, polls the run's events every
// second until it finishes, and drives the approval cards. Plain TypeScript
// with injected time, so it is tested without React or a phone.

import {
  approveFailed,
  approveResolved,
  approveStarted,
  cancelFailed,
  cancelResolved,
  cancelStarted,
  cardActions,
  checkFailed,
  checkResolved,
  checkStarted,
  type ApprovalCardState,
} from './approval';
import { AgentApiError, type AgentClient } from './client';
import {
  applyRunEvents,
  askAgainMessage,
  choiceMessage,
  initialState,
  latestChoicePrompt,
  startTurn,
  turnAccepted,
  turnFailed,
  type ConversationState,
} from './conversation';
import { isAssistantLanguage, type AssistantLanguage } from './language';
import { PHOTO_REFUSAL, checkPhoto } from './photo';
import type { PlacedOrder, StoredEvent } from './types';
import {
  applySnapshot,
  newTracking,
  reminderFailed,
  reminderResolved,
  reminderStarted,
  type ReminderParty,
  type TrackingState,
} from './tracking';
import { PHOTO_ONLY_TEXT } from './limits';

/**
 * What happened, for guided mode: each new server event exactly once, each
 * new message, and each order the server confirmed as placed.
 */
export type AssistantActivity =
  | { type: 'turn_started'; turnId: string }
  | { type: 'event'; turnId: string; event: StoredEvent }
  | { type: 'placed'; proposalId: string; order: PlacedOrder };

export interface AssistantState extends ConversationState {
  /** A message is being answered; sending is disabled. */
  busy: boolean;
  /** Placed orders being tracked, by order id. No model calls. */
  tracking: Record<string, TrackingState>;
  /** The reply language sent with every message. */
  language: AssistantLanguage;
}

export interface ControllerOptions {
  client: AgentClient;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  pollIntervalMs?: number;
  /** Give up on a run that has not finished after this long. */
  maxPollMs?: number;
  /** Consecutive failed polls before the turn is shown as failed. */
  maxPollErrors?: number;
  /** How often a placed order's status is checked (default 5 s). */
  trackIntervalMs?: number;
  /** Stop tracking after this long (default 3 hours). */
  maxTrackMs?: number;
  /** The remembered reply language (Auto when not given). */
  language?: AssistantLanguage;
}

const LOST_CONNECTION = 'Lost connection to the assistant. Check your internet and try again.';
const TOO_SLOW = 'The assistant is taking too long. Please try again.';

export class AssistantController {
  #state: AssistantState;
  readonly #listeners = new Set<() => void>();
  readonly #client: AgentClient;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  readonly #interval: number;
  readonly #maxPollMs: number;
  readonly #maxPollErrors: number;
  #turnSeq = 0;
  #disposed = false;
  readonly #trackInterval: number;
  readonly #maxTrackMs: number;
  readonly #trackers = new Map<string, Promise<void>>();
  readonly #activity = new Set<(a: AssistantActivity) => void>();

  constructor(opts: ControllerOptions) {
    this.#client = opts.client;
    this.#state = { ...initialState(), busy: false, tracking: {}, language: isAssistantLanguage(opts.language) ? opts.language : 'auto' };
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#now = opts.now ?? Date.now;
    this.#interval = opts.pollIntervalMs ?? 1000;
    this.#maxPollMs = opts.maxPollMs ?? 3 * 60_000;
    this.#maxPollErrors = opts.maxPollErrors ?? 5;
    this.#trackInterval = opts.trackIntervalMs ?? 5000;
    this.#maxTrackMs = opts.maxTrackMs ?? 3 * 60 * 60_000;
  }

  getState = (): AssistantState => this.#state;

  onActivity(fn: (a: AssistantActivity) => void): () => void {
    this.#activity.add(fn);
    return () => this.#activity.delete(fn);
  }

  #emit(a: AssistantActivity): void {
    for (const fn of this.#activity) {
      try {
        fn(a);
      } catch {
        // A listener (guided mode) must never break the conversation.
      }
    }
  }

  subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  };

  /** Stops polling (the panel was unmounted). */
  dispose(): void {
    this.#disposed = true;
    this.#listeners.clear();
  }

  #set(next: Partial<AssistantState> | ((s: AssistantState) => AssistantState)): void {
    this.#state = typeof next === 'function' ? next(this.#state) : { ...this.#state, ...next };
    for (const fn of this.#listeners) fn();
  }

  #conv(fn: (s: ConversationState) => ConversationState): void {
    this.#set((s) => ({ ...fn(s), busy: s.busy, tracking: s.tracking, language: s.language }));
  }

  #setTracking(orderId: string, fn: (t: TrackingState) => TrackingState): void {
    this.#set((s) => {
      const t = s.tracking[orderId];
      return t ? { ...s, tracking: { ...s.tracking, [orderId]: fn(t) } } : s;
    });
  }

  /** Starts following a placed order (once per order). */
  #track(order: PlacedOrder): void {
    if (this.#trackers.has(order.orderId)) return;
    this.#set((s) => ({ ...s, tracking: { ...s.tracking, [order.orderId]: newTracking(order.orderId, order.reference) } }));
    this.#trackers.set(order.orderId, this.#trackLoop(order.orderId));
  }

  async #trackLoop(orderId: string): Promise<void> {
    const started = this.#now();
    let errors = 0;
    for (;;) {
      if (this.#disposed) return;
      try {
        const snap = await this.#client.orderStatus(orderId);
        errors = 0;
        this.#setTracking(orderId, (t) => applySnapshot(t, snap, this.#now()));
        if (this.#state.tracking[orderId]?.finished) return;
      } catch (err) {
        errors += 1;
        const fatal = err instanceof AgentApiError && (err.kind === 'signed_out' || err.kind === 'unavailable');
        if (fatal || errors > 20) {
          this.#setTracking(orderId, (t) => ({ ...t, error: fatal ? (err as AgentApiError).message : 'Lost connection to order updates. Open the order from My Orders.' }));
          return;
        }
      }
      if (this.#now() - started >= this.#maxTrackMs) return;
      await this.#sleep(this.#trackInterval);
    }
  }

  /** Resolves when tracking of this order stops (for tests and cleanup). */
  trackingDone(orderId: string): Promise<void> {
    return this.#trackers.get(orderId) ?? Promise.resolve();
  }

  /** A reminder button: a fixed, polite message to the restaurant or rider. */
  async remind(orderId: string, party: ReminderParty): Promise<void> {
    const t = this.#state.tracking[orderId];
    if (!t || t.sending || t.finished) return;
    this.#setTracking(orderId, (x) => reminderStarted(x, party));
    try {
      const r = await this.#client.nudge(orderId, party);
      this.#setTracking(orderId, (x) => reminderResolved(x, party, r, this.#now()));
    } catch (err) {
      this.#setTracking(orderId, (x) => reminderFailed(x, party, err, this.#now()));
    }
  }

  #setCard(id: string, fn: (c: ApprovalCardState) => ApprovalCardState): void {
    this.#set((s) => {
      const c = s.cards[id];
      return c ? { ...s, cards: { ...s.cards, [id]: fn(c) } } : s;
    });
  }

  /** The reply language for the next messages (unknown codes are ignored). */
  setLanguage(language: AssistantLanguage): void {
    if (isAssistantLanguage(language)) this.#set({ language });
  }

  /** One message, optionally with one photo that the app has already resized. */
  async send(text: string, photo?: string): Promise<void> {
    const clean = text.trim();
    if ((!clean && !photo) || this.#state.busy) return;
    const turnId = `turn_${++this.#turnSeq}`;
    this.#set((s) => ({ ...startTurn(s, turnId, clean || PHOTO_ONLY_TEXT, photo), busy: true, tracking: s.tracking, language: s.language }));
    this.#emit({ type: 'turn_started', turnId });
    try {
      let runId: string;
      try {
        if (photo && !checkPhoto(photo)) {
          this.#conv((s) => turnFailed(s, turnId, PHOTO_REFUSAL));
          return;
        }
        const r = await this.#client.chat(clean, this.#state.sessionId, photo, this.#state.language);
        runId = r.runId;
        this.#conv((s) => turnAccepted(s, turnId, r));
      } catch (err) {
        this.#conv((s) => turnFailed(s, turnId, err instanceof AgentApiError ? err.message : LOST_CONNECTION));
        return;
      }
      await this.#poll(turnId, runId);
    } finally {
      this.#set({ busy: false });
    }
  }

  async #poll(turnId: string, runId: string): Promise<void> {
    const started = this.#now();
    let errors = 0;
    for (;;) {
      await this.#sleep(this.#interval);
      if (this.#disposed) return;
      const after = this.#state.turns.find((t) => t.id === turnId)?.lastSeq ?? 0;
      try {
        const r = await this.#client.events(runId, after);
        errors = 0;
        const fresh = (r.events ?? []).filter((e) => e.seq > after).sort((a, b) => a.seq - b.seq);
        this.#conv((s) => applyRunEvents(s, turnId, r.events ?? [], r.finished));
        for (const event of fresh) this.#emit({ type: 'event', turnId, event });
        if (r.finished) return;
      } catch (err) {
        errors += 1;
        const fatal = err instanceof AgentApiError && (err.kind === 'signed_out' || err.kind === 'unavailable');
        if (fatal || errors > this.#maxPollErrors) {
          this.#conv((s) => turnFailed(s, turnId, fatal ? (err as AgentApiError).message : LOST_CONNECTION));
          return;
        }
      }
      if (this.#now() - started >= this.#maxPollMs) {
        this.#conv((s) => turnFailed(s, turnId, TOO_SLOW));
        return;
      }
    }
  }

  async approve(proposalId: string): Promise<void> {
    const card = this.#state.cards[proposalId];
    if (!card || !cardActions(card, this.#now()).approve) return;
    this.#setCard(proposalId, approveStarted);
    try {
      const result = await this.#client.approve(proposalId);
      this.#setCard(proposalId, (c) => approveResolved(c, result));
      if (result.status === 'placed') {
        this.#emit({ type: 'placed', proposalId, order: result.order });
        this.#track(result.order);
      }
    } catch (err) {
      this.#setCard(proposalId, (c) => approveFailed(c, err));
    }
  }

  async cancel(proposalId: string): Promise<void> {
    const card = this.#state.cards[proposalId];
    if (!card || !cardActions(card, this.#now()).cancel) return;
    this.#setCard(proposalId, cancelStarted);
    try {
      const r = await this.#client.cancel(proposalId);
      this.#setCard(proposalId, (c) => cancelResolved(c, r.cancelled));
    } catch (err) {
      this.#setCard(proposalId, (c) => cancelFailed(c, err));
    }
  }

  /**
   * Ask for a fresh quote, but only once a lookup confirms this card has no
   * order. Checked for every card (not just "not confirmed" ones): a server
   * restart can turn an unconfirmed card into a "lost" one.
   */
  async askAgain(proposalId: string): Promise<void> {
    const card = this.#state.cards[proposalId];
    if (!card || this.#state.busy || !cardActions(card, this.#now()).askAgain) return;
    this.#setCard(proposalId, checkStarted);
    try {
      const r = await this.#client.check(proposalId);
      this.#setCard(proposalId, (c) => checkResolved(c, r));
      if (r.status === 'placed') {
        this.#emit({ type: 'placed', proposalId, order: r.order });
        this.#track(r.order);
      }
      if (r.status !== 'not_placed') return;
    } catch (err) {
      this.#setCard(proposalId, (c) => checkFailed(c, err));
      return;
    }
    await this.send(askAgainMessage(card.proposal));
  }

  /** A tapped choice button: the pick goes out as the customer's next message. */
  async pickChoice(option: string): Promise<void> {
    const prompt = latestChoicePrompt(this.#state);
    if (!prompt || !prompt.options.some((o) => o.name === option)) return;
    await this.send(choiceMessage(prompt, option));
  }
}
