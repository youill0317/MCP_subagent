import { randomUUID } from "node:crypto";
import type { AgentRunResult } from "../agent/runtime.js";
import { runAgent } from "../agent/runtime.js";
import type { AgentsConfig } from "../config/agents.js";
import { getAgentConfig } from "../config/agents.js";
import type { AppEnv } from "../config/env.js";
import type { MCPServersConfig } from "../config/mcp-servers.js";
import { createLLMClient } from "../llm/factory.js";
import type { LLMBaseUrls } from "../llm/factory.js";
import { MCPClientManager } from "../mcp-client/manager.js";
import { TokenBucketRateLimiter } from "../utils/rate-limiter.js";

export interface DelegateTaskDeps {
  agentsConfig: AgentsConfig;
  env: AppEnv;
  mcpServersConfig: MCPServersConfig;
  mcpManager: MCPClientManager;
}

export type DelegateTaskFn = (
  agentId: string,
  task: string,
  context?: string,
) => Promise<AgentRunResult>;

export function createDelegateTaskExecutor(deps: DelegateTaskDeps): DelegateTaskFn {
  const providerRateLimiters = createProviderRateLimiters(deps.env);
  const providerBaseUrls = createProviderBaseUrls(deps.env);

  return async (agentId: string, task: string, context?: string): Promise<AgentRunResult> => {
    const runId = randomUUID();

    try {
      const agentConfig = getAgentConfig(deps.agentsConfig, agentId);
      const apiKey = deps.env.providerApiKeys[agentConfig.provider];
      if (agentConfig.provider === "codex" && !deps.env.CODEX_ENABLED) {
        return createErrorResult(agentId, "codex provider is disabled (CODEX_ENABLED=false)", runId);
      }

      if (agentConfig.provider !== "codex" && !apiKey) {
        return createErrorResult(agentId, `${agentConfig.provider} API key is not configured`, runId);
      }

      const llmClient = createLLMClient(agentConfig.provider, apiKey, providerBaseUrls, {
        codex: {
          cliPath: deps.env.CODEX_CLI_PATH,
          mcpServers: resolveAgentMcpServers(agentConfig.mcp_servers, deps.mcpServersConfig),
          cwd: process.cwd(),
        },
        custom: {
          openrouterProviderOrder: deps.env.OPENROUTER_PROVIDER_ORDER,
          openrouterAllowFallbacks: deps.env.OPENROUTER_ALLOW_FALLBACKS,
          openrouterHttpReferer: deps.env.OPENROUTER_HTTP_REFERER,
          openrouterXTitle: deps.env.OPENROUTER_X_TITLE,
        },
      });
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

function createProviderRateLimiters(
  env: AppEnv,
): Record<"openai" | "anthropic" | "google" | "custom" | "codex", TokenBucketRateLimiter> {
  return {
    openai: new TokenBucketRateLimiter(env.RATE_LIMIT_CAPACITY, env.RATE_LIMIT_REFILL_PER_SECOND),
    anthropic: new TokenBucketRateLimiter(env.RATE_LIMIT_CAPACITY, env.RATE_LIMIT_REFILL_PER_SECOND),
    google: new TokenBucketRateLimiter(env.RATE_LIMIT_CAPACITY, env.RATE_LIMIT_REFILL_PER_SECOND),
    custom: new TokenBucketRateLimiter(env.RATE_LIMIT_CAPACITY, env.RATE_LIMIT_REFILL_PER_SECOND),
    codex: new TokenBucketRateLimiter(env.RATE_LIMIT_CAPACITY, env.RATE_LIMIT_REFILL_PER_SECOND),
  };
}

function createProviderBaseUrls(env: AppEnv): LLMBaseUrls {
  return {
    openai: env.OPENAI_BASE_URL,
    anthropic: env.ANTHROPIC_BASE_URL,
    google: env.GOOGLE_BASE_URL,
    custom: env.CUSTOM_BASE_URL,
  };
}

function resolveAgentMcpServers(
  agentMcpServerNames: string[],
  mcpServersConfig: MCPServersConfig,
): MCPServersConfig["servers"] {
  const resolved: MCPServersConfig["servers"] = {};

  for (const serverName of agentMcpServerNames) {
    const server = mcpServersConfig.servers[serverName];
    if (!server) {
      throw new Error(`Unknown MCP server in agent configuration: ${serverName}`);
    }
    resolved[serverName] = server;
  }

  return resolved;
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
