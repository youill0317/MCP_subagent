import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { PerspectivesResult } from "../orchestrator/perspectives.js";

interface PerspectivesTaskExecutor {
    (input: { task: string; context?: string }): Promise<PerspectivesResult>;
}

interface RegisterPerspectivesTaskToolDeps {
    perspectivesTask: PerspectivesTaskExecutor;
}

const schema = z.object({
    task: z
        .string()
        .describe(
            "The topic or question to analyze. Must be clear enough for 3 independent agents to interpret without extra context."
        ),
    context: z
        .string()
        .optional()
        .describe(
            "Summary of a previous round's perspectives for multi-round refinement. " +
            "Omit on the first call. On subsequent calls, pass your synthesis so agents can deepen their analysis."
        ),
});

export function registerPerspectivesTaskTool(
    server: McpServer,
    deps: RegisterPerspectivesTaskToolDeps,
): void {
    const description =
        "[Use when] You need multi-angle analysis from 3 fixed perspectives (creative, critical, logical) running in parallel. " +
        "YOU must synthesize the raw responses. " +
        "For deeper analysis, call again with context=your_synthesis. " +
        "[Input rules] " +
        "task: a clear topic or question for all 3 agents to analyze independently. " +
        "context (optional): omit on first call; on follow-up calls, pass your synthesis of the previous round.";

    server.tool("perspectives_task", description, schema.shape, async (args) => {
        const result = await deps.perspectivesTask({
            task: args.task,
            context: args.context,
        });

        const payload = {
            status: result.error ? "partial_success" : "success",
            perspectives: result.perspectives.map((item) => ({
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
            total_tokens: result.total_tokens,
            ...(result.error ? { error: result.error } : {}),
        };

        return {
            content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
    });
}
