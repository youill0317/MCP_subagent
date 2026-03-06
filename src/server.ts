import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentsConfig } from "./config/agents.js";
import type { AppEnv } from "./config/env.js";
import { MCPClientManager } from "./mcp-client/manager.js";
import { createDelegateTaskExecutor } from "./orchestrator/delegate.js";
import { createPerspectivesTaskExecutor } from "./orchestrator/perspectives.js";
import { registerDelegateTaskTool } from "./tools/delegate-task.js";
import { registerPerspectivesTaskTool } from "./tools/perspectives-task.js";
import { registerListAgentsTool } from "./tools/list-agents.js";

export interface CreateServerDeps {
  env: AppEnv;
  agentsConfig: AgentsConfig;
  mcpManager: MCPClientManager;
}

const DELEGATE_AGENT_ALLOWLIST = ["researcher", "analyst"] as const;

export function selectDelegateAgentIds(agentsConfig: AgentsConfig): string[] {
  return DELEGATE_AGENT_ALLOWLIST.filter((id) => id in agentsConfig.agents);
}

export function createServer(deps: CreateServerDeps): McpServer {
  const server = new McpServer({
    name: "mcp-subagent-server",
    version: "1.0.0",
  });

  const delegateTask = createDelegateTaskExecutor({
    agentsConfig: deps.agentsConfig,
    env: deps.env,
    mcpManager: deps.mcpManager,
  });

  const availableAgentIds = selectDelegateAgentIds(deps.agentsConfig);

  const perspectivesTask = createPerspectivesTaskExecutor({
    delegateTask,
    maxParallelAgents: deps.env.MAX_PARALLEL_AGENTS,
  });

  registerDelegateTaskTool(server, {
    delegateTask,
    availableAgentIds,
  });

  registerPerspectivesTaskTool(server, {
    perspectivesTask,
  });

  registerListAgentsTool(server, {
    agentsConfig: deps.agentsConfig,
    mcpManager: deps.mcpManager,
  });

  return server;
}
