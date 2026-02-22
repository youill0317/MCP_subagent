import assert from "node:assert/strict";
import test from "node:test";
import { TokenBucketRateLimiter } from "../src/utils/rate-limiter.js";

test("rate limiter consume aborts while waiting for refill", async () => {
  const limiter = new TokenBucketRateLimiter(1, 0.1);
  await limiter.consume(1);

  const controller = new AbortController();
  const pending = limiter.consume(1, controller.signal);
  setTimeout(() => {
    controller.abort();
  }, 20);

  await assert.rejects(pending, /aborted/i);
});

test("rate limiter consume still succeeds when enough tokens are available", async () => {
  const limiter = new TokenBucketRateLimiter(2, 1);
  await limiter.consume(1);
  await limiter.consume(1);
});
