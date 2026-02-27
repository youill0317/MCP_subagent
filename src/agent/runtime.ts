import type { AgentConfig } from "../config/agents.js";
import type { LLMClient, ToolResult } from "../llm/types.js";
import { MCPClientManager } from "../mcp-client/manager.js";
import { TokenBucketRateLimiter } from "../utils/rate-limiter.js";
import { TokenCounter } from "../utils/token-counter.js";
import { AgentConversationContext } from "./context.js";

export interface AgentRunResult {
  agent_id: string;
  final_response: string;
  iterations: number;
  tool_calls_made: number;
  total_tokens: { input: number; output: number };
  run_id?: string;
  duration_ms?: number;
  stop_reason?: string;
  retries?: number;
  error?: string;
}

export interface AgentRunOptions {
  signal?: AbortSignal;
  runId?: string;
  rateLimiter?: TokenBucketRateLimiter;
  maxLlmRetriesPerIteration?: number;
}

export async function runAgent(
  agentConfig: AgentConfig,
  task: string,
  context: string | undefined,
  llmClient: LLMClient,
  mcpManager: MCPClientManager,
  options: AgentRunOptions = {},
): Promise<AgentRunResult> {
  const conversation = new AgentConversationContext();
  const tools = mcpManager.getToolsForAgent(agentConfig.mcp_servers);
  const startedAt = Date.now();

  const initialMessage = context
    ? `## Previous Context\n${context}\n\n## Current Task\n${task}`
    : task;

  conversation.addUser(initialMessage);

  let iterations = 0;
  let toolCallsMade = 0;
  let retries = 0;
  const tokenCounter = new TokenCounter();
  const maxLlmRetriesPerIteration = options.maxLlmRetriesPerIteration ?? 2;

  while (iterations < agentConfig.max_iterations) {
    if (options.signal?.aborted) {
      return createResult({
        agentConfig,
        tokenCounter,
        iterations,
        toolCallsMade,
        startedAt,
        options,
        retries,
        error: "Execution aborted",
        stopReason: "aborted",
      });
    }

    iterations += 1;
    let response;

    try {
      const invocation = await invokeLLMWithRetries(
        async () => {
          if (options.rateLimiter) {
            await options.rateLimiter.consume(1, options.signal);
          }

          return await llmClient.chat({
            model: agentConfig.model,
            system_prompt: agentConfig.system_prompt,
            messages: conversation.getMessages(),
            tools: tools.length > 0 ? tools : undefined,
            temperature: agentConfig.temperature,
            max_tokens: agentConfig.max_tokens,
            signal: options.signal,
          });
        },
        maxLlmRetriesPerIteration,
        options.signal,
      );

      response = invocation.response;
      retries += invocation.retryCount;
    } catch (error) {
      return createResult({
        agentConfig,
        tokenCounter,
        iterations,
        toolCallsMade,
        startedAt,
        options,
        retries,
        error: error instanceof Error ? error.message : String(error),
        stopReason: "error",
      });
    }

    tokenCounter.add(response.usage.input_tokens, response.usage.output_tokens);

    if (response.stop_reason === "end_turn" || !response.tool_calls || response.tool_calls.length === 0) {
      return createResult({
        agentConfig,
        tokenCounter,
        iterations,
        toolCallsMade,
        startedAt,
        options,
        retries,
        finalResponse: response.content,
        stopReason: response.stop_reason,
      });
    }

    conversation.addAssistant(response.content, response.tool_calls);

    const toolResults: ToolResult[] = await Promise.all(
      response.tool_calls.map(async (toolCall) => {
        if (options.signal?.aborted) {
          return {
            tool_call_id: toolCall.id,
            tool_name: toolCall.name,
            result: "Error: Execution aborted",
            is_error: true,
          };
        }

        toolCallsMade += 1;
        try {
          const result = await mcpManager.callTool(toolCall.name, toolCall.arguments, {
            signal: options.signal,
          });
          return {
            tool_call_id: toolCall.id,
            tool_name: toolCall.name,
            result,
          };
        } catch (error) {
          return {
            tool_call_id: toolCall.id,
            tool_name: toolCall.name,
            result: `Error: ${error instanceof Error ? error.message : String(error)}`,
            is_error: true,
          };
        }
      }),
    );

    conversation.addToolResults(toolResults);
  }

  return createResult({
    agentConfig,
    tokenCounter,
    iterations,
    toolCallsMade,
    startedAt,
    options,
    retries,
    finalResponse: `[max_iterations_reached] ${conversation.getLastText()}`,
    error: "Max iterations reached",
    stopReason: "max_iterations",
  });
}

async function invokeLLMWithRetries<T>(
  call: () => Promise<T>,
  maxRetries: number,
  signal?: AbortSignal,
): Promise<{ response: T; retryCount: number }> {
  let lastError: unknown;
  let retryCount = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await call();
      return {
        response,
        retryCount,
      };
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }

      lastError = error;
      if (attempt >= maxRetries || !isRetryableLLMError(error)) {
        break;
      }

      retryCount += 1;
      await sleepWithBackoff(attempt, signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isRetryableLLMError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  if (isAbortError(error)) {
    return false;
  }

  const statusMatch = error.message.match(/HTTP\s+(\d{3})/i);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    if (status >= 500 && status <= 599) {
      return true;
    }
    return status === 408 || status === 409 || status === 425 || status === 429;
  }

  const message = error.message.toLowerCase();
  return message.includes("network") || message.includes("socket") || message.includes("timed out");
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

async function sleepWithBackoff(attempt: number, signal?: AbortSignal): Promise<void> {
  const baseDelayMs = 300 * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * (baseDelayMs * 0.2));
  const waitMs = baseDelayMs + jitter;

  await new Promise<void>((resolve, reject) => {
    if (!signal) {
      setTimeout(resolve, waitMs);
      return;
    }

    if (signal.aborted) {
      reject(createAbortError("Retry wait aborted"));
      return;
    }

    let timeout: NodeJS.Timeout | undefined;
    const onAbort = () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      signal.removeEventListener("abort", onAbort);
      reject(createAbortError("Retry wait aborted"));
    };

    timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, waitMs);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function createAbortError(message: string): Error {
  const abortError = new Error(message);
  abortError.name = "AbortError";
  return abortError;
}

function createResult(params: {
  agentConfig: AgentConfig;
  tokenCounter: TokenCounter;
  iterations: number;
  toolCallsMade: number;
  startedAt: number;
  options: AgentRunOptions;
  retries: number;
  finalResponse?: string;
  error?: string;
  stopReason?: string;
}): AgentRunResult {
  return {
    agent_id: params.agentConfig.name,
    final_response: params.finalResponse ?? "",
    iterations: params.iterations,
    tool_calls_made: params.toolCallsMade,
    total_tokens: params.tokenCounter.snapshot(),
    ...(params.options.runId ? { run_id: params.options.runId } : {}),
    duration_ms: Date.now() - params.startedAt,
    retries: params.retries,
    ...(params.stopReason ? { stop_reason: params.stopReason } : {}),
    ...(params.error ? { error: params.error } : {}),
  };
}
