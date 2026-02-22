import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import type { AgentsConfig } from "../src/config/agents.js";
import { validateAgentsAgainstMCPServers } from "../src/config/agents.js";
import type { MCPServersConfig } from "../src/config/mcp-servers.js";
import { loadMCPServersConfig } from "../src/config/mcp-servers.js";

const originalEnvValue = process.env.TEST_MCP_SECRET;

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
        env: {},
      },
    },
  };

  assert.throws(() => {
    validateAgentsAgainstMCPServers(agentsConfig, mcpServersConfig);
  }, /undefined MCP server/);
});

test("loadMCPServersConfig enforces strict env template resolution", () => {
  delete process.env.TEST_MCP_SECRET;

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
            env: {
              SECRET: "${TEST_MCP_SECRET}",
            },
          },
        },
      },
      null,
      2,
    ),
  );

  try {
    assert.throws(() => {
      loadMCPServersConfig(filePath, { strictEnv: true });
    }, /Missing environment variable/);

    const loose = loadMCPServersConfig(filePath, { strictEnv: false });
    assert.equal(loose.servers.demo.env.SECRET, "");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

after(() => {
  if (originalEnvValue === undefined) {
    delete process.env.TEST_MCP_SECRET;
    return;
  }

  process.env.TEST_MCP_SECRET = originalEnvValue;
});
