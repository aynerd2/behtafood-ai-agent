// Sliding-window rate limiter, keyed per customer.

export class RateLimiter {
  readonly #hits = new Map<string, number[]>();

  constructor(
    readonly max: number,
    readonly windowMs: number,
    readonly clock: () => number = Date.now,
  ) {}

  /** Records a hit and returns false when the key is over its limit (the hit is not counted then). */
  hit(key: string): boolean {
    const now = this.clock();
    const recent = (this.#hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.#hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.#hits.set(key, recent);
    return true;
  }
}
