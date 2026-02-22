#!/usr/bin/env node

// src/index.ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// src/config/agents.ts
import { readFileSync } from "fs";
import path from "path";
import { z } from "zod";
var AgentPresetSchema = z.object({
  description: z.string().min(1),
  provider: z.enum(["openai", "anthropic", "google"]).optional(),
  model: z.string().trim().min(1).optional(),
  system_prompt: z.string().min(1),
  mcp_servers: z.array(z.string().min(1)).default([]),
  max_iterations: z.number().int().positive().optional(),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional()
});
var AgentsFileSchema = z.object({
  agents: z.record(AgentPresetSchema)
});
function loadAgentsConfig(env, filePath = path.resolve(process.cwd(), "agents.json")) {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = AgentsFileSchema.parse(JSON.parse(raw));
  const agents = {};
  for (const [name, preset] of Object.entries(parsed.agents)) {
    agents[name] = {
      name,
      description: preset.description,
      provider: preset.provider ?? env.DEFAULT_PROVIDER,
      model: preset.model ?? env.DEFAULT_MODEL,
      system_prompt: preset.system_prompt,
      mcp_servers: preset.mcp_servers,
      max_iterations: preset.max_iterations ?? env.MAX_AGENT_ITERATIONS,
      max_tokens: preset.max_tokens,
      temperature: preset.temperature
    };
  }
  return { agents };
}
function getAgentConfig(config, agentId) {
  const agent = config.agents[agentId];
  if (!agent) {
    const available = Object.keys(config.agents).join(", ");
    throw new Error(`Unknown agent_id: ${agentId}. Available agents: ${available}`);
  }
  return agent;
}
function validateAgentsAgainstMCPServers(agentsConfig, mcpServersConfig) {
  const availableServerNames = new Set(Object.keys(mcpServersConfig.servers));
  const missingMappings = [];
  for (const [agentId, agent] of Object.entries(agentsConfig.agents)) {
    for (const serverName of agent.mcp_servers) {
      if (!availableServerNames.has(serverName)) {
        missingMappings.push(`${agentId} -> ${serverName}`);
      }
    }
  }
  if (missingMappings.length > 0) {
    throw new Error(
      `agents.json references undefined MCP server(s): ${missingMappings.join(", ")}`
    );
  }
}

// src/config/env.ts
import path2 from "path";
import { config as loadDotEnv } from "dotenv";
import { z as z2 } from "zod";

// src/utils/logger.ts
var LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};
var Logger = class {
  minLevel;
  constructor(level = "info") {
    this.minLevel = level;
  }
  debug(message, metadata) {
    this.log("debug", message, metadata);
  }
  info(message, metadata) {
    this.log("info", message, metadata);
  }
  warn(message, metadata) {
    this.log("warn", message, metadata);
  }
  error(message, metadata) {
    this.log("error", message, metadata);
  }
  log(level, message, metadata) {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) {
      return;
    }
    const payload = {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      message,
      ...metadata ? { metadata } : {}
    };
    const serialized = JSON.stringify(payload);
    if (level === "error" || level === "warn") {
      console.error(serialized);
      return;
    }
    console.log(serialized);
  }
};
var configuredLevel = process.env.LOG_LEVEL ?? "info";
var logger = new Logger(configuredLevel);

// src/config/env.ts
var PROVIDERS = ["openai", "anthropic", "google"];
var DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
var DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
var DEFAULT_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
var BooleanEnvSchema = z2.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return value;
}, z2.boolean());
var EnvSchema = z2.object({
  OPENAI_API_KEY: z2.string().trim().optional(),
  ANTHROPIC_API_KEY: z2.string().trim().optional(),
  GOOGLE_API_KEY: z2.string().trim().optional(),
  OPENAI_BASE_URL: z2.string().trim().optional(),
  ANTHROPIC_BASE_URL: z2.string().trim().optional(),
  GOOGLE_BASE_URL: z2.string().trim().optional(),
  DEFAULT_PROVIDER: z2.enum(PROVIDERS).default("anthropic"),
  DEFAULT_MODEL: z2.string().trim().min(1).default("claude-sonnet-4-20250514"),
  MAX_AGENT_ITERATIONS: z2.coerce.number().int().positive().default(15),
  MAX_PARALLEL_AGENTS: z2.coerce.number().int().min(1).max(20).default(5),
  AGENT_TIMEOUT_MS: z2.coerce.number().int().min(1e3).default(12e4),
  STRICT_CONFIG_VALIDATION: BooleanEnvSchema.default(true),
  RATE_LIMIT_CAPACITY: z2.coerce.number().min(1).default(10),
  RATE_LIMIT_REFILL_PER_SECOND: z2.coerce.number().positive().default(5)
});
var cachedEnv = null;
function loadEnv(envPath = path2.resolve(process.cwd(), ".env")) {
  if (cachedEnv) {
    return cachedEnv;
  }
  loadDotEnv({ path: envPath });
  const parsed = EnvSchema.parse(process.env);
  const normalized = {
    OPENAI_API_KEY: normalizeOptional(parsed.OPENAI_API_KEY),
    ANTHROPIC_API_KEY: normalizeOptional(parsed.ANTHROPIC_API_KEY),
    GOOGLE_API_KEY: normalizeOptional(parsed.GOOGLE_API_KEY),
    OPENAI_BASE_URL: normalizeBaseUrl(parsed.OPENAI_BASE_URL, DEFAULT_OPENAI_BASE_URL),
    ANTHROPIC_BASE_URL: normalizeBaseUrl(parsed.ANTHROPIC_BASE_URL, DEFAULT_ANTHROPIC_BASE_URL),
    GOOGLE_BASE_URL: normalizeBaseUrl(parsed.GOOGLE_BASE_URL, DEFAULT_GOOGLE_BASE_URL),
    DEFAULT_PROVIDER: parsed.DEFAULT_PROVIDER,
    DEFAULT_MODEL: parsed.DEFAULT_MODEL,
    MAX_AGENT_ITERATIONS: parsed.MAX_AGENT_ITERATIONS,
    MAX_PARALLEL_AGENTS: parsed.MAX_PARALLEL_AGENTS,
    AGENT_TIMEOUT_MS: parsed.AGENT_TIMEOUT_MS,
    STRICT_CONFIG_VALIDATION: parsed.STRICT_CONFIG_VALIDATION,
    RATE_LIMIT_CAPACITY: parsed.RATE_LIMIT_CAPACITY,
    RATE_LIMIT_REFILL_PER_SECOND: parsed.RATE_LIMIT_REFILL_PER_SECOND
  };
  const providerApiKeys = {
    openai: normalized.OPENAI_API_KEY,
    anthropic: normalized.ANTHROPIC_API_KEY,
    google: normalized.GOOGLE_API_KEY
  };
  const enabledProviders = PROVIDERS.filter((provider) => Boolean(providerApiKeys[provider]));
  for (const provider of PROVIDERS) {
    if (!providerApiKeys[provider]) {
      logger.warn(`${provider} disabled (no API key)`);
    }
  }
  if (enabledProviders.length === 0) {
    throw new Error("At least one LLM API key is required (OPENAI/ANTHROPIC/GOOGLE).");
  }
  let defaultProvider = normalized.DEFAULT_PROVIDER;
  if (!providerApiKeys[defaultProvider]) {
    defaultProvider = enabledProviders[0];
    logger.warn("DEFAULT_PROVIDER is unavailable; falling back to first enabled provider", {
      requested: normalized.DEFAULT_PROVIDER,
      fallback: defaultProvider
    });
  }
  cachedEnv = {
    ...normalized,
    DEFAULT_PROVIDER: defaultProvider,
    providerApiKeys,
    enabledProviders
  };
  return cachedEnv;
}
function normalizeOptional(value) {
  if (!value) {
    return void 0;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : void 0;
}
function normalizeBaseUrl(value, fallback) {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return fallback;
  }
  return trimmed.replace(/\/+$/g, "");
}

// src/config/mcp-servers.ts
import { readFileSync as readFileSync2 } from "fs";
import path3 from "path";
import { z as z3 } from "zod";
var MCPServerSchema = z3.object({
  command: z3.string().min(1),
  args: z3.array(z3.string()).default([]),
  env: z3.record(z3.string()).default({}),
  cwd: z3.string().optional(),
  description: z3.string().optional()
});
var MCPServersConfigSchema = z3.object({
  servers: z3.record(MCPServerSchema)
});
function loadMCPServersConfig(filePath = path3.resolve(process.cwd(), "mcp-servers.json"), options = {}) {
  const raw = readFileSync2(filePath, "utf-8");
  const parsed = MCPServersConfigSchema.parse(JSON.parse(raw));
  const strictEnv = options.strictEnv ?? true;
  const resolvedServers = {};
  for (const [name, config] of Object.entries(parsed.servers)) {
    const resolvedEnv = {};
    for (const [key, value] of Object.entries(config.env)) {
      resolvedEnv[key] = resolveEnvTemplate(value, {
        strict: strictEnv,
        serverName: name,
        envKey: key
      });
    }
    resolvedServers[name] = {
      ...config,
      env: resolvedEnv
    };
  }
  return {
    servers: resolvedServers
  };
}
function resolveEnvTemplate(value, options) {
  const unresolvedVariables = /* @__PURE__ */ new Set();
  const resolvedValue = value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, variableName) => {
    const resolved = process.env[variableName];
    if (resolved === void 0 || resolved.length === 0) {
      unresolvedVariables.add(variableName);
      return "";
    }
    return resolved;
  });
  if (unresolvedVariables.size > 0 && options.strict) {
    const names = [...unresolvedVariables].join(", ");
    throw new Error(
      `Missing environment variable(s) for MCP server "${options.serverName}" (${options.envKey}): ${names}`
    );
  }
  return resolvedValue;
}

// src/mcp-client/manager.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
var MCPClientManager = class {
  connections = /* @__PURE__ */ new Map();
  serverConfigs = /* @__PURE__ */ new Map();
  serverHealth = /* @__PURE__ */ new Map();
  reconnectTimers = /* @__PURE__ */ new Map();
  inFlightConnections = /* @__PURE__ */ new Map();
  async initialize(serversConfig) {
    const entries = Object.entries(serversConfig.servers);
    for (const [name, config] of entries) {
      this.serverConfigs.set(name, config);
      this.serverHealth.set(name, {
        status: "disconnected",
        retry_count: 0
      });
    }
    await Promise.all(
      entries.map(async ([name]) => {
        try {
          await this.ensureConnected(name);
        } catch (error) {
          this.recordConnectionFailure(name, error);
          this.scheduleReconnect(name);
        }
      })
    );
  }
  getTools(serverName) {
    return this.connections.get(serverName)?.tools ?? [];
  }
  getToolsForAgent(serverNames) {
    const allTools = [];
    for (const serverName of serverNames) {
      const tools = this.getTools(serverName);
      for (const tool of tools) {
        allTools.push({
          name: `${serverName}__${tool.name}`,
          description: `[${serverName}] ${tool.description}`,
          input_schema: tool.input_schema
        });
      }
    }
    return allTools;
  }
  getServerHealth(serverName) {
    return this.serverHealth.get(serverName) ?? { status: "disconnected", retry_count: 0 };
  }
  getAllServerHealth() {
    const payload = {};
    for (const serverName of this.serverConfigs.keys()) {
      payload[serverName] = this.getServerHealth(serverName);
    }
    return payload;
  }
  async callTool(prefixedToolName, args, options = {}) {
    const [serverName, toolName] = splitPrefixedToolName(prefixedToolName);
    await this.ensureConnected(serverName);
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(`MCP server is not connected: ${serverName}`);
    }
    if (options.signal?.aborted) {
      const abortError = new Error(`Tool call aborted: ${prefixedToolName}`);
      abortError.name = "AbortError";
      throw abortError;
    }
    let result;
    try {
      const callPromise = connection.client.callTool({
        name: toolName,
        arguments: args
      });
      if (options.signal) {
        result = await raceWithAbort(callPromise, options.signal, `Tool call aborted: ${prefixedToolName}`);
      } else {
        result = await callPromise;
      }
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      this.recordConnectionFailure(serverName, error);
      this.scheduleReconnect(serverName);
      throw error;
    }
    const text = extractToolResultText(result);
    if (result.isError) {
      throw new Error(text || `Tool call failed: ${prefixedToolName}`);
    }
    return text;
  }
  async shutdown() {
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    await Promise.allSettled(
      [...this.connections.values()].map(async (connection) => {
        await connection.client.close();
      })
    );
    this.connections.clear();
  }
  async ensureConnected(name) {
    if (this.connections.has(name)) {
      return;
    }
    const existingAttempt = this.inFlightConnections.get(name);
    if (existingAttempt) {
      await existingAttempt;
      return;
    }
    const attempt = this.connectServer(name).finally(() => {
      this.inFlightConnections.delete(name);
    });
    this.inFlightConnections.set(name, attempt);
    await attempt;
  }
  async connectServer(name) {
    const config = this.serverConfigs.get(name);
    if (!config) {
      throw new Error(`Unknown MCP server: ${name}`);
    }
    const existingConnection = this.connections.get(name);
    if (existingConnection) {
      try {
        await existingConnection.client.close();
      } catch {
      }
      this.connections.delete(name);
    }
    const client = new Client({
      name: `mcp-subagent-${name}`,
      version: "1.0.0"
    });
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      ...config.cwd ? { cwd: config.cwd } : {},
      env: {
        ...process.env,
        ...config.env
      }
    });
    await client.connect(transport);
    const toolList = await client.listTools();
    const tools = (toolList.tools ?? []).map((tool) => {
      const normalized = tool;
      return {
        name: normalized.name ?? "unknown_tool",
        description: normalized.description ?? "",
        input_schema: normalized.inputSchema ?? normalized.input_schema ?? { type: "object", properties: {} }
      };
    });
    this.connections.set(name, {
      name,
      config,
      client,
      transport,
      tools
    });
    this.clearReconnect(name);
    this.serverHealth.set(name, {
      status: "connected",
      retry_count: 0
    });
    logger.info("Connected MCP server", {
      server: name,
      toolCount: tools.length
    });
  }
  recordConnectionFailure(name, error) {
    const previous = this.serverHealth.get(name);
    const retryCount = (previous?.retry_count ?? 0) + 1;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const connection = this.connections.get(name);
    if (connection) {
      void connection.client.close().catch(() => {
      });
      this.connections.delete(name);
    }
    this.serverHealth.set(name, {
      status: "disconnected",
      retry_count: retryCount,
      last_error: errorMessage
    });
    logger.warn("MCP server connection failure", {
      server: name,
      retryCount,
      error: errorMessage
    });
  }
  scheduleReconnect(name) {
    if (this.reconnectTimers.has(name)) {
      return;
    }
    const health = this.getServerHealth(name);
    const attempt = Math.max(1, health.retry_count);
    const delayMs = Math.min(3e4, 1e3 * Math.pow(2, Math.min(6, attempt - 1)));
    this.serverHealth.set(name, {
      ...health,
      status: "reconnecting"
    });
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(name);
      void this.ensureConnected(name).catch((error) => {
        this.recordConnectionFailure(name, error);
        this.scheduleReconnect(name);
      });
    }, delayMs);
    this.reconnectTimers.set(name, timer);
  }
  clearReconnect(name) {
    const timer = this.reconnectTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(name);
    }
  }
};
function splitPrefixedToolName(prefixedToolName) {
  const delimiterIndex = prefixedToolName.indexOf("__");
  if (delimiterIndex <= 0 || delimiterIndex >= prefixedToolName.length - 2) {
    throw new Error(`Invalid prefixed tool name: ${prefixedToolName}`);
  }
  const serverName = prefixedToolName.slice(0, delimiterIndex);
  const toolName = prefixedToolName.slice(delimiterIndex + 2);
  return [serverName, toolName];
}
async function raceWithAbort(promise, signal, message) {
  if (signal.aborted) {
    const abortError = new Error(message);
    abortError.name = "AbortError";
    throw abortError;
  }
  return await new Promise((resolve, reject) => {
    const onAbort = () => {
      const abortError = new Error(message);
      abortError.name = "AbortError";
      reject(abortError);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then((result) => {
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    }).catch((error) => {
      signal.removeEventListener("abort", onAbort);
      reject(error);
    });
  });
}
function isAbortError(error) {
  return error instanceof Error && error.name === "AbortError";
}
function extractToolResultText(result) {
  const content = result.content ?? [];
  if (content.length === 0) {
    return "";
  }
  const text = content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n").trim();
  if (text.length > 0) {
    return text;
  }
  return JSON.stringify(content);
}

// src/server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// src/orchestrator/delegate.ts
import { randomUUID } from "crypto";

// src/utils/token-counter.ts
var TokenCounter = class {
  usage = { input: 0, output: 0 };
  add(inputTokens, outputTokens) {
    this.usage.input += Math.max(0, inputTokens);
    this.usage.output += Math.max(0, outputTokens);
  }
  snapshot() {
    return { ...this.usage };
  }
};

// src/agent/context.ts
var AgentConversationContext = class {
  messages = [];
  addUser(content) {
    this.messages.push({ role: "user", content });
  }
  addAssistant(content, toolCalls) {
    this.messages.push({
      role: "assistant",
      content,
      ...toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}
    });
  }
  addToolResults(results) {
    this.messages.push({ role: "tool_result", content: results });
  }
  getMessages() {
    return [...this.messages];
  }
  getLastText() {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      const message = this.messages[i];
      if (typeof message.content === "string" && message.content.trim().length > 0) {
        return message.content;
      }
    }
    return "";
  }
};

// src/agent/runtime.ts
async function runAgent(agentConfig, task, context, llmClient, mcpManager, options = {}) {
  const conversation = new AgentConversationContext();
  const tools = mcpManager.getToolsForAgent(agentConfig.mcp_servers);
  const startedAt = Date.now();
  const initialMessage = context ? `## Previous Context
${context}

## Current Task
${task}` : task;
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
        stopReason: "aborted"
      });
    }
    iterations += 1;
    let response;
    try {
      const invocation = await invokeLLMWithRetries(
        async () => {
          if (options.rateLimiter) {
            await options.rateLimiter.consume(1);
          }
          return await llmClient.chat({
            model: agentConfig.model,
            system_prompt: agentConfig.system_prompt,
            messages: conversation.getMessages(),
            tools: tools.length > 0 ? tools : void 0,
            temperature: agentConfig.temperature,
            max_tokens: agentConfig.max_tokens,
            signal: options.signal
          });
        },
        maxLlmRetriesPerIteration,
        options.signal
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
        stopReason: "error"
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
        stopReason: response.stop_reason
      });
    }
    conversation.addAssistant(response.content, response.tool_calls);
    const toolResults = [];
    for (const toolCall of response.tool_calls) {
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
          stopReason: "aborted"
        });
      }
      toolCallsMade += 1;
      try {
        const result = await mcpManager.callTool(toolCall.name, toolCall.arguments, {
          signal: options.signal
        });
        toolResults.push({
          tool_call_id: toolCall.id,
          tool_name: toolCall.name,
          result
        });
      } catch (error) {
        toolResults.push({
          tool_call_id: toolCall.id,
          tool_name: toolCall.name,
          result: `Error: ${error instanceof Error ? error.message : String(error)}`,
          is_error: true
        });
      }
    }
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
    stopReason: "max_iterations"
  });
}
async function invokeLLMWithRetries(call, maxRetries, signal) {
  let lastError;
  let retryCount = 0;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await call();
      return {
        response,
        retryCount
      };
    } catch (error) {
      if (isAbortError2(error)) {
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
function isRetryableLLMError(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  if (isAbortError2(error)) {
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
function isAbortError2(error) {
  return error instanceof Error && error.name === "AbortError";
}
async function sleepWithBackoff(attempt, signal) {
  const baseDelayMs = 300 * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * (baseDelayMs * 0.2));
  const waitMs = baseDelayMs + jitter;
  await new Promise((resolve) => {
    if (!signal) {
      setTimeout(resolve, waitMs);
      return;
    }
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, waitMs);
    signal.addEventListener("abort", onAbort);
  });
}
function createResult(params) {
  return {
    agent_id: params.agentConfig.name,
    final_response: params.finalResponse ?? "",
    iterations: params.iterations,
    tool_calls_made: params.toolCallsMade,
    total_tokens: params.tokenCounter.snapshot(),
    ...params.options.runId ? { run_id: params.options.runId } : {},
    duration_ms: Date.now() - params.startedAt,
    retries: params.retries,
    ...params.stopReason ? { stop_reason: params.stopReason } : {},
    ...params.error ? { error: params.error } : {}
  };
}

// src/llm/retry.ts
async function postJsonWithRetry(url, init, options) {
  const maxRetries = options?.maxRetries ?? 2;
  const initialDelayMs = options?.initialDelayMs ?? 300;
  const signal = options?.signal;
  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (signal?.aborted) {
      throw toAbortError();
    }
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...init.headers
        },
        body: JSON.stringify(init.body),
        ...signal ? { signal } : {}
      });
      if (!response.ok) {
        const text = await response.text();
        const error = new Error(`HTTP ${response.status}: ${text}`);
        if (attempt < maxRetries && isRetryableStatus(response.status)) {
          await sleepWithAbort(backoffWithJitter(initialDelayMs, attempt), signal);
          continue;
        }
        throw error;
      }
      return await response.json();
    } catch (error) {
      if (isAbortError3(error)) {
        throw error;
      }
      lastError = error;
      if (attempt >= maxRetries || !isRetryableNetworkError(error)) {
        break;
      }
      await sleepWithAbort(backoffWithJitter(initialDelayMs, attempt), signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
function isRetryableStatus(status) {
  if (status >= 500 && status <= 599) {
    return true;
  }
  return status === 408 || status === 409 || status === 425 || status === 429;
}
function isRetryableNetworkError(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  if (isAbortError3(error)) {
    return false;
  }
  if (error.name === "TypeError") {
    return true;
  }
  const message = error.message.toLowerCase();
  return message.includes("network") || message.includes("timed out") || message.includes("socket");
}
function isAbortError3(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "AbortError";
}
function toAbortError() {
  const abortError = new Error("The operation was aborted");
  abortError.name = "AbortError";
  return abortError;
}
function backoffWithJitter(initialDelayMs, attempt) {
  const base = initialDelayMs * Math.pow(2, attempt);
  const jitter = Math.floor(base * 0.2 * Math.random());
  return base + jitter;
}
function sleepWithAbort(ms, signal) {
  return new Promise((resolve) => {
    if (!signal) {
      setTimeout(resolve, ms);
      return;
    }
    if (signal.aborted) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort);
  });
}

// src/llm/openai-client.ts
var OpenAIClient = class {
  constructor(apiKey, baseUrl) {
    this.apiKey = apiKey;
    this.baseUrl = stripTrailingSlash(baseUrl);
  }
  provider = "openai";
  baseUrl;
  async chat(request) {
    const body = {
      model: request.model,
      messages: toOpenAIMessages(request.system_prompt, request.messages),
      temperature: request.temperature
    };
    if (typeof request.max_tokens === "number") {
      body.max_tokens = request.max_tokens;
    }
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(toOpenAIToolDefinition);
    }
    const response = await postJsonWithRetry(
      `${this.baseUrl}/chat/completions`,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`
        },
        body
      },
      {
        signal: request.signal
      }
    );
    const choice = response.choices?.[0];
    if (!choice?.message) {
      throw new Error("OpenAI returned no choices");
    }
    const toolCalls = parseOpenAIToolCalls(choice.message.tool_calls);
    const stopReason = toolCalls.length > 0 || choice.finish_reason === "tool_calls" ? "tool_use" : choice.finish_reason === "length" ? "max_tokens" : "end_turn";
    return {
      content: normalizeText(choice.message.content),
      tool_calls: toolCalls.length > 0 ? toolCalls : void 0,
      usage: {
        input_tokens: response.usage?.prompt_tokens ?? 0,
        output_tokens: response.usage?.completion_tokens ?? 0
      },
      stop_reason: stopReason,
      raw_stop_reason: choice.finish_reason ?? void 0
    };
  }
};
function toOpenAIMessages(systemPrompt, messages) {
  const mapped = [
    {
      role: "system",
      content: systemPrompt
    }
  ];
  for (const message of messages) {
    if (message.role === "user") {
      mapped.push({ role: "user", content: String(message.content) });
      continue;
    }
    if (message.role === "assistant") {
      const toolCalls = (message.tool_calls ?? []).map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments ?? {})
        }
      }));
      mapped.push({
        role: "assistant",
        content: normalizeAssistantText(message.content),
        ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {}
      });
      continue;
    }
    const results = Array.isArray(message.content) ? message.content : [];
    for (const result of results) {
      mapped.push({
        role: "tool",
        tool_call_id: result.tool_call_id,
        content: result.result
      });
    }
  }
  return mapped;
}
function toOpenAIToolDefinition(tool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema
    }
  };
}
function parseOpenAIToolCalls(rawCalls) {
  if (!rawCalls || rawCalls.length === 0) {
    return [];
  }
  return rawCalls.filter((call) => call?.function?.name).map((call, index) => ({
    id: call.id ?? `openai-tool-call-${index + 1}`,
    name: call.function?.name ?? "",
    arguments: parseArguments(call.function?.arguments)
  }));
}
function parseArguments(raw) {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed;
    }
    return {};
  } catch {
    return {};
  }
}
function normalizeText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("\n").trim();
  }
  return "";
}
function normalizeAssistantText(content) {
  if (typeof content === "string") {
    return content;
  }
  return "";
}
function stripTrailingSlash(value) {
  return value.replace(/\/+$/g, "");
}

// src/llm/anthropic-client.ts
var AnthropicClient = class {
  constructor(apiKey, baseUrl) {
    this.apiKey = apiKey;
    this.baseUrl = stripTrailingSlash2(baseUrl);
  }
  provider = "anthropic";
  baseUrl;
  async chat(request) {
    const response = await postJsonWithRetry(`${this.baseUrl}/messages`, {
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: {
        model: request.model,
        system: request.system_prompt,
        max_tokens: request.max_tokens ?? 2048,
        temperature: request.temperature,
        messages: toAnthropicMessages(request.messages),
        ...request.tools && request.tools.length > 0 ? {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.input_schema
          }))
        } : {}
      }
    }, {
      signal: request.signal
    });
    const blocks = response.content ?? [];
    const text = blocks.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
    const toolCalls = blocks.filter((block) => block.type === "tool_use").map((block) => ({
      id: block.id,
      name: block.name,
      arguments: block.input ?? {}
    }));
    const stopReason = toolCalls.length > 0 || response.stop_reason === "tool_use" ? "tool_use" : response.stop_reason === "max_tokens" ? "max_tokens" : "end_turn";
    return {
      content: text,
      tool_calls: toolCalls.length > 0 ? toolCalls : void 0,
      usage: {
        input_tokens: response.usage?.input_tokens ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0
      },
      stop_reason: stopReason,
      raw_stop_reason: response.stop_reason ?? void 0
    };
  }
};
function toAnthropicMessages(messages) {
  const mapped = [];
  for (const message of messages) {
    if (message.role === "user") {
      mapped.push({
        role: "user",
        content: [
          {
            type: "text",
            text: String(message.content)
          }
        ]
      });
      continue;
    }
    if (message.role === "assistant") {
      const content2 = [];
      if (typeof message.content === "string" && message.content.trim().length > 0) {
        content2.push({ type: "text", text: message.content });
      }
      for (const toolCall of message.tool_calls ?? []) {
        content2.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.arguments
        });
      }
      if (content2.length === 0) {
        content2.push({ type: "text", text: "" });
      }
      mapped.push({ role: "assistant", content: content2 });
      continue;
    }
    const content = [];
    const results = Array.isArray(message.content) ? message.content : [];
    for (const result of results) {
      content.push({
        type: "tool_result",
        tool_use_id: result.tool_call_id,
        content: result.result,
        ...result.is_error ? { is_error: true } : {}
      });
    }
    if (content.length === 0) {
      content.push({ type: "text", text: String(message.content) });
    }
    mapped.push({ role: "user", content });
  }
  return mapped;
}
function stripTrailingSlash2(value) {
  return value.replace(/\/+$/g, "");
}

// src/llm/google-client.ts
var GoogleClient = class {
  constructor(apiKey, baseUrl) {
    this.apiKey = apiKey;
    this.baseUrl = stripTrailingSlash3(baseUrl);
  }
  provider = "google";
  baseUrl;
  async chat(request) {
    const generationConfig = {};
    if (typeof request.temperature === "number") {
      generationConfig.temperature = request.temperature;
    }
    if (typeof request.max_tokens === "number") {
      generationConfig.maxOutputTokens = request.max_tokens;
    }
    const response = await postJsonWithRetry(
      `${this.baseUrl}/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      {
        headers: {},
        body: {
          systemInstruction: {
            parts: [{ text: request.system_prompt }]
          },
          contents: toGeminiContents(request.messages),
          ...request.tools && request.tools.length > 0 ? {
            tools: [
              {
                functionDeclarations: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.input_schema
                }))
              }
            ]
          } : {},
          ...Object.keys(generationConfig).length > 0 ? { generationConfig } : {}
        }
      },
      {
        signal: request.signal
      }
    );
    const candidate = response.candidates?.[0];
    if (!candidate) {
      throw new Error("Google Gemini returned no candidates");
    }
    const parts = candidate.content?.parts ?? [];
    const text = parts.filter((part) => "text" in part).map((part) => part.text).join("\n").trim();
    const toolCalls = parts.filter(
      (part) => "functionCall" in part
    ).map((part, index) => ({
      id: part.functionCall.id ?? `google-tool-call-${index + 1}`,
      name: part.functionCall.name,
      arguments: part.functionCall.args ?? {}
    }));
    const stopReason = toolCalls.length > 0 ? "tool_use" : candidate.finishReason === "MAX_TOKENS" ? "max_tokens" : "end_turn";
    return {
      content: text,
      tool_calls: toolCalls.length > 0 ? toolCalls : void 0,
      usage: {
        input_tokens: response.usageMetadata?.promptTokenCount ?? 0,
        output_tokens: response.usageMetadata?.candidatesTokenCount ?? 0
      },
      stop_reason: stopReason,
      raw_stop_reason: candidate.finishReason
    };
  }
};
function toGeminiContents(messages) {
  const mapped = [];
  const toolNameByCallId = /* @__PURE__ */ new Map();
  for (const message of messages) {
    if (message.role === "user") {
      mapped.push({
        role: "user",
        parts: [{ text: String(message.content) }]
      });
      continue;
    }
    if (message.role === "assistant") {
      const parts2 = [];
      if (typeof message.content === "string" && message.content.trim().length > 0) {
        parts2.push({ text: message.content });
      }
      for (const toolCall of message.tool_calls ?? []) {
        toolNameByCallId.set(toolCall.id, toolCall.name);
        parts2.push({
          functionCall: {
            name: toolCall.name,
            args: toolCall.arguments,
            id: toolCall.id
          }
        });
      }
      if (parts2.length === 0) {
        parts2.push({ text: "" });
      }
      mapped.push({ role: "model", parts: parts2 });
      continue;
    }
    const parts = [];
    const results = Array.isArray(message.content) ? message.content : [];
    for (const result of results) {
      const resolvedName = result.tool_name ?? toolNameByCallId.get(result.tool_call_id);
      if (!resolvedName) {
        parts.push({
          text: `Tool result (${result.tool_call_id}): ${result.result}`
        });
        continue;
      }
      parts.push({
        functionResponse: {
          name: resolvedName,
          response: {
            content: result.result,
            is_error: Boolean(result.is_error)
          }
        }
      });
    }
    if (parts.length === 0) {
      parts.push({ text: typeof message.content === "string" ? message.content : "" });
    }
    mapped.push({ role: "user", parts });
  }
  return mapped;
}
function stripTrailingSlash3(value) {
  return value.replace(/\/+$/g, "");
}

// src/llm/factory.ts
function createLLMClient(provider, apiKey, baseUrls) {
  switch (provider) {
    case "openai":
      return new OpenAIClient(apiKey, baseUrls.openai);
    case "anthropic":
      return new AnthropicClient(apiKey, baseUrls.anthropic);
    case "google":
      return new GoogleClient(apiKey, baseUrls.google);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

// src/utils/rate-limiter.ts
var TokenBucketRateLimiter = class {
  constructor(capacity, refillPerSecond) {
    this.capacity = capacity;
    this.refillPerSecond = refillPerSecond;
    this.tokens = capacity;
    this.lastRefillMs = Date.now();
  }
  tokens;
  lastRefillMs;
  async consume(amount = 1) {
    if (amount <= 0) {
      return;
    }
    while (true) {
      this.refill();
      if (this.tokens >= amount) {
        this.tokens -= amount;
        return;
      }
      const missingTokens = amount - this.tokens;
      const waitMs = Math.ceil(missingTokens / this.refillPerSecond * 1e3);
      await sleep(Math.max(waitMs, 10));
    }
  }
  refill() {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillMs;
    if (elapsedMs <= 0) {
      return;
    }
    const refillAmount = elapsedMs / 1e3 * this.refillPerSecond;
    this.tokens = Math.min(this.capacity, this.tokens + refillAmount);
    this.lastRefillMs = now;
  }
};
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// src/orchestrator/delegate.ts
function createDelegateTaskExecutor(deps) {
  const providerRateLimiters = createProviderRateLimiters(deps.env);
  const providerBaseUrls = createProviderBaseUrls(deps.env);
  return async (agentId, task, context) => {
    const runId = randomUUID();
    try {
      const agentConfig = getAgentConfig(deps.agentsConfig, agentId);
      const apiKey = deps.env.providerApiKeys[agentConfig.provider];
      if (!apiKey) {
        return createErrorResult(agentId, `${agentConfig.provider} API key is not configured`, runId);
      }
      const llmClient = createLLMClient(agentConfig.provider, apiKey, providerBaseUrls);
      const abortController = new AbortController();
      const execution = runAgent(agentConfig, task, context, llmClient, deps.mcpManager, {
        signal: abortController.signal,
        runId,
        rateLimiter: providerRateLimiters[agentConfig.provider]
      });
      return await withTimeout(
        execution,
        deps.env.AGENT_TIMEOUT_MS,
        () => {
          abortController.abort();
        },
        `Agent timed out after ${deps.env.AGENT_TIMEOUT_MS} ms`
      );
    } catch (error) {
      return createErrorResult(agentId, error instanceof Error ? error.message : String(error), runId);
    }
  };
}
function createProviderRateLimiters(env) {
  return {
    openai: new TokenBucketRateLimiter(env.RATE_LIMIT_CAPACITY, env.RATE_LIMIT_REFILL_PER_SECOND),
    anthropic: new TokenBucketRateLimiter(env.RATE_LIMIT_CAPACITY, env.RATE_LIMIT_REFILL_PER_SECOND),
    google: new TokenBucketRateLimiter(env.RATE_LIMIT_CAPACITY, env.RATE_LIMIT_REFILL_PER_SECOND)
  };
}
function createProviderBaseUrls(env) {
  return {
    openai: env.OPENAI_BASE_URL,
    anthropic: env.ANTHROPIC_BASE_URL,
    google: env.GOOGLE_BASE_URL
  };
}
function createErrorResult(agentId, message, runId) {
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
    error: message
  };
}
async function withTimeout(promise, timeoutMs, onTimeout, message) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
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

// src/orchestrator/ensemble.ts
function createEnsembleTaskExecutor(deps) {
  return async function ensembleTask(input) {
    const individualResults = await mapWithConcurrency(
      input.agentIds,
      Math.max(1, deps.maxParallelAgents),
      async (agentId) => deps.delegateTask(agentId, input.task)
    );
    let synthesis = "";
    let synthesisAgentId;
    let synthesisError;
    let synthesisTokens = { input: 0, output: 0 };
    if (input.synthesize) {
      synthesisAgentId = input.synthesizerAgentId ?? input.agentIds[0];
      const synthContext = individualResults.map((result) => `### ${result.agent_id}
${result.final_response || result.error || "[no output]"}`).join("\n\n");
      const synthResult = await deps.delegateTask(
        synthesisAgentId,
        "\uFFFD\u01B7\uFFFD \uFFFD\uFFFD\uFFFD\uFFFD \uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\u01AE\uFFFD\uFFFD \uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\uFFFD \uFFFD\uFFFD\uFFFD\uFFFD\uFFFD\u03FF\uFFFD \uFFFD\u03F3\uFFFD\uFFFD\uFFFD \uFFFD\uFFFD\uFFFD\u0575\uFFFD \uFFFD\u4EAF\uFFFD\uFFFD \uFFFD\u06FC\uFFFD\uFFFD\u03FC\uFFFD\uFFFD\uFFFD.",
        synthContext
      );
      synthesis = synthResult.final_response;
      synthesisError = synthResult.error;
      synthesisTokens = {
        input: synthResult.total_tokens.input,
        output: synthResult.total_tokens.output
      };
    }
    const totalTokens = sumTokens(individualResults);
    totalTokens.input += synthesisTokens.input;
    totalTokens.output += synthesisTokens.output;
    return {
      individual_results: individualResults,
      synthesis,
      total_tokens: totalTokens,
      ...synthesisAgentId ? { synthesis_agent_id: synthesisAgentId } : {},
      ...synthesisError ? { synthesis_error: synthesisError } : {}
    };
  };
}
async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) {
        return;
      }
      results[current] = await worker(items[current], current);
    }
  });
  await Promise.all(runners);
  return results;
}
function sumTokens(results) {
  return results.reduce(
    (acc, result) => {
      acc.input += result.total_tokens.input;
      acc.output += result.total_tokens.output;
      return acc;
    },
    { input: 0, output: 0 }
  );
}

// src/orchestrator/pipeline.ts
function createPipelineTaskExecutor(deps) {
  return async function pipelineTask(steps) {
    const stepResults = [];
    const totalTokens = { input: 0, output: 0 };
    let previousOutput = "";
    let pipelineError;
    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const result = await deps.delegateTask(step.agent_id, step.task, previousOutput || void 0);
      stepResults.push({
        step: index + 1,
        agent_id: step.agent_id,
        result
      });
      totalTokens.input += result.total_tokens.input;
      totalTokens.output += result.total_tokens.output;
      previousOutput = result.final_response;
      if (result.error) {
        pipelineError = `Step ${index + 1} failed (${step.agent_id}): ${result.error}`;
        break;
      }
    }
    return {
      steps: stepResults,
      final_output: previousOutput,
      total_tokens: totalTokens,
      ...pipelineError ? { error: pipelineError } : {}
    };
  };
}

// src/tools/delegate-task.ts
import { z as z4 } from "zod";
var schema = z4.object({
  agent_id: z4.string().describe("\uC791\uC5C5\uC744 \uC704\uC784\uD560 \uC5D0\uC774\uC804\uD2B8 ID"),
  task: z4.string().describe("\uC5D0\uC774\uC804\uD2B8\uC5D0\uAC8C \uC804\uB2EC\uD560 \uC791\uC5C5 \uC9C0\uC2DC\uBB38"),
  context: z4.string().optional().describe("\uCD94\uAC00 \uCEE8\uD14D\uC2A4\uD2B8")
});
function registerDelegateTaskTool(server, deps) {
  const description = `\uD2B9\uC815 \uC11C\uBE0C \uC5D0\uC774\uC804\uD2B8\uC5D0\uAC8C \uB2E8\uC77C \uC791\uC5C5\uC744 \uC704\uC784\uD569\uB2C8\uB2E4. \uC0AC\uC6A9 \uAC00\uB2A5\uD55C \uC5D0\uC774\uC804\uD2B8: ${deps.availableAgentIds.join(", ")}`;
  server.tool("delegate_task", description, schema.shape, async (args) => {
    const result = await deps.delegateTask(args.agent_id, args.task, args.context);
    const payload = {
      status: result.error ? "error" : "success",
      agent_id: result.agent_id,
      response: result.final_response,
      metadata: {
        run_id: result.run_id,
        duration_ms: result.duration_ms,
        stop_reason: result.stop_reason,
        retries: result.retries ?? 0,
        iterations: result.iterations,
        tool_calls_made: result.tool_calls_made,
        tokens: {
          input: result.total_tokens.input,
          output: result.total_tokens.output
        }
      },
      ...result.error ? { error: result.error } : {}
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
    };
  });
}

// src/tools/ensemble-task.ts
import { z as z5 } from "zod";
var schema2 = z5.object({
  agent_ids: z5.array(z5.string()).min(2).max(5).describe("\uB3D9\uC77C \uC791\uC5C5\uC744 \uC218\uD589\uD560 \uC5D0\uC774\uC804\uD2B8 ID \uBAA9\uB85D"),
  task: z5.string().describe("\uB3D9\uC2DC\uC5D0 \uC218\uD589\uD560 \uC791\uC5C5"),
  synthesize: z5.boolean().default(true).describe("\uACB0\uACFC \uD1B5\uD569 \uC5EC\uBD80"),
  synthesizer_agent_id: z5.string().optional().describe("\uACB0\uACFC \uD1B5\uD569 \uC218\uD589 \uC5D0\uC774\uC804\uD2B8")
});
function registerEnsembleTaskTool(server, deps) {
  const description = `\uC5EC\uB7EC \uC11C\uBE0C \uC5D0\uC774\uC804\uD2B8\uC5D0\uAC8C \uB3D9\uC77C \uC791\uC5C5\uC744 \uBCD1\uB82C\uB85C \uC218\uD589\uC2DC\uD0A4\uACE0 \uACB0\uACFC\uB97C \uD1B5\uD569\uD569\uB2C8\uB2E4. \uC0AC\uC6A9 \uAC00\uB2A5\uD55C \uC5D0\uC774\uC804\uD2B8: ${deps.availableAgentIds.join(", ")}`;
  server.tool("ensemble_task", description, schema2.shape, async (args) => {
    const result = await deps.ensembleTask({
      agentIds: args.agent_ids,
      task: args.task,
      synthesize: args.synthesize,
      synthesizerAgentId: args.synthesizer_agent_id
    });
    const payload = {
      status: result.synthesis_error || result.individual_results.some((item) => item.error) ? "partial_success" : "success",
      synthesis: result.synthesis,
      individual_results: result.individual_results.map((item) => ({
        agent_id: item.agent_id,
        response: item.final_response,
        metadata: {
          run_id: item.run_id,
          duration_ms: item.duration_ms,
          stop_reason: item.stop_reason,
          retries: item.retries ?? 0,
          iterations: item.iterations,
          tool_calls_made: item.tool_calls_made,
          tokens: {
            input: item.total_tokens.input,
            output: item.total_tokens.output
          }
        },
        ...item.error ? { error: item.error } : {}
      })),
      total_tokens: result.total_tokens,
      ...result.synthesis_agent_id ? { synthesis_agent_id: result.synthesis_agent_id } : {},
      ...result.synthesis_error ? { synthesis_error: result.synthesis_error } : {}
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
    };
  });
}

// src/tools/pipeline-task.ts
import { z as z6 } from "zod";
var schema3 = z6.object({
  steps: z6.array(
    z6.object({
      agent_id: z6.string().describe("\uB2E8\uACC4\uB97C \uC218\uD589\uD560 \uC5D0\uC774\uC804\uD2B8 ID"),
      task: z6.string().describe("\uB2E8\uACC4\uC5D0\uC11C \uC218\uD589\uD560 \uC791\uC5C5")
    })
  ).min(2).max(10).describe("\uC21C\uCC28 \uD30C\uC774\uD504\uB77C\uC778 \uB2E8\uACC4")
});
function registerPipelineTaskTool(server, deps) {
  const description = `\uC5EC\uB7EC \uC5D0\uC774\uC804\uD2B8\uB97C \uC21C\uCC28 \uC2E4\uD589\uD558\uB294 \uD30C\uC774\uD504\uB77C\uC778\uC785\uB2C8\uB2E4. \uC774\uC804 \uB2E8\uACC4 \uCD9C\uB825\uC774 \uB2E4\uC74C \uB2E8\uACC4 \uCEE8\uD14D\uC2A4\uD2B8\uB85C \uC804\uB2EC\uB429\uB2C8\uB2E4. \uC0AC\uC6A9 \uAC00\uB2A5\uD55C \uC5D0\uC774\uC804\uD2B8: ${deps.availableAgentIds.join(", ")}`;
  server.tool("pipeline_task", description, schema3.shape, async (args) => {
    const result = await deps.pipelineTask(args.steps);
    const payload = {
      status: result.error ? "error" : "success",
      final_output: result.final_output,
      steps: result.steps.map((step) => ({
        step: step.step,
        agent_id: step.agent_id,
        response: step.result.final_response,
        metadata: {
          run_id: step.result.run_id,
          duration_ms: step.result.duration_ms,
          stop_reason: step.result.stop_reason,
          retries: step.result.retries ?? 0,
          iterations: step.result.iterations,
          tool_calls_made: step.result.tool_calls_made,
          tokens: {
            input: step.result.total_tokens.input,
            output: step.result.total_tokens.output
          }
        },
        ...step.result.error ? { error: step.result.error } : {}
      })),
      total_tokens: result.total_tokens,
      ...result.error ? { error: result.error } : {}
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
    };
  });
}

// src/tools/list-agents.ts
import { z as z7 } from "zod";
var schema4 = z7.object({});
function registerListAgentsTool(server, deps) {
  const description = "\uC0AC\uC6A9 \uAC00\uB2A5\uD55C \uC11C\uBE0C \uC5D0\uC774\uC804\uD2B8 \uBAA9\uB85D\uACFC \uC5ED\uD560/\uBAA8\uB378/\uC811\uADFC \uAC00\uB2A5\uD55C \uB3C4\uAD6C\uB97C \uC870\uD68C\uD569\uB2C8\uB2E4.";
  server.tool("list_agents", description, schema4.shape, async () => {
    const agents = {};
    const serverHealth = deps.mcpManager.getAllServerHealth();
    for (const [agentId, agent] of Object.entries(deps.agentsConfig.agents)) {
      const tools = deps.mcpManager.getToolsForAgent(agent.mcp_servers).map((tool) => tool.name);
      const mcpServers = agent.mcp_servers.map((serverName) => ({
        name: serverName,
        ...serverHealth[serverName] ?? { status: "disconnected", retry_count: 0 }
      }));
      agents[agentId] = {
        description: agent.description,
        provider: agent.provider,
        model: agent.model,
        max_tokens: agent.max_tokens,
        available_tools: tools,
        mcp_servers: mcpServers
      };
    }
    const payload = {
      status: "success",
      agents,
      server_health: serverHealth
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
    };
  });
}

// src/server.ts
function createServer(deps) {
  const server = new McpServer({
    name: "mcp-subagent-server",
    version: "1.0.0"
  });
  const delegateTask = createDelegateTaskExecutor({
    agentsConfig: deps.agentsConfig,
    env: deps.env,
    mcpManager: deps.mcpManager
  });
  const ensembleTask = createEnsembleTaskExecutor({
    delegateTask,
    maxParallelAgents: deps.env.MAX_PARALLEL_AGENTS
  });
  const pipelineTask = createPipelineTaskExecutor({
    delegateTask
  });
  const availableAgentIds = Object.keys(deps.agentsConfig.agents);
  registerDelegateTaskTool(server, {
    delegateTask,
    availableAgentIds
  });
  registerEnsembleTaskTool(server, {
    ensembleTask,
    availableAgentIds
  });
  registerPipelineTaskTool(server, {
    pipelineTask,
    availableAgentIds
  });
  registerListAgentsTool(server, {
    agentsConfig: deps.agentsConfig,
    mcpManager: deps.mcpManager
  });
  return server;
}

// src/index.ts
async function main() {
  const env = loadEnv();
  const mcpServersConfig = loadMCPServersConfig(void 0, {
    strictEnv: env.STRICT_CONFIG_VALIDATION
  });
  const agentsConfig = loadAgentsConfig(env);
  if (env.STRICT_CONFIG_VALIDATION) {
    validateAgentsAgainstMCPServers(agentsConfig, mcpServersConfig);
  }
  const mcpManager = new MCPClientManager();
  await mcpManager.initialize(mcpServersConfig);
  const server = createServer({
    env,
    agentsConfig,
    mcpManager
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info("MCP Sub-Agent Server started", {
    agents: Object.keys(agentsConfig.agents)
  });
  const shutdown = async (signal) => {
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
    error: error instanceof Error ? error.message : String(error)
  });
  process.exit(1);
});
