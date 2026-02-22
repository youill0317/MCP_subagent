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

export class MCPClientManager {
  private readonly connections = new Map<string, MCPConnection>();

  async initialize(serversConfig: MCPServersConfig): Promise<void> {
    const entries = Object.entries(serversConfig.servers);

    await Promise.all(
      entries.map(async ([name, config]) => {
        try {
          await this.connectServer(name, config);
        } catch (error) {
          logger.warn("Failed to initialize MCP server", {
            server: name,
            error: error instanceof Error ? error.message : String(error),
          });
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

  async callTool(prefixedToolName: string, args: Record<string, unknown>): Promise<string> {
    const [serverName, toolName] = splitPrefixedToolName(prefixedToolName);
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(`MCP server is not connected: ${serverName}`);
    }

    const result = await connection.client.callTool({
      name: toolName,
      arguments: args,
    });

    const text = extractToolResultText(result);
    if ((result as { isError?: boolean }).isError) {
      throw new Error(text || `Tool call failed: ${prefixedToolName}`);
    }

    return text;
  }

  async shutdown(): Promise<void> {
    await Promise.allSettled(
      [...this.connections.values()].map(async (connection) => {
        await connection.client.close();
      }),
    );

    this.connections.clear();
  }

  private async connectServer(name: string, config: MCPServerConfig): Promise<void> {
    const client = new Client({
      name: `mcp-subagent-${name}`,
      version: "1.0.0",
    });

    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      ...(config.cwd ? { cwd: config.cwd } : {}),
      env: {
        ...process.env,
        ...config.env,
      },
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

    logger.info("Connected MCP server", {
      server: name,
      toolCount: tools.length,
    });
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
