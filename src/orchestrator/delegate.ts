import { randomUUID } from "node:crypto";
import type { AgentRunResult } from "../agent/runtime.js";
import { runAgent } from "../agent/runtime.js";
import type { AgentsConfig } from "../config/agents.js";
import { getAgentConfig } from "../config/agents.js";
import type { AppEnv } from "../config/env.js";
import { createLLMClient } from "../llm/factory.js";
import { MCPClientManager } from "../mcp-client/manager.js";
import { TokenBucketRateLimiter } from "../utils/rate-limiter.js";

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
  const providerRateLimiters = createProviderRateLimiters(deps.env);

  return async (agentId: string, task: string, context?: string): Promise<AgentRunResult> => {
    const runId = randomUUID();

    try {
      const agentConfig = getAgentConfig(deps.agentsConfig, agentId);
      const apiKey = deps.env.providerApiKeys[agentConfig.provider];
      if (!apiKey) {
        return createErrorResult(agentId, `${agentConfig.provider} API key is not configured`, runId);
      }

      const llmClient = createLLMClient(agentConfig.provider, apiKey);
      const abortController = new AbortController();
      const execution = runAgent(agentConfig, task, context, llmClient, deps.mcpManager, {
        signal: abortController.signal,
        runId,
        rateLimiter: providerRateLimiters[agentConfig.provider],
      });

      return await withTimeout(
        execution,
        deps.env.AGENT_TIMEOUT_MS,
        () => {
          abortController.abort();
        },
        `Agent timed out after ${deps.env.AGENT_TIMEOUT_MS} ms`,
      );
    } catch (error) {
      return createErrorResult(agentId, error instanceof Error ? error.message : String(error), runId);
    }
  };
}

function createProviderRateLimiters(env: AppEnv): Record<"openai" | "anthropic" | "google", TokenBucketRateLimiter> {
  return {
    openai: new TokenBucketRateLimiter(env.RATE_LIMIT_CAPACITY, env.RATE_LIMIT_REFILL_PER_SECOND),
    anthropic: new TokenBucketRateLimiter(env.RATE_LIMIT_CAPACITY, env.RATE_LIMIT_REFILL_PER_SECOND),
    google: new TokenBucketRateLimiter(env.RATE_LIMIT_CAPACITY, env.RATE_LIMIT_REFILL_PER_SECOND),
  };
}

function createErrorResult(agentId: string, message: string, runId: string): AgentRunResult {
  return {
    agent_id: agentId,
    final_response: "",
    iterations: 0,
    tool_calls_made: 0,
    total_tokens: { input: 0, output: 0 },
    run_id: runId,
    duration_ms: 0,
    retries: 0,
    stop_reason: "error",
    error: message,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
  message: string,
): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutId = setTimeout(() => {
      onTimeout();
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
