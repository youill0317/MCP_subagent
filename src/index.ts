#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadAgentsConfig } from "./config/agents.js";
import { loadEnv } from "./config/env.js";
import { loadMCPServersConfig } from "./config/mcp-servers.js";
import { MCPClientManager } from "./mcp-client/manager.js";
import { createServer } from "./server.js";
import { logger } from "./utils/logger.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const mcpServersConfig = loadMCPServersConfig();
  const agentsConfig = loadAgentsConfig(env);

  const mcpManager = new MCPClientManager();
  await mcpManager.initialize(mcpServersConfig);

  const server = createServer({
    env,
    agentsConfig,
    mcpManager,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info("MCP Sub-Agent Server started", {
    agents: Object.keys(agentsConfig.agents),
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("Shutting down MCP Sub-Agent Server", { signal });
    await mcpManager.shutdown();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

main().catch((error) => {
  logger.error("Fatal startup error", {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
