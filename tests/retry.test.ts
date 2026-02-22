import assert from "node:assert/strict";
import test from "node:test";
import { postJsonWithRetry } from "../src/llm/retry.js";

test("postJsonWithRetry retries retryable status codes", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = (async () => {
    callCount += 1;
    if (callCount === 1) {
      return new Response("upstream error", { status: 500 });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const result = await postJsonWithRetry<{ ok: boolean }>(
      "https://example.com",
      {
        headers: {},
        body: { ping: true },
      },
      {
        maxRetries: 2,
        initialDelayMs: 1,
      },
    );

    assert.equal(result.ok, true);
    assert.equal(callCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("postJsonWithRetry does not retry non-retryable status codes", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = (async () => {
    callCount += 1;
    return new Response("bad request", { status: 400 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      postJsonWithRetry(
        "https://example.com",
        {
          headers: {},
          body: { ping: true },
        },
        {
          maxRetries: 2,
          initialDelayMs: 1,
        },
      ),
      /HTTP 400/,
    );

    assert.equal(callCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("postJsonWithRetry exits immediately when signal is aborted", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;

  globalThis.fetch = (async () => {
    callCount += 1;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const controller = new AbortController();
  controller.abort();

  try {
    await assert.rejects(
      postJsonWithRetry(
        "https://example.com",
        {
          headers: {},
          body: {},
        },
        {
          signal: controller.signal,
          maxRetries: 2,
          initialDelayMs: 1,
        },
      ),
      /aborted/i,
    );

    assert.equal(callCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
