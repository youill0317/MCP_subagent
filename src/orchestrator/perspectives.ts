import type { AgentRunResult } from "../agent/runtime.js";
import type { DelegateTaskFn } from "./delegate.js";

const PERSPECTIVE_AGENTS = ["creative", "critical", "logical"] as const;

export interface PerspectivesResult {
    perspectives: Array<{ agent_id: string; result: AgentRunResult }>;
    total_tokens: { input: number; output: number };
    error?: string;
}

export interface PerspectivesTaskInput {
    task: string;
    context?: string;
}

export interface PerspectivesTaskDeps {
    delegateTask: DelegateTaskFn;
    maxParallelAgents: number;
}

export function createPerspectivesTaskExecutor(deps: PerspectivesTaskDeps) {
    return async function perspectivesTask(
        input: PerspectivesTaskInput,
    ): Promise<PerspectivesResult> {
        const totalTokens = { input: 0, output: 0 };
        const errors: string[] = [];
        const maxParallel = Math.max(1, deps.maxParallelAgents);

        const perspectives = await mapWithConcurrency(
            [...PERSPECTIVE_AGENTS],
            maxParallel,
            async (agentId) => {
                const result = await deps.delegateTask(
                    agentId,
                    input.task,
                    input.context,
                );

                totalTokens.input += result.total_tokens.input;
                totalTokens.output += result.total_tokens.output;

                if (result.error) {
                    errors.push(`${agentId}: ${result.error}`);
                }

                return { agent_id: agentId, result };
            },
        );

        return {
            perspectives,
            total_tokens: totalTokens,
            ...(errors.length > 0 ? { error: errors.join(" | ") } : {}),
        };
    };
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let nextIndex = 0;

    const runners = Array.from(
        { length: Math.min(concurrency, items.length) },
        async () => {
            while (true) {
                const current = nextIndex;
                nextIndex += 1;
                if (current >= items.length) {
                    return;
                }
                results[current] = await worker(items[current], current);
            }
        },
    );

    await Promise.all(runners);
    return results;
}
