// Guided mode, the switch and the brakes.
//
//   Chat mode    the full chat panel; no screen ever moves.
//   Guided mode  a small bar; real app screens follow the assistant's steps.
//
// Rules this encodes:
//   - Switching to Chat stops all navigation at once (and clears highlights).
//   - Switching to Guided mid-run applies only the LATEST step, never a replay.
//   - Stop halts navigation for the rest of the run; the next message re-arms it.
//   - Any touch on the app pauses navigation (the customer is in control) until
//     they tap Resume, which again applies only the latest step.
//   - Nothing moves while the panel is closed. No step is ever applied twice.
//   - Pacing: each step stays on screen for at least minDwellMs, so steps
//     that arrive together (three menus read at once) are shown in turn
//     instead of flashing past. Chat, Stop, pause and close drop the queue.

import type { ApprovalCardState } from './approval';
import type { AssistantState } from './controller';
import type { GuideAction } from './guide';
import { openDelay } from './tracking';

export type GuideMode = 'chat' | 'guided';
export type GuideStatus = 'chat' | 'closed' | 'stopped' | 'paused' | 'navigating';

/** The remembered choice, or Guided for the first run. */
export function initialGuideMode(stored: string | null | undefined, opts: { guidedEnabled?: boolean } = {}): GuideMode {
  // With guided mode switched off for the app, a remembered "guided" is ignored.
  if (opts.guidedEnabled === false) return 'chat';
  return stored === 'chat' || stored === 'guided' ? stored : 'guided';
}

export interface GuideSessionOptions {
  mode: GuideMode;
  /** Carry out one step's screen change (route, highlight, animation). */
  apply: (a: GuideAction) => void;
  /** Remove every highlight and animation. */
  clear: () => void;
  /** Minimum time each step stays on screen (0 = no pacing). */
  minDwellMs?: number;
  /** Timer, injectable for tests. Returns a cancel function. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

export class GuideSession {
  mode: GuideMode;
  open = false;
  paused = false;
  stopped = false;
  /** The latest step received, applied or not: the bar always shows the truth. */
  current?: GuideAction;
  #lastApplied?: string;
  readonly #apply: (a: GuideAction) => void;
  readonly #clear: () => void;
  readonly #listeners = new Set<() => void>();
  readonly #dwell: number;
  readonly #schedule: (fn: () => void, ms: number) => () => void;
  #queue: GuideAction[] = [];
  #cooling = false;
  #cancelCooling: (() => void) | null = null;

  constructor(opts: GuideSessionOptions) {
    this.mode = opts.mode;
    this.#apply = opts.apply;
    this.#clear = opts.clear;
    this.#dwell = opts.minDwellMs ?? 0;
    this.#schedule =
      opts.schedule ??
      ((fn, ms) => {
        const t = setTimeout(fn, ms);
        return () => clearTimeout(t);
      });
  }

  get status(): GuideStatus {
    if (this.mode === 'chat') return 'chat';
    if (!this.open) return 'closed';
    if (this.stopped) return 'stopped';
    if (this.paused) return 'paused';
    return 'navigating';
  }

  get canNavigate(): boolean {
    return this.status === 'navigating';
  }

  subscribe(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #changed(): void {
    for (const fn of this.#listeners) fn();
  }

  #applyNow(a: GuideAction): void {
    this.#lastApplied = a.key;
    this.#apply(a);
    if (this.#dwell > 0) {
      this.#cooling = true;
      this.#cancelCooling = this.#schedule(() => {
        this.#cooling = false;
        this.#cancelCooling = null;
        this.#drain();
      }, this.#dwell);
    }
  }

  #drain(): void {
    const next = this.#queue.shift();
    if (next && this.canNavigate) this.#applyNow(next);
  }

  /** Drop queued steps and any pending dwell timer. */
  #halt(): void {
    this.#queue = [];
    this.#cancelCooling?.();
    this.#cancelCooling = null;
    this.#cooling = false;
  }

  /** Show the latest step only (never a replay of the ones in between). */
  #catchUp(): void {
    this.#halt();
    if (this.canNavigate && this.current && this.current.key !== this.#lastApplied) this.#applyNow(this.current);
  }

  receive(a: GuideAction): void {
    this.current = a;
    if (this.canNavigate) {
      if (this.#cooling) this.#queue.push(a);
      else this.#applyNow(a);
    }
    this.#changed();
  }

  setMode(mode: GuideMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'chat') {
      this.paused = false;
      this.#halt();
      this.#clear();
    } else {
      this.#catchUp();
    }
    this.#changed();
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    if (open) this.#catchUp();
    else {
      this.#halt();
      this.#clear();
    }
    this.#changed();
  }

  stop(): void {
    this.stopped = true;
    this.paused = false;
    this.#halt();
    this.#clear();
    this.#changed();
  }

  /** The customer touched the app: they are in control now. */
  touch(): void {
    if (this.status !== 'navigating') return;
    this.paused = true;
    this.#halt();
    this.#changed();
  }

  resume(): void {
    this.paused = false;
    this.#catchUp();
    this.#changed();
  }

  /** The customer sent a new message: guided navigation may run again. */
  newRun(): void {
    this.stopped = false;
    this.paused = false;
    this.#changed();
  }
}

const SETTLED = new Set<ApprovalCardState['status']>(['placed']);
/** A card the customer must act on (or is acting on) keeps the sheet open, even mid-run. */
const NEEDS_CUSTOMER = new Set<ApprovalCardState['status']>(['awaiting', 'price_changed', 'approving', 'uncertain', 'unverified', 'checking']);

/**
 * Bar while the assistant works, or once the order is placed (so the tracking
 * screen shows). Sheet whenever the assistant needs the customer: nothing
 * asked yet, an approval card (at once, even mid-run), a question or a choice.
 */
export function guidedLayout(state: Omit<AssistantState, 'language'>, _now: number): 'bar' | 'sheet' {
  const turn = state.turns.at(-1);
  if (!turn) return 'sheet';
  if (turn.proposalIds.some((id) => NEEDS_CUSTOMER.has(state.cards[id]?.status ?? 'placed'))) return 'sheet';
  // A delay with reminder buttons is a question for the customer.
  if (Object.values(state.tracking ?? {}).some((t) => openDelay(t))) return 'sheet';
  if (state.busy) return 'bar';
  if (turn.proposalIds.some((id) => SETTLED.has(state.cards[id]?.status ?? 'awaiting'))) return 'bar';
  return 'sheet';
}
