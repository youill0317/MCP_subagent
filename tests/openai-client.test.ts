import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIClient } from "../src/llm/openai-client.js";

test("OpenAIClient adds OpenRouter provider payload and headers for openrouter base URL", async () => {
  const originalFetch = globalThis.fetch;
  let observedBody: Record<string, unknown> | undefined;
  let observedHeaders: Headers | undefined;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    observedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    observedHeaders = new Headers(init?.headers);

    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new OpenAIClient("test-key", "https://openrouter.ai/api/v1", {
      openrouterProviderOrder: ["anthropic", "openai"],
      openrouterAllowFallbacks: false,
      openrouterHttpReferer: "https://example.com",
      openrouterXTitle: "MCP Subagent",
    });

    await client.chat({
      model: "openai/gpt-4o-mini",
      system_prompt: "system",
      messages: [{ role: "user", content: "hello" }],
    });

    assert.ok(observedBody);
    assert.deepEqual(observedBody.provider, {
      order: ["anthropic", "openai"],
      allow_fallbacks: false,
    });
    assert.equal(observedHeaders?.get("HTTP-Referer"), "https://example.com");
    assert.equal(observedHeaders?.get("X-Title"), "MCP Subagent");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAIClient does not add OpenRouter payload for non-openrouter base URL", async () => {
  const originalFetch = globalThis.fetch;
  let observedBody: Record<string, unknown> | undefined;
  let observedHeaders: Headers | undefined;

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    observedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    observedHeaders = new Headers(init?.headers);

    return new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: "ok" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const client = new OpenAIClient("test-key", "https://api.example.com/v1", {
      openrouterProviderOrder: ["anthropic"],
      openrouterAllowFallbacks: true,
      openrouterHttpReferer: "https://example.com",
      openrouterXTitle: "MCP Subagent",
    });

    await client.chat({
      model: "gpt-4o-mini",
      system_prompt: "system",
      messages: [{ role: "user", content: "hello" }],
    });

    assert.ok(observedBody);
    assert.equal("provider" in observedBody, false);
    assert.equal(observedHeaders?.get("HTTP-Referer"), null);
    assert.equal(observedHeaders?.get("X-Title"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

