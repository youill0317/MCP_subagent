import type { AgentRunResult } from "../agent/runtime.js";
import type { DelegateTaskFn } from "./delegate.js";

export interface DebateRound {
  round: number;
  responses: Array<{ agent_id: string; result: AgentRunResult }>;
}

export interface DebateResult {
  rounds: DebateRound[];
  conclusion: string;
  moderator_agent_id: string;
  total_rounds: number;
  total_tokens: { input: number; output: number };
  error?: string;
}

export interface DebateTaskInput {
  agentIds: string[];
  task: string;
  rounds: number;
  moderatorAgentId?: string;
}

export interface DebateTaskDeps {
  delegateTask: DelegateTaskFn;
  maxParallelAgents: number;
}

export function createDebateTaskExecutor(deps: DebateTaskDeps) {
  return async function debateTask(input: DebateTaskInput): Promise<DebateResult> {
    validateInput(input);

    const totalTokens = { input: 0, output: 0 };
    const debateRounds: DebateRound[] = [];
    const errors: string[] = [];
    const moderatorAgentId = input.moderatorAgentId ?? "logical";
    const maxParallelAgents = Math.max(1, deps.maxParallelAgents);
    let discussionLog = "";

    for (let roundNumber = 1; roundNumber <= input.rounds; roundNumber += 1) {
      const context = roundNumber === 1 ? undefined : discussionLog;
      const taskPrompt = roundNumber === 1
        ? input.task
        : [
          "Continue the discussion. Respond to other participants' points with rebuttals, refinements, or support.",
          `Topic: ${input.task}`,
        ].join("\n\n");

      const responses = await mapWithConcurrency(
        input.agentIds,
        maxParallelAgents,
        async (agentId) => {
          const result = await deps.delegateTask(agentId, taskPrompt, context);
          totalTokens.input += result.total_tokens.input;
          totalTokens.output += result.total_tokens.output;

          if (result.error) {
            errors.push(`Round ${roundNumber} (${agentId}): ${result.error}`);
          }

          return {
            agent_id: agentId,
            result,
          };
        },
      );

      debateRounds.push({
        round: roundNumber,
        responses,
      });

      discussionLog += `${formatRound(roundNumber, responses)}\n\n`;
    }

    const moderatorResult = await deps.delegateTask(
      moderatorAgentId,
      "Synthesize the entire discussion into a clear, actionable conclusion. Include major agreements, disagreements, risks, and recommended next steps.",
      discussionLog || undefined,
    );

    totalTokens.input += moderatorResult.total_tokens.input;
    totalTokens.output += moderatorResult.total_tokens.output;

    if (moderatorResult.error) {
      errors.push(`Moderator (${moderatorAgentId}): ${moderatorResult.error}`);
    }

    return {
      rounds: debateRounds,
      conclusion: moderatorResult.final_response,
      moderator_agent_id: moderatorAgentId,
      total_rounds: input.rounds,
      total_tokens: totalTokens,
      ...(errors.length > 0 ? { error: errors.join(" | ") } : {}),
    };
  };
}

function validateInput(input: DebateTaskInput): void {
  if (input.agentIds.length < 2 || input.agentIds.length > 5) {
    throw new Error("agentIds must include between 2 and 5 agents");
  }

  if (!Number.isInteger(input.rounds) || input.rounds < 1 || input.rounds > 5) {
    throw new Error("rounds must be an integer between 1 and 5");
  }
}

function formatRound(
  roundNumber: number,
  responses: DebateRound["responses"],
): string {
  const sections = [`## Round ${roundNumber}`];

  for (const item of responses) {
    sections.push(`### ${item.agent_id}`);
    sections.push(item.result.final_response || item.result.error || "[no output]");
  }

  return sections.join("\n");
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) {
        return;
      }

      results[current] = await worker(items[current], current);
    }
  });

  await Promise.all(runners);
  return results;
}
