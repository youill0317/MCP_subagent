import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { MCPServerConfig, MCPServersConfig } from "../config/mcp-servers.js";
import type { ToolDefinition } from "../llm/types.js";
import { logger } from "../utils/logger.js";

interface MCPConnection {
  name: string;
  config: MCPServerConfig;
  client: Client;
  transport: StdioClientTransport;
  tools: ToolDefinition[];
}

export type MCPConnectionHealth = "connected" | "disconnected" | "reconnecting";

export interface MCPServerHealth {
  status: MCPConnectionHealth;
  last_error?: string;
  retry_count: number;
}

interface ToolCallOptions {
  signal?: AbortSignal;
}

export class MCPClientManager {
  private readonly connections = new Map<string, MCPConnection>();
  private readonly serverConfigs = new Map<string, MCPServerConfig>();
  private readonly serverHealth = new Map<string, MCPServerHealth>();
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>();
  private readonly inFlightConnections = new Map<string, Promise<void>>();

  async initialize(serversConfig: MCPServersConfig): Promise<void> {
    const entries = Object.entries(serversConfig.servers);
    for (const [name, config] of entries) {
      this.serverConfigs.set(name, config);
      this.serverHealth.set(name, {
        status: "disconnected",
        retry_count: 0,
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
      }),
    );
  }

  getTools(serverName: string): ToolDefinition[] {
    return this.connections.get(serverName)?.tools ?? [];
  }

  getToolsForAgent(serverNames: string[]): ToolDefinition[] {
    const allTools: ToolDefinition[] = [];

    for (const serverName of serverNames) {
      const tools = this.getTools(serverName);
      for (const tool of tools) {
        allTools.push({
          name: `${serverName}__${tool.name}`,
          description: `[${serverName}] ${tool.description}`,
          input_schema: tool.input_schema,
        });
      }
    }

    return allTools;
  }

  getServerHealth(serverName: string): MCPServerHealth {
    return this.serverHealth.get(serverName) ?? { status: "disconnected", retry_count: 0 };
  }

  getAllServerHealth(): Record<string, MCPServerHealth> {
    const payload: Record<string, MCPServerHealth> = {};

    for (const serverName of this.serverConfigs.keys()) {
      payload[serverName] = this.getServerHealth(serverName);
    }

    return payload;
  }

  async callTool(
    prefixedToolName: string,
    args: Record<string, unknown>,
    options: ToolCallOptions = {},
  ): Promise<string> {
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

    let result: unknown;
    try {
      const callPromise = connection.client.callTool({
        name: toolName,
        arguments: args,
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
    if ((result as { isError?: boolean }).isError) {
      throw new Error(text || `Tool call failed: ${prefixedToolName}`);
    }

    return text;
  }

  async shutdown(): Promise<void> {
    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();

    await Promise.allSettled(
      [...this.connections.values()].map(async (connection) => {
        await connection.client.close();
      }),
    );

    this.connections.clear();
  }

  private async ensureConnected(name: string): Promise<void> {
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

  private async connectServer(name: string): Promise<void> {
    const config = this.serverConfigs.get(name);
    if (!config) {
      throw new Error(`Unknown MCP server: ${name}`);
    }

    const existingConnection = this.connections.get(name);
    if (existingConnection) {
      try {
        await existingConnection.client.close();
      } catch {
        // Ignore stale close errors.
      }
      this.connections.delete(name);
    }

    const client = new Client({
      name: `mcp-subagent-${name}`,
      version: "1.0.0",
    });

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      ...(config.cwd ? { cwd: config.cwd } : {}),
      env: toStringEnv(process.env, config.env),
    });

    await client.connect(transport);
    const toolList = await client.listTools();

    const tools: ToolDefinition[] = (toolList.tools ?? []).map((tool: unknown) => {
      const normalized = tool as {
        name?: string;
        description?: string;
        inputSchema?: Record<string, unknown>;
        input_schema?: Record<string, unknown>;
      };

      return {
        name: normalized.name ?? "unknown_tool",
        description: normalized.description ?? "",
        input_schema: normalized.inputSchema ?? normalized.input_schema ?? { type: "object", properties: {} },
      };
    });

    this.connections.set(name, {
      name,
      config,
      client,
      transport,
      tools,
    });

    this.clearReconnect(name);
    this.serverHealth.set(name, {
      status: "connected",
      retry_count: 0,
    });

    logger.info("Connected MCP server", {
      server: name,
      toolCount: tools.length,
    });
  }

  private recordConnectionFailure(name: string, error: unknown): void {
    const previous = this.serverHealth.get(name);
    const retryCount = (previous?.retry_count ?? 0) + 1;
    const errorMessage = error instanceof Error ? error.message : String(error);

    const connection = this.connections.get(name);
    if (connection) {
      void connection.client.close().catch(() => { });
      this.connections.delete(name);
    }

    this.serverHealth.set(name, {
      status: "disconnected",
      retry_count: retryCount,
      last_error: errorMessage,
    });

    logger.warn("MCP server connection failure", {
      server: name,
      retryCount,
      error: errorMessage,
    });
  }

  private scheduleReconnect(name: string): void {
    if (this.reconnectTimers.has(name)) {
      return;
    }

    const health = this.getServerHealth(name);
    const attempt = Math.max(1, health.retry_count);
    const delayMs = Math.min(30_000, 1_000 * Math.pow(2, Math.min(6, attempt - 1)));

    this.serverHealth.set(name, {
      ...health,
      status: "reconnecting",
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

  private clearReconnect(name: string): void {
    const timer = this.reconnectTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(name);
    }
  }
}

function splitPrefixedToolName(prefixedToolName: string): [string, string] {
  const delimiterIndex = prefixedToolName.indexOf("__");
  if (delimiterIndex <= 0 || delimiterIndex >= prefixedToolName.length - 2) {
    throw new Error(`Invalid prefixed tool name: ${prefixedToolName}`);
  }

  const serverName = prefixedToolName.slice(0, delimiterIndex);
  const toolName = prefixedToolName.slice(delimiterIndex + 2);
  return [serverName, toolName];
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal, message: string): Promise<T> {
  if (signal.aborted) {
    const abortError = new Error(message);
    abortError.name = "AbortError";
    throw abortError;
  }

  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      const abortError = new Error(message);
      abortError.name = "AbortError";
      reject(abortError);
    };

    signal.addEventListener("abort", onAbort, { once: true });
    promise
      .then((result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      })
      .catch((error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      });
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function extractToolResultText(result: unknown): string {
  const content = (result as { content?: Array<{ type?: string; text?: string }> }).content ?? [];
  if (content.length === 0) {
    return "";
  }

  const text = content
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();

  if (text.length > 0) {
    return text;
  }

  return JSON.stringify(content);
}

function toStringEnv(
  baseEnv: NodeJS.ProcessEnv,
  overrides: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value === "string") {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    env[key] = value;
  }

  return env;
}
