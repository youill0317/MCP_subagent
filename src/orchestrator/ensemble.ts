import type { AgentRunResult } from "../agent/runtime.js";
import type { DelegateTaskFn } from "./delegate.js";

export interface EnsembleAgentRunResult extends AgentRunResult {
  attempts: number;
  retried: boolean;
}

export interface EnsembleResult {
  individual_results: EnsembleAgentRunResult[];
  synthesis: string;
  total_tokens: { input: number; output: number };
  synthesis_agent_id?: string;
  synthesis_error?: string;
}

export interface EnsembleTaskInput {
  agentIds: string[];
  task: string;
  synthesize: boolean;
  synthesizerAgentId?: string;
}

export interface EnsembleTaskDeps {
  delegateTask: DelegateTaskFn;
  maxParallelAgents: number;
  retryEnabled?: boolean;
  retryMaxAttempts?: number;
}

export function createEnsembleTaskExecutor(deps: EnsembleTaskDeps) {
  return async function ensembleTask(input: EnsembleTaskInput): Promise<EnsembleResult> {
    const retryEnabled = deps.retryEnabled ?? true;
    const retryMaxAttempts = Math.max(1, deps.retryMaxAttempts ?? 2);

    const individualResults = await mapWithConcurrency(
      input.agentIds,
      Math.max(1, deps.maxParallelAgents),
      async (agentId) => {
        let attempts = 0;
        let result: AgentRunResult;
        const accumulatedTokens = { input: 0, output: 0 };

        while (true) {
          attempts += 1;
          result = await deps.delegateTask(agentId, input.task);
          accumulatedTokens.input += result.total_tokens.input;
          accumulatedTokens.output += result.total_tokens.output;
          if (!retryEnabled || attempts >= retryMaxAttempts || !shouldRetryAgentResult(result)) {
            break;
          }
        }

        return {
          ...result,
          total_tokens: accumulatedTokens,
          attempts,
          retried: attempts > 1,
        };
      },
    );

    let synthesis = "";
    let synthesisAgentId: string | undefined;
    let synthesisError: string | undefined;
    let synthesisTokens = { input: 0, output: 0 };

    if (input.synthesize) {
      synthesisAgentId = input.synthesizerAgentId ?? input.agentIds[0];
      const synthContext = individualResults
        .map((result) => `### ${result.agent_id}\n${result.final_response || result.error || "[no output]"}`)
        .join("\n\n");

      const synthResult = await deps.delegateTask(
        synthesisAgentId,
        "Synthesize the following results from multiple agents into one unified answer.",
        synthContext,
      );

      synthesis = synthResult.final_response;
      synthesisError = synthResult.error;
      synthesisTokens = {
        input: synthResult.total_tokens.input,
        output: synthResult.total_tokens.output,
      };
    }

    const totalTokens = sumTokens(individualResults);
    totalTokens.input += synthesisTokens.input;
    totalTokens.output += synthesisTokens.output;

    return {
      individual_results: individualResults,
      synthesis,
      total_tokens: totalTokens,
      ...(synthesisAgentId ? { synthesis_agent_id: synthesisAgentId } : {}),
      ...(synthesisError ? { synthesis_error: synthesisError } : {}),
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

function sumTokens(results: AgentRunResult[]): { input: number; output: number } {
  return results.reduce(
    (acc, result) => {
      acc.input += result.total_tokens.input;
      acc.output += result.total_tokens.output;
      return acc;
    },
    { input: 0, output: 0 },
  );
}

function shouldRetryAgentResult(result: AgentRunResult): boolean {
  if (!result.error) {
    return false;
  }

  return isRetryableAgentError(result.error);
}

function isRetryableAgentError(errorMessage: string): boolean {
  const normalized = errorMessage.toLowerCase();

  if (normalized.includes("execution aborted")) {
    return false;
  }

  if (
    normalized.includes("timed out")
    || normalized.includes("network")
    || normalized.includes("socket")
  ) {
    return true;
  }

  const statusMatch = normalized.match(/\bhttp\s+(\d{3})\b/i);
  if (!statusMatch) {
    return false;
  }

  const statusCode = Number(statusMatch[1]);
  if (Number.isNaN(statusCode)) {
    return false;
  }

  if (statusCode >= 500 && statusCode <= 599) {
    return true;
  }

  return statusCode === 408 || statusCode === 409 || statusCode === 425 || statusCode === 429;
}
