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

export interface AssistantState extends ConversationState {
  /** A message is being answered; sending is disabled. */
  busy: boolean;
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
}

const LOST_CONNECTION = 'Lost connection to the assistant. Check your internet and try again.';
const TOO_SLOW = 'The assistant is taking too long. Please try again.';

export class AssistantController {
  #state: AssistantState = { ...initialState(), busy: false };
  readonly #listeners = new Set<() => void>();
  readonly #client: AgentClient;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #now: () => number;
  readonly #interval: number;
  readonly #maxPollMs: number;
  readonly #maxPollErrors: number;
  #turnSeq = 0;
  #disposed = false;

  constructor(opts: ControllerOptions) {
    this.#client = opts.client;
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#now = opts.now ?? Date.now;
    this.#interval = opts.pollIntervalMs ?? 1000;
    this.#maxPollMs = opts.maxPollMs ?? 3 * 60_000;
    this.#maxPollErrors = opts.maxPollErrors ?? 5;
  }

  getState = (): AssistantState => this.#state;

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
    this.#set((s) => ({ ...fn(s), busy: s.busy }));
  }

  #setCard(id: string, fn: (c: ApprovalCardState) => ApprovalCardState): void {
    this.#set((s) => {
      const c = s.cards[id];
      return c ? { ...s, cards: { ...s.cards, [id]: fn(c) } } : s;
    });
  }

  async send(text: string): Promise<void> {
    const clean = text.trim();
    if (!clean || this.#state.busy) return;
    const turnId = `turn_${++this.#turnSeq}`;
    this.#set((s) => ({ ...startTurn(s, turnId, clean), busy: true }));
    try {
      let runId: string;
      try {
        const r = await this.#client.chat(clean, this.#state.sessionId);
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
        this.#conv((s) => applyRunEvents(s, turnId, r.events ?? [], r.finished));
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

  /** Expired, lost or refused card: ask the assistant for a fresh quote. */
  async askAgain(proposalId: string): Promise<void> {
    const card = this.#state.cards[proposalId];
    if (!card || !cardActions(card, this.#now()).askAgain) return;
    await this.send(askAgainMessage(card.proposal));
  }

  /** A tapped choice button: the pick goes out as the customer's next message. */
  async pickChoice(option: string): Promise<void> {
    const prompt = latestChoicePrompt(this.#state);
    if (!prompt || !prompt.options.some((o) => o.name === option)) return;
    await this.send(choiceMessage(prompt, option));
  }
}
