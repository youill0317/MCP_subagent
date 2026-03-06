import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { AgentsConfig } from "../src/config/agents.js";
import { validateAgentsAgainstMCPServers } from "../src/config/agents.js";
import type { MCPServersConfig } from "../src/config/mcp-servers.js";
import { loadMCPServersConfig } from "../src/config/mcp-servers.js";

test("validateAgentsAgainstMCPServers throws on unknown server reference", () => {
  const agentsConfig: AgentsConfig = {
    agents: {
      researcher: {
        name: "researcher",
        description: "desc",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        system_prompt: "prompt",
        mcp_servers: ["search", "missing"],
        max_iterations: 5,
        temperature: 0.2,
      },
    },
  };

  const mcpServersConfig: MCPServersConfig = {
    servers: {
      search: {
        command: "node",
        args: [],
      },
    },
  };

  assert.throws(() => {
    validateAgentsAgainstMCPServers(agentsConfig, mcpServersConfig);
  }, /undefined MCP server/);
});

test("loadMCPServersConfig rejects per-server env overrides", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "mcp-config-"));
  const filePath = path.join(tempDir, "mcp-servers.json");

  writeFileSync(
    filePath,
    JSON.stringify(
      {
        servers: {
          demo: {
            command: "node",
            args: ["server.js"],
            env: { SECRET: "value" },
          },
        },
      },
      null,
      2,
    ),
  );

  try {
    assert.throws(() => {
      loadMCPServersConfig(filePath);
    }, /Unrecognized key\(s\) in object: 'env'/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("loadMCPServersConfig rejects template placeholders", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "mcp-config-"));
  const filePath = path.join(tempDir, "mcp-servers.json");

  writeFileSync(
    filePath,
    JSON.stringify(
      {
        servers: {
          demo: {
            command: "node",
            args: ["${MCP_DEMO_PATH}"],
          },
        },
      },
      null,
      2,
    ),
  );

  try {
    assert.throws(() => {
      loadMCPServersConfig(filePath);
    }, /Template placeholder is not supported/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
