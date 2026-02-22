import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentsConfig } from "./config/agents.js";
import type { AppEnv } from "./config/env.js";
import { MCPClientManager } from "./mcp-client/manager.js";
import { createDelegateTaskExecutor } from "./orchestrator/delegate.js";
import { createDebateTaskExecutor } from "./orchestrator/debate.js";
import { createEnsembleTaskExecutor } from "./orchestrator/ensemble.js";
import { createPipelineTaskExecutor } from "./orchestrator/pipeline.js";
import { registerDebateTaskTool } from "./tools/debate-task.js";
import { registerDelegateTaskTool } from "./tools/delegate-task.js";
import { registerEnsembleTaskTool } from "./tools/ensemble-task.js";
import { registerPipelineTaskTool } from "./tools/pipeline-task.js";
import { registerListAgentsTool } from "./tools/list-agents.js";

export interface CreateServerDeps {
  env: AppEnv;
  agentsConfig: AgentsConfig;
  mcpManager: MCPClientManager;
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

  const ensembleTask = createEnsembleTaskExecutor({
    delegateTask,
    maxParallelAgents: deps.env.MAX_PARALLEL_AGENTS,
  });

  const pipelineTask = createPipelineTaskExecutor({
    delegateTask,
  });

  const availableAgentIds = Object.keys(deps.agentsConfig.agents);

  const debateTask = createDebateTaskExecutor({
    delegateTask,
    maxParallelAgents: deps.env.MAX_PARALLEL_AGENTS,
    availableAgentIds,
  });

  registerDelegateTaskTool(server, {
    delegateTask,
    availableAgentIds,
  });

  registerEnsembleTaskTool(server, {
    ensembleTask,
    availableAgentIds,
  });

  registerPipelineTaskTool(server, {
    pipelineTask,
    availableAgentIds,
  });

  registerDebateTaskTool(server, {
    debateTask,
    availableAgentIds,
  });

  registerListAgentsTool(server, {
    agentsConfig: deps.agentsConfig,
    mcpManager: deps.mcpManager,
  });

  return server;
}
