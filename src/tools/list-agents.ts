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
  const description = "사용 가능한 서브 에이전트 목록과 역할/모델/접근 가능한 도구를 조회합니다.";

  server.tool("list_agents", description, schema.shape, async () => {
    const agents: Record<string, unknown> = {};

    for (const [agentId, agent] of Object.entries(deps.agentsConfig.agents)) {
      const tools = deps.mcpManager.getToolsForAgent(agent.mcp_servers).map((tool) => tool.name);
      agents[agentId] = {
        description: agent.description,
        provider: agent.provider,
        model: agent.model,
        available_tools: tools,
      };
    }

    const payload = {
      status: "success",
      agents,
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  });
}
