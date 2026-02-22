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

  async consume(amount = 1, signal?: AbortSignal): Promise<void> {
    if (amount <= 0) {
      return;
    }

    while (true) {
      if (signal?.aborted) {
        throw createAbortError();
      }

      this.refill();
      if (this.tokens >= amount) {
        this.tokens -= amount;
        return;
      }

      const missingTokens = amount - this.tokens;
      const waitMs = Math.ceil((missingTokens / this.refillPerSecond) * 1000);
      await sleep(Math.max(waitMs, 10), signal);
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

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!signal) {
      setTimeout(resolve, ms);
      return;
    }

    if (signal.aborted) {
      reject(createAbortError());
      return;
    }

    let timeout: NodeJS.Timeout | undefined;
    const onAbort = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError());
    };

    timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function createAbortError(): Error {
  const abortError = new Error("Rate limiter wait aborted");
  abortError.name = "AbortError";
  return abortError;
}
