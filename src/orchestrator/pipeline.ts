import type { AgentRunResult } from "../agent/runtime.js";
import type { DelegateTaskFn } from "./delegate.js";

export interface PipelineStep {
  agent_id: string;
  task: string;
}

export interface PipelineResult {
  steps: Array<{ step: number; agent_id: string; result: AgentRunResult }>;
  final_output: string;
  total_tokens: { input: number; output: number };
  error?: string;
}

export interface PipelineTaskDeps {
  delegateTask: DelegateTaskFn;
}

export function createPipelineTaskExecutor(deps: PipelineTaskDeps) {
  return async function pipelineTask(steps: PipelineStep[]): Promise<PipelineResult> {
    const stepResults: PipelineResult["steps"] = [];
    const totalTokens = { input: 0, output: 0 };
    let previousOutput = "";
    let pipelineError: string | undefined;

    for (let index = 0; index < steps.length; index += 1) {
      const step = steps[index];
      const result = await deps.delegateTask(step.agent_id, step.task, previousOutput || undefined);

      stepResults.push({
        step: index + 1,
        agent_id: step.agent_id,
        result,
      });

      totalTokens.input += result.total_tokens.input;
      totalTokens.output += result.total_tokens.output;
      previousOutput = result.final_response;

      if (result.error) {
        pipelineError = `Step ${index + 1} failed (${step.agent_id}): ${result.error}`;
        break;
      }
    }

    return {
      steps: stepResults,
      final_output: previousOutput,
      total_tokens: totalTokens,
      ...(pipelineError ? { error: pipelineError } : {}),
    };
  };
}
