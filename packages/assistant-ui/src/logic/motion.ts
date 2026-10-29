// Timing rules for the chat's motion. Presentation only: these decide how
// things already received are shown, never whether something happened.

import type { Turn } from './conversation';

/**
 * The typing dots show from the moment a message is sent until the reply (or
 * an error) arrives, or the turn ends without one.
 */
export function typingVisible(turn: Turn): boolean {
  return (turn.status === 'sending' || turn.status === 'running') && !turn.reply && !turn.error;
}

/** The line under the dots: the latest step the server reported, else nothing. */
export function typingStatus(turn: Turn): string | null {
  return turn.steps.at(-1)?.label ?? null;
}

export const REVEAL_MS_PER_CHAR = 20;
export const REVEAL_MAX_MS = 1500;

/** How long a reply takes to appear: 20 ms per character, at most 1.5 s. */
export function revealDurationMs(text: string): number {
  return Math.min(text.length * REVEAL_MS_PER_CHAR, REVEAL_MAX_MS);
}

/** How many characters are visible `elapsedMs` after the reply arrived. */
export function revealedLength(text: string, elapsedMs: number): number {
  const total = revealDurationMs(text);
  if (total === 0 || elapsedMs >= total) return text.length;
  return Math.max(0, Math.floor((text.length * elapsedMs) / total));
}
