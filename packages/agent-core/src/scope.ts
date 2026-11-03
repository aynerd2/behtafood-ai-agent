// Scope: the assistant only helps with Behtafood (food, restaurants, menus,
// prices and budgets, orders and approvals, the wallet and paying for orders,
// order status and delays, reminders, how to use the app).
//
// Two layers, so the rule never depends on the model alone:
//   1. Before any model call: a cheap rule-based check for attempts to override
//      the rules or read the prompt. A hit gets the fixed redirect, no model
//      call and no tools.
//   2. After the model: its final reply must come through send_reply with
//      in_scope: true. False or missing → the model's text is dropped and the
//      fixed redirect is sent instead (see agent.ts).
//
// Only counts are recorded, never the message text.

export const MAX_USER_CHARS = 500;

const OVERRIDE_PATTERNS: RegExp[] = [
  /\b(ignore|disregard|forget|override|bypass|skip)\b.{0,40}\b(instruction|instructions|rules?|prompt|guidelines?|system|previous|above|restrictions?)\b/i,
  /\b(system|developer|hidden|initial|original|secret)\s+(prompt|message|instructions?)\b/i,
  /\b(your|the)\s+(prompt|instructions|rules|guidelines|system message)\b.{0,30}\b(say|show|reveal|print|repeat|tell|share|list|what)\b/i,
  /\b(show|reveal|print|repeat|tell|share|list|output|leak)\b.{0,30}\b(your|the)\s+(prompt|instructions|rules|guidelines|system message|configuration)\b/i,
  /\b(jailbreak|jail break|dan mode|developer mode|god mode|sudo mode|unfiltered|no restrictions)\b/i,
  /\b(you are now|from now on you are|pretend (to be|you are)|act as (a|an|my)|role[- ]?play|roleplay)\b/i,
  /\brepeat (the|everything|all) (words|text) above\b/i,
  /\bnew (instructions|rules)\s*:/i,
  // Pidgin
  /\b(forget|comot)\b.{0,30}\b(wetin dem tell you|your rules|your instruction)/i,
];

export function isOverrideAttempt(text: string): boolean {
  return OVERRIDE_PATTERNS.some((re) => re.test(text));
}

export type ScopeEvent = 'out_of_scope' | 'missing_flag' | 'override_blocked' | 'too_long';

/** Counts only. Never stores what the customer wrote. */
export class ScopeCounters {
  readonly counts: Record<ScopeEvent, number> = { out_of_scope: 0, missing_flag: 0, override_blocked: 0, too_long: 0 };
  record(event: ScopeEvent): void {
    this.counts[event] += 1;
  }
  snapshot(): Record<ScopeEvent, number> {
    return { ...this.counts };
  }
}
