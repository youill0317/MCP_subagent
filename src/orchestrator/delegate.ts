import type { AgentRunResult } from "../agent/runtime.js";
import { runAgent } from "../agent/runtime.js";
import type { AgentsConfig } from "../config/agents.js";
import { getAgentConfig } from "../config/agents.js";
import type { AppEnv } from "../config/env.js";
import { createLLMClient } from "../llm/factory.js";
import { MCPClientManager } from "../mcp-client/manager.js";

export interface DelegateTaskDeps {
  agentsConfig: AgentsConfig;
  env: AppEnv;
  mcpManager: MCPClientManager;
}

export type DelegateTaskFn = (
  agentId: string,
  task: string,
  context?: string,
) => Promise<AgentRunResult>;

export function createDelegateTaskExecutor(deps: DelegateTaskDeps): DelegateTaskFn {
  return async (agentId: string, task: string, context?: string): Promise<AgentRunResult> => {
    try {
      const agentConfig = getAgentConfig(deps.agentsConfig, agentId);
      const apiKey = deps.env.providerApiKeys[agentConfig.provider];
      if (!apiKey) {
        return createErrorResult(agentId, `${agentConfig.provider} API key is not configured`);
      }

      const llmClient = createLLMClient(agentConfig.provider, apiKey);
      const execution = runAgent(agentConfig, task, context, llmClient, deps.mcpManager);

      return await withTimeout(
        execution,
        deps.env.AGENT_TIMEOUT_MS,
        `Agent timed out after ${deps.env.AGENT_TIMEOUT_MS} ms`,
      );
    } catch (error) {
      return createErrorResult(agentId, error instanceof Error ? error.message : String(error));
    }
  };
}

function createErrorResult(agentId: string, message: string): AgentRunResult {
  return {
    agent_id: agentId,
    final_response: "",
    iterations: 0,
    tool_calls_made: 0,
    total_tokens: { input: 0, output: 0 },
    error: message,
  };
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
