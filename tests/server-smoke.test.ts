import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "../src/server.js";
import type { AgentsConfig } from "../src/config/agents.js";
import type { AppEnv } from "../src/config/env.js";
import { MCPClientManager } from "../src/mcp-client/manager.js";

test("createServer smoke test", () => {
  const env: AppEnv = {
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1",
    GOOGLE_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
    DEFAULT_PROVIDER: "anthropic",
    DEFAULT_MODEL: "claude-sonnet-4-20250514",
    MAX_AGENT_ITERATIONS: 5,
    MAX_PARALLEL_AGENTS: 3,
    AGENT_TIMEOUT_MS: 30_000,
    STRICT_CONFIG_VALIDATION: true,
    RATE_LIMIT_CAPACITY: 10,
    RATE_LIMIT_REFILL_PER_SECOND: 5,
    providerApiKeys: {
      openai: "x",
      anthropic: "y",
      google: "z",
    },
    enabledProviders: ["openai", "anthropic", "google"],
  };

  const agentsConfig: AgentsConfig = {
    agents: {
      generalist: {
        name: "generalist",
        description: "desc",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        system_prompt: "prompt",
        mcp_servers: [],
        max_iterations: 5,
        temperature: 0.2,
      },
    },
  };

  const mcpManager = new MCPClientManager();
  const server = createServer({ env, agentsConfig, mcpManager });

  assert.ok(server);
  assert.equal(typeof server.connect, "function");
});
