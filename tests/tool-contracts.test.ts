import assert from "node:assert/strict";
import test from "node:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentRunResult } from "../src/agent/runtime.js";
import type { AgentsConfig } from "../src/config/agents.js";
import { MCPClientManager } from "../src/mcp-client/manager.js";
import { registerDelegateTaskTool } from "../src/tools/delegate-task.js";
import { registerPerspectivesTaskTool } from "../src/tools/perspectives-task.js";
import { registerListAgentsTool } from "../src/tools/list-agents.js";

type ToolResponse = {
  content: Array<{ type: string; text: string }>;
};

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResponse>;

class FakeMcpServer {
  readonly tools = new Map<
    string,
    {
      description: string;
      schema: Record<string, unknown>;
      handler: ToolHandler;
    }
  >();

  tool(
    name: string,
    description: string,
    schema: Record<string, unknown>,
    handler: ToolHandler,
  ): void {
    this.tools.set(name, {
      description,
      schema,
      handler,
    });
  }
}

function makeResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    agent_id: overrides.agent_id ?? "agent",
    final_response: overrides.final_response ?? "ok",
    iterations: overrides.iterations ?? 1,
    tool_calls_made: overrides.tool_calls_made ?? 0,
    total_tokens: overrides.total_tokens ?? { input: 1, output: 1 },
    run_id: overrides.run_id ?? "run-1",
    duration_ms: overrides.duration_ms ?? 10,
    stop_reason: overrides.stop_reason ?? "end_turn",
    retries: overrides.retries ?? 0,
    ...(overrides.error ? { error: overrides.error } : {}),
  };
}

function getTool(
  server: FakeMcpServer,
  name: string,
): { description: string; schema: Record<string, unknown>; handler: ToolHandler } {
  const tool = server.tools.get(name);
  assert.ok(tool, `Expected tool to be registered: ${name}`);
  return tool;
}

function parsePayload(response: ToolResponse): Record<string, unknown> {
  assert.equal(response.content.length, 1);
  assert.equal(response.content[0]?.type, "text");
  return JSON.parse(response.content[0]?.text ?? "{}") as Record<string, unknown>;
}

test("delegate_task tool returns success and error payloads with metadata", async () => {
  const server = new FakeMcpServer();
  registerDelegateTaskTool(server as unknown as McpServer, {
    availableAgentIds: ["agent-a"],
    delegateTask: async (_agentId, task) => {
      if (task === "fail") {
        return makeResult({
          agent_id: "agent-a",
          final_response: "",
          error: "delegate failed",
          total_tokens: { input: 2, output: 0 },
        });
      }
      return makeResult({
        agent_id: "agent-a",
        final_response: "delegate ok",
        total_tokens: { input: 2, output: 1 },
      });
    },
  });

  const tool = getTool(server, "delegate_task");
  assert.deepEqual(Object.keys(tool.schema).sort(), ["agent_id", "context", "task"]);

  const successPayload = parsePayload(
    await tool.handler({
      agent_id: "agent-a",
      task: "run",
    }),
  );
  assert.equal(successPayload.status, "success");
  assert.equal(successPayload.agent_id, "agent-a");
  assert.equal((successPayload.metadata as { tokens: { input: number; output: number } }).tokens.input, 2);

  const errorPayload = parsePayload(
    await tool.handler({
      agent_id: "agent-a",
      task: "fail",
    }),
  );
  assert.equal(errorPayload.status, "error");
  assert.equal(errorPayload.error, "delegate failed");
});

test("perspectives_task tool returns 3 perspectives with metadata", async () => {
  const server = new FakeMcpServer();
  registerPerspectivesTaskTool(server as unknown as McpServer, {
    perspectivesTask: async () => ({
      perspectives: [
        {
          agent_id: "creative",
          result: makeResult({
            agent_id: "creative",
            final_response: "creative idea",
            total_tokens: { input: 2, output: 1 },
          }),
        },
        {
          agent_id: "critical",
          result: makeResult({
            agent_id: "critical",
            final_response: "",
            error: "timeout",
            total_tokens: { input: 1, output: 0 },
          }),
        },
        {
          agent_id: "logical",
          result: makeResult({
            agent_id: "logical",
            final_response: "structured view",
            total_tokens: { input: 2, output: 1 },
          }),
        },
      ],
      total_tokens: { input: 5, output: 2 },
      error: "critical: timeout",
    }),
  });

  const tool = getTool(server, "perspectives_task");
  assert.deepEqual(Object.keys(tool.schema).sort(), ["context", "task"]);

  const payload = parsePayload(
    await tool.handler({
      task: "Analyze topic",
    }),
  );

  assert.equal(payload.status, "partial_success");
  assert.equal(payload.error, "critical: timeout");
  const perspectives = payload.perspectives as Array<{
    agent_id: string;
    response: string;
    error?: string;
    metadata: { tokens: { input: number; output: number } };
  }>;
  assert.equal(perspectives.length, 3);
  assert.equal(perspectives[0]?.agent_id, "creative");
  assert.equal(perspectives[0]?.response, "creative idea");
  assert.equal(perspectives[1]?.error, "timeout");
  assert.equal(perspectives[2]?.metadata.tokens.input, 2);
});

test("list_agents tool returns per-agent tool list and server health", async () => {
  const server = new FakeMcpServer();
  const agentsConfig: AgentsConfig = {
    agents: {
      researcher: {
        name: "researcher",
        description: "Research agent",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        system_prompt: "prompt",
        mcp_servers: ["mcp_obsidian"],
        max_iterations: 3,
        temperature: 0.2,
      },
    },
  };

  const mcpManager = {
    getToolsForAgent: () => [
      {
        name: "mcp_obsidian__search_markdown",
        description: "desc",
        input_schema: { type: "object", properties: {} },
      },
    ],
    getAllServerHealth: () => ({
      mcp_obsidian: {
        status: "connected",
        retry_count: 0,
      },
    }),
  } as unknown as MCPClientManager;

  registerListAgentsTool(server as unknown as McpServer, {
    agentsConfig,
    mcpManager,
  });

  const tool = getTool(server, "list_agents");
  assert.deepEqual(Object.keys(tool.schema), []);

  const payload = parsePayload(
    await tool.handler({}),
  );

  assert.equal(payload.status, "success");
  const agents = payload.agents as Record<string, { available_tools: string[] }>;
  assert.equal(agents.researcher?.available_tools[0], "mcp_obsidian__search_markdown");
  const serverHealth = payload.server_health as Record<string, { status: string }>;
  assert.equal(serverHealth.mcp_obsidian?.status, "connected");
});
