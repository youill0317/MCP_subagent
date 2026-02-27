import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadAgentsConfig } from "../src/config/agents.js";
import type { AppEnv } from "../src/config/env.js";

function createEnv(): AppEnv {
  return {
    OPENAI_API_KEY: "openai-key",
    ANTHROPIC_API_KEY: "anthropic-key",
    GOOGLE_API_KEY: "google-key",
    CUSTOM_API_KEY: "custom-key",
    CODEX_ENABLED: true,
    CODEX_CLI_PATH: "codex",
    CODEX_MODEL_DEFAULT: "gpt-5-codex",
    OPENAI_BASE_URL: "https://api.openai.com/v1",
    ANTHROPIC_BASE_URL: "https://api.anthropic.com/v1",
    GOOGLE_BASE_URL: "https://generativelanguage.googleapis.com/v1beta",
    CUSTOM_BASE_URL: "https://api.openai.com/v1",
    DEFAULT_PROVIDER: "anthropic",
    DEFAULT_MODEL: "claude-sonnet-4-20250514",
    MAX_AGENT_ITERATIONS: 10,
    MAX_PARALLEL_AGENTS: 5,
    AGENT_TIMEOUT_MS: 120_000,
    STRICT_CONFIG_VALIDATION: true,
    RATE_LIMIT_CAPACITY: 10,
    RATE_LIMIT_REFILL_PER_SECOND: 5,
    providerApiKeys: {
      openai: "openai-key",
      anthropic: "anthropic-key",
      google: "google-key",
      custom: "custom-key",
      codex: undefined,
    },
    enabledProviders: ["openai", "anthropic", "google", "custom", "codex"],
  };
}

test("loadAgentsConfig uses CODEX_MODEL_DEFAULT when codex agent has no model", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "agents-config-"));
  const filePath = path.join(tempDir, "agents.json");

  writeFileSync(filePath, JSON.stringify({
    agents: {
      codex_worker: {
        description: "Codex-backed agent",
        provider: "codex",
        system_prompt: "Use tools when needed",
        mcp_servers: [],
      },
    },
  }, null, 2));

  try {
    const config = loadAgentsConfig(createEnv(), filePath);
    const agent = config.agents.codex_worker;
    assert.ok(agent);
    assert.equal(agent.provider, "codex");
    assert.equal(agent.model, "gpt-5-codex");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
