import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DelegateTaskFn } from "../orchestrator/delegate.js";

interface RegisterDelegateTaskToolDeps {
  delegateTask: DelegateTaskFn;
  availableAgentIds: string[];
}

const schema = z.object({
  agent_id: z.string().describe(
    "One of the available agent IDs listed in the tool description."
  ),
  task: z.string().describe(
    "A clear, self-contained instruction. The agent only sees this text and context — include all necessary details."
  ),
  context: z.string().optional().describe(
    "Optional background information the agent needs. Pass relevant prior results or data here."
  ),
});

export function registerDelegateTaskTool(server: McpServer, deps: RegisterDelegateTaskToolDeps): void {
  const description =
    "[Use when] You need a specific sub-agent to perform a single, focused task. " +
    "For complex requests, break into sub-tasks and call MULTIPLE TIMES IN PARALLEL. " +
    `Available agents: ${deps.availableAgentIds.join(", ")}. ` +
    "[Input rules] " +
    "agent_id: must be one of the available agents listed above. " +
    "task: a clear, self-contained instruction — the agent only sees this and context. " +
    "context (optional): background info or prior results the agent needs.";

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
