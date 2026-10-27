// Usage meter: logs every model call's tokens, prices it, and enforces daily
// spending caps per customer and overall.

export interface Usage {
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  reasoningTokens: number;
}

export const ZERO_USAGE: Usage = { promptTokens: 0, cachedTokens: 0, completionTokens: 0, reasoningTokens: 0 };

/** USD per 1M tokens, Meta Model API standard tier (checked 2026-10-27). Reasoning is billed as output. */
export const MODEL_PRICES: Record<string, { input: number; cached: number; output: number }> = {
  'muse-spark-1.3': { input: 1.25, cached: 0.15, output: 4.25 },
  'muse-spark-1.2': { input: 1.25, cached: 0.15, output: 4.25 },
};

export function costUsd(model: string, u: Usage): number {
  const p = MODEL_PRICES[model];
  if (!p) return 0; // scripted / offline models cost nothing
  return ((u.promptTokens - u.cachedTokens) * p.input + u.cachedTokens * p.cached + u.completionTokens * p.output) / 1e6;
}

export interface UsageEntry {
  at: string;
  customerId: string;
  sessionId: string;
  model: string;
  usage: Usage;
  costUsd: number;
}

export interface UsageMeterOptions {
  clock?: () => number;
  /** Per customer per UTC day. */
  customerDailyCapUsd?: number;
  /** All customers per UTC day. */
  globalDailyCapUsd?: number;
}

export type SpendCheck = { ok: true } | { ok: false; reason: 'customer_cap' | 'global_cap' };

export class UsageMeter {
  readonly entries: UsageEntry[] = [];
  readonly #clock: () => number;
  readonly #customerCap: number;
  readonly #globalCap: number;

  constructor(opts: UsageMeterOptions = {}) {
    this.#clock = opts.clock ?? Date.now;
    this.#customerCap = opts.customerDailyCapUsd ?? 0.5;
    this.#globalCap = opts.globalDailyCapUsd ?? 5;
  }

  record(e: { customerId: string; sessionId: string; model: string; usage: Usage }): UsageEntry {
    const entry: UsageEntry = { ...e, at: new Date(this.#clock()).toISOString(), costUsd: costUsd(e.model, e.usage) };
    this.entries.push(entry);
    return entry;
  }

  #today(): string {
    return new Date(this.#clock()).toISOString().slice(0, 10);
  }

  spentToday(customerId?: string): number {
    const day = this.#today();
    return this.entries
      .filter((e) => e.at.startsWith(day) && (customerId === undefined || e.customerId === customerId))
      .reduce((s, e) => s + e.costUsd, 0);
  }

  canSpend(customerId: string): SpendCheck {
    if (this.spentToday() >= this.#globalCap) return { ok: false, reason: 'global_cap' };
    if (this.spentToday(customerId) >= this.#customerCap) return { ok: false, reason: 'customer_cap' };
    return { ok: true };
  }

  session(sessionId: string): { modelCalls: number; usage: Usage; costUsd: number } {
    const mine = this.entries.filter((e) => e.sessionId === sessionId);
    const usage = mine.reduce<Usage>(
      (a, e) => ({
        promptTokens: a.promptTokens + e.usage.promptTokens,
        cachedTokens: a.cachedTokens + e.usage.cachedTokens,
        completionTokens: a.completionTokens + e.usage.completionTokens,
        reasoningTokens: a.reasoningTokens + e.usage.reasoningTokens,
      }),
      ZERO_USAGE,
    );
    return { modelCalls: mine.length, usage, costUsd: mine.reduce((s, e) => s + e.costUsd, 0) };
  }

  /** Read-only summary for the usage endpoint. Contains no message content. */
  report(customerId?: string) {
    const mine = customerId ? this.entries.filter((e) => e.customerId === customerId) : this.entries;
    return {
      modelCalls: mine.length,
      costUsd: mine.reduce((s, e) => s + e.costUsd, 0),
      spentTodayUsd: this.spentToday(customerId),
      entries: mine.slice(-50),
    };
  }
}
