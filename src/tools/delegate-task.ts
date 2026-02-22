import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DelegateTaskFn } from "../orchestrator/delegate.js";

interface RegisterDelegateTaskToolDeps {
  delegateTask: DelegateTaskFn;
  availableAgentIds: string[];
}

const schema = z.object({
  agent_id: z.string().describe("Agent ID to delegate the task to"),
  task: z.string().describe("Task instruction to send to the agent"),
  context: z.string().optional().describe("Additional context"),
});

export function registerDelegateTaskTool(server: McpServer, deps: RegisterDelegateTaskToolDeps): void {
  const description =
    "Delegates a single task to a specific sub-agent. " +
    `Available agents: ${deps.availableAgentIds.join(", ")}`;

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
