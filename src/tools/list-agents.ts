import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AgentsConfig } from "../config/agents.js";
import { MCPClientManager } from "../mcp-client/manager.js";

interface RegisterListAgentsToolDeps {
  agentsConfig: AgentsConfig;
  mcpManager: MCPClientManager;
}

const schema = z.object({});

export function registerListAgentsTool(server: McpServer, deps: RegisterListAgentsToolDeps): void {
  const description =
    "[Use when] You need to discover which agents are available, what roles they serve, " +
    "which models they use, or what tools they can access — before deciding how to delegate. " +
    "[Input rules] No parameters required.";

  server.tool("list_agents", description, schema.shape, async () => {
    const agents: Record<string, unknown> = {};
    const serverHealth = deps.mcpManager.getAllServerHealth();

    for (const [agentId, agent] of Object.entries(deps.agentsConfig.agents)) {
      const tools = deps.mcpManager.getToolsForAgent(agent.mcp_servers).map((tool) => tool.name);
      const mcpServers = agent.mcp_servers.map((serverName) => ({
        name: serverName,
        ...(serverHealth[serverName] ?? { status: "disconnected", retry_count: 0 }),
      }));

      agents[agentId] = {
        description: agent.description,
        provider: agent.provider,
        model: agent.model,
        max_tokens: agent.max_tokens,
        available_tools: tools,
        mcp_servers: mcpServers,
      };
    }

    const payload = {
      status: "success",
      agents,
      server_health: serverHealth,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  });
}
