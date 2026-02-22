import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DebateResult } from "../orchestrator/debate.js";

interface DebateTaskExecutor {
  (input: {
    agentIds: string[];
    task: string;
    rounds: number;
    moderatorAgentId?: string;
  }): Promise<DebateResult>;
}

interface RegisterDebateTaskToolDeps {
  debateTask: DebateTaskExecutor;
  availableAgentIds: string[];
}

const schema = z.object({
  agent_ids: z.array(z.string()).min(2).max(5).describe("Agent IDs participating in the debate"),
  task: z.string().describe("Discussion topic or question"),
  rounds: z.number().int().min(1).max(5).default(3).describe("Number of discussion rounds"),
  moderator_agent_id: z.string().optional().describe("Agent ID for final synthesis"),
});

export function registerDebateTaskTool(server: McpServer, deps: RegisterDebateTaskToolDeps): void {
  const description =
    "Runs a multi-round debate among sub-agents and produces a moderated conclusion. " +
    `Available agents: ${deps.availableAgentIds.join(", ")}`;

  server.tool("debate_task", description, schema.shape, async (args) => {
    const result = await deps.debateTask({
      agentIds: args.agent_ids,
      task: args.task,
      rounds: args.rounds,
      moderatorAgentId: args.moderator_agent_id,
    });

    const payload = {
      status: result.error ? "partial_success" : "success",
      conclusion: result.conclusion,
      moderator_agent_id: result.moderator_agent_id,
      total_rounds: result.total_rounds,
      rounds: result.rounds.map((round) => ({
        round: round.round,
        responses: round.responses.map((item) => ({
          agent_id: item.agent_id,
          response: item.result.final_response,
          metadata: {
            run_id: item.result.run_id,
            duration_ms: item.result.duration_ms,
            stop_reason: item.result.stop_reason,
            retries: item.result.retries ?? 0,
            iterations: item.result.iterations,
            tool_calls_made: item.result.tool_calls_made,
            tokens: {
              input: item.result.total_tokens.input,
              output: item.result.total_tokens.output,
            },
          },
          ...(item.result.error ? { error: item.result.error } : {}),
        })),
      })),
      total_tokens: result.total_tokens,
      ...(result.error ? { error: result.error } : {}),
    };

    return {
      content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    };
  });
}
