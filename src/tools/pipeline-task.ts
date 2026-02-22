import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PipelineResult, PipelineStep } from "../orchestrator/pipeline.js";

interface PipelineTaskExecutor {
  (steps: PipelineStep[]): Promise<PipelineResult>;
}

interface RegisterPipelineTaskToolDeps {
  pipelineTask: PipelineTaskExecutor;
  availableAgentIds: string[];
}

const schema = z.object({
  steps: z
    .array(
      z.object({
        agent_id: z.string().describe("Agent ID that executes this step"),
        task: z.string().describe("Task to execute in this step"),
      }),
    )
    .min(2)
    .max(10)
    .describe("Sequential pipeline steps"),
});

export function registerPipelineTaskTool(server: McpServer, deps: RegisterPipelineTaskToolDeps): void {
  const description =
    "Runs a multi-agent pipeline sequentially. Each step output is passed as context to the next step. " +
    `Available agents: ${deps.availableAgentIds.join(", ")}`;

  server.tool("pipeline_task", description, schema.shape, async (args) => {
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
            output: step.result.total_tokens.output,
          },
        },
        ...(step.result.error ? { error: step.result.error } : {}),
      })),
      total_tokens: result.total_tokens,
      ...(result.error ? { error: result.error } : {}),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  });
}
