export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefillMs: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {
    this.tokens = capacity;
    this.lastRefillMs = Date.now();
  }

  async consume(amount = 1): Promise<void> {
    if (amount <= 0) {
      return;
    }

    while (true) {
      this.refill();
      if (this.tokens >= amount) {
        this.tokens -= amount;
        return;
      }

      const missingTokens = amount - this.tokens;
      const waitMs = Math.ceil((missingTokens / this.refillPerSecond) * 1000);
      await sleep(Math.max(waitMs, 10));
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillMs;
    if (elapsedMs <= 0) {
      return;
    }

    const refillAmount = (elapsedMs / 1000) * this.refillPerSecond;
    this.tokens = Math.min(this.capacity, this.tokens + refillAmount);
    this.lastRefillMs = now;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
