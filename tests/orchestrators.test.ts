import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRunResult } from "../src/agent/runtime.js";
import { createEnsembleTaskExecutor } from "../src/orchestrator/ensemble.js";
import { createPipelineTaskExecutor } from "../src/orchestrator/pipeline.js";

function makeResult(overrides: Partial<AgentRunResult> = {}): AgentRunResult {
  return {
    agent_id: overrides.agent_id ?? "agent",
    final_response: overrides.final_response ?? "ok",
    iterations: overrides.iterations ?? 1,
    tool_calls_made: overrides.tool_calls_made ?? 0,
    total_tokens: overrides.total_tokens ?? { input: 1, output: 1 },
    run_id: overrides.run_id ?? "run-1",
    duration_ms: overrides.duration_ms ?? 10,
    stop_reason: overrides.stop_reason ?? "end_turn",
    retries: overrides.retries ?? 0,
    ...(overrides.error ? { error: overrides.error } : {}),
  };
}

test("ensemble aggregates results and synthesis tokens", async () => {
  const calls: Array<{ agentId: string; task: string; context?: string }> = [];

  const delegateTask = async (agentId: string, task: string, context?: string): Promise<AgentRunResult> => {
    calls.push({ agentId, task, context });

    if (context && context.includes("###")) {
      return makeResult({
        agent_id: agentId,
        final_response: "synthesized",
        total_tokens: { input: 7, output: 3 },
      });
    }

    return makeResult({
      agent_id: agentId,
      final_response: `${agentId}-answer`,
      total_tokens: { input: 2, output: 1 },
    });
  };

  const ensembleTask = createEnsembleTaskExecutor({
    delegateTask,
    maxParallelAgents: 2,
  });

  const result = await ensembleTask({
    agentIds: ["alpha", "beta"],
    task: "analyze",
    synthesize: true,
  });

  assert.equal(result.individual_results.length, 2);
  assert.equal(result.synthesis, "synthesized");
  assert.equal(result.synthesis_agent_id, "alpha");
  assert.equal(result.total_tokens.input, 11);
  assert.equal(result.total_tokens.output, 5);
  assert.equal(calls.length, 3);
});

test("pipeline passes previous output as context and stops on error", async () => {
  const calls: Array<{ agentId: string; task: string; context?: string }> = [];

  const delegateTask = async (agentId: string, task: string, context?: string): Promise<AgentRunResult> => {
    calls.push({ agentId, task, context });

    if (agentId === "second") {
      return makeResult({
        agent_id: agentId,
        final_response: "",
        error: "step failed",
      });
    }

    return makeResult({
      agent_id: agentId,
      final_response: `${agentId}-output`,
    });
  };

  const pipelineTask = createPipelineTaskExecutor({ delegateTask });

  const result = await pipelineTask([
    { agent_id: "first", task: "step 1" },
    { agent_id: "second", task: "step 2" },
    { agent_id: "third", task: "step 3" },
  ]);

  assert.equal(result.steps.length, 2);
  assert.match(result.error ?? "", /Step 2 failed/);
  assert.equal(calls[0]?.context, undefined);
  assert.equal(calls[1]?.context, "first-output");
});
