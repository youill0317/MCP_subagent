import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DelegateTaskFn } from "../orchestrator/delegate.js";

interface RegisterDelegateTaskToolDeps {
  delegateTask: DelegateTaskFn;
  availableAgentIds: string[];
}

const schema = z.object({
  agent_id: z.string().describe("작업을 위임할 에이전트 ID"),
  task: z.string().describe("에이전트에게 전달할 작업 지시문"),
  context: z.string().optional().describe("추가 컨텍스트"),
});

export function registerDelegateTaskTool(server: McpServer, deps: RegisterDelegateTaskToolDeps): void {
  const description =
    "특정 서브 에이전트에게 단일 작업을 위임합니다. " +
    `사용 가능한 에이전트: ${deps.availableAgentIds.join(", ")}`;

  server.tool("delegate_task", description, schema.shape, async (args) => {
    const result = await deps.delegateTask(args.agent_id, args.task, args.context);

    const payload = {
      status: result.error ? "error" : "success",
      agent_id: result.agent_id,
      response: result.final_response,
      metadata: {
        iterations: result.iterations,
        tool_calls_made: result.tool_calls_made,
        tokens: {
          input: result.total_tokens.input,
          output: result.total_tokens.output,
        },
      },
      ...(result.error ? { error: result.error } : {}),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  });
}
