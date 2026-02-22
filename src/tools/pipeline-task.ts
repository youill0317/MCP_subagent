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
        agent_id: z.string().describe("단계를 수행할 에이전트 ID"),
        task: z.string().describe("단계에서 수행할 작업"),
      }),
    )
    .min(2)
    .max(10)
    .describe("순차 파이프라인 단계"),
});

export function registerPipelineTaskTool(server: McpServer, deps: RegisterPipelineTaskToolDeps): void {
  const description =
    "여러 에이전트를 순차 실행하는 파이프라인입니다. 이전 단계 출력이 다음 단계 컨텍스트로 전달됩니다. " +
    `사용 가능한 에이전트: ${deps.availableAgentIds.join(", ")}`;

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
