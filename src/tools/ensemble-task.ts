import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EnsembleResult } from "../orchestrator/ensemble.js";

interface EnsembleTaskExecutor {
  (input: {
    agentIds: string[];
    task: string;
    synthesize: boolean;
    synthesizerAgentId?: string;
  }): Promise<EnsembleResult>;
}

interface RegisterEnsembleTaskToolDeps {
  ensembleTask: EnsembleTaskExecutor;
  availableAgentIds: string[];
}

const schema = z.object({
  agent_ids: z.array(z.string()).min(2).max(5).describe("List of agent IDs to run the same task"),
  task: z.string().describe("Task to run in parallel"),
  synthesize: z.boolean().default(true).describe("Whether to synthesize the results"),
  synthesizer_agent_id: z.string().optional().describe("Agent ID used for result synthesis"),
});

export function registerEnsembleTaskTool(server: McpServer, deps: RegisterEnsembleTaskToolDeps): void {
  const description =
    "Runs the same task in parallel across multiple sub-agents and synthesizes the outputs. " +
    `Available agents: ${deps.availableAgentIds.join(", ")}`;

  server.tool("ensemble_task", description, schema.shape, async (args) => {
    const result = await deps.ensembleTask({
      agentIds: args.agent_ids,
      task: args.task,
      synthesize: args.synthesize,
      synthesizerAgentId: args.synthesizer_agent_id,
    });

    const payload = {
      status: result.synthesis_error || result.individual_results.some((item) => item.error)
        ? "partial_success"
        : "success",
      synthesis: result.synthesis,
      individual_results: result.individual_results.map((item) => ({
        agent_id: item.agent_id,
        response: item.final_response,
        metadata: {
          run_id: item.run_id,
          duration_ms: item.duration_ms,
          stop_reason: item.stop_reason,
          retries: item.retries ?? 0,
          iterations: item.iterations,
          tool_calls_made: item.tool_calls_made,
          tokens: {
            input: item.total_tokens.input,
            output: item.total_tokens.output,
          },
        },
        ...(item.error ? { error: item.error } : {}),
      })),
      total_tokens: result.total_tokens,
      ...(result.synthesis_agent_id ? { synthesis_agent_id: result.synthesis_agent_id } : {}),
      ...(result.synthesis_error ? { synthesis_error: result.synthesis_error } : {}),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  });
}
