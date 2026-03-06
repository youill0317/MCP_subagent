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
    },
    enabledProviders: ["openai", "anthropic", "google", "custom"],
  };
}

test("loadAgentsConfig uses DEFAULT_MODEL when agent model is omitted", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "agents-config-"));
  const filePath = path.join(tempDir, "agents.json");

  writeFileSync(filePath, JSON.stringify({
    agents: {
      analyst_worker: {
        description: "Anthropic-backed agent",
        provider: "anthropic",
        system_prompt: "Use tools when needed",
        mcp_servers: [],
      },
    },
  }, null, 2));

  try {
    const config = loadAgentsConfig(createEnv(), filePath);
    const agent = config.agents.analyst_worker;
    assert.ok(agent);
    assert.equal(agent.provider, "anthropic");
    assert.equal(agent.model, "claude-sonnet-4-20250514");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadAgentsConfig rejects codex provider", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "agents-config-"));
  const filePath = path.join(tempDir, "agents.json");

  writeFileSync(filePath, JSON.stringify({
    agents: {
      legacy_worker: {
        description: "Legacy codex agent",
        provider: "codex",
        system_prompt: "Use tools when needed",
        mcp_servers: [],
      },
    },
  }, null, 2));

  try {
    assert.throws(() => {
      loadAgentsConfig(createEnv(), filePath);
    }, /Invalid enum value/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("default agents.json keeps delegate agents and removes reviewer", () => {
  const config = loadAgentsConfig(createEnv());
  const agentIds = Object.keys(config.agents).sort();
  const requiredSections = [
    "## Role & Scope",
    "## Output Contract",
    "## Tool Orchestration Policy",
    "## Tool Selection Hints",
    "## Role-Specific Rules",
  ];

  assert.deepEqual(
    agentIds,
    ["analyst", "creative", "critical", "logical", "researcher"],
  );
  assert.equal("reviewer" in config.agents, false);

  for (const agent of Object.values(config.agents)) {
    for (const section of requiredSections) {
      assert.equal(agent.system_prompt.includes(section), true);
    }
    assert.equal(agent.system_prompt.includes("Allowed owner values:"), true);
    assert.equal(agent.system_prompt.includes("reviewer"), false);
  }

  for (const agentId of ["researcher", "analyst"]) {
    const prompt = config.agents[agentId]?.system_prompt ?? "";
    assert.equal(prompt.includes("use MCP tools proactively before answering"), true);
  }

  assert.equal(
    config.agents.researcher?.system_prompt.includes("Use MCP Search tools for web retrieval"),
    true,
  );
  assert.equal(
    config.agents.analyst?.system_prompt.includes("Use `search_markdown` first when file paths are unknown."),
    true,
  );

  for (const agentId of ["creative", "critical", "logical"]) {
    const prompt = config.agents[agentId]?.system_prompt ?? "";
    assert.equal(prompt.includes("You do not have MCP tools available in this role."), true);
    assert.equal(prompt.includes("Never claim to have searched, verified, or retrieved information."), true);
  }
});
