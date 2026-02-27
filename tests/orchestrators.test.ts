import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRunResult } from "../src/agent/runtime.js";
import { createPerspectivesTaskExecutor } from "../src/orchestrator/perspectives.js";

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

test("perspectives runs creative, critical, logical in parallel and returns all results", async () => {
  const calls: Array<{ agentId: string; task: string; context?: string }> = [];

  const delegateTask = async (
    agentId: string,
    task: string,
    context?: string,
  ): Promise<AgentRunResult> => {
    calls.push({ agentId, task, context });
    return makeResult({
      agent_id: agentId,
      final_response: `${agentId}-perspective`,
      total_tokens: { input: 2, output: 1 },
    });
  };

  const perspectivesTask = createPerspectivesTaskExecutor({
    delegateTask,
    maxParallelAgents: 3,
  });

  const result = await perspectivesTask({ task: "Evaluate strategy X" });

  assert.equal(result.perspectives.length, 3);
  assert.deepEqual(
    result.perspectives.map((p) => p.agent_id),
    ["creative", "critical", "logical"],
  );
  assert.equal(result.perspectives[0]?.result.final_response, "creative-perspective");
  assert.equal(result.perspectives[1]?.result.final_response, "critical-perspective");
  assert.equal(result.perspectives[2]?.result.final_response, "logical-perspective");
  assert.deepEqual(result.total_tokens, { input: 6, output: 3 });
  assert.equal(result.error, undefined);
  assert.equal(calls.length, 3);
});

test("perspectives returns partial error when one agent fails", async () => {
  const delegateTask = async (agentId: string): Promise<AgentRunResult> => {
    if (agentId === "critical") {
      return makeResult({
        agent_id: agentId,
        final_response: "",
        total_tokens: { input: 1, output: 0 },
        error: "Agent timed out after 300000 ms",
      });
    }

    return makeResult({
      agent_id: agentId,
      final_response: `${agentId}-ok`,
      total_tokens: { input: 2, output: 1 },
    });
  };

  const perspectivesTask = createPerspectivesTaskExecutor({
    delegateTask,
    maxParallelAgents: 3,
  });

  const result = await perspectivesTask({ task: "Evaluate risk" });

  assert.equal(result.perspectives.length, 3);
  assert.ok(result.error);
  assert.match(result.error ?? "", /critical/);

  const creative = result.perspectives.find((p) => p.agent_id === "creative");
  assert.equal(creative?.result.final_response, "creative-ok");
  assert.equal(creative?.result.error, undefined);

  const critical = result.perspectives.find((p) => p.agent_id === "critical");
  assert.ok(critical?.result.error);
});

test("perspectives passes context to all agents", async () => {
  const calls: Array<{ agentId: string; task: string; context?: string }> = [];

  const delegateTask = async (
    agentId: string,
    task: string,
    context?: string,
  ): Promise<AgentRunResult> => {
    calls.push({ agentId, task, context });
    return makeResult({
      agent_id: agentId,
      final_response: `${agentId}-reply`,
    });
  };

  const perspectivesTask = createPerspectivesTaskExecutor({
    delegateTask,
    maxParallelAgents: 3,
  });

  const result = await perspectivesTask({
    task: "Refine previous analysis",
    context: "Round 1 summary here",
  });

  assert.equal(result.perspectives.length, 3);
  assert.equal(calls.length, 3);

  for (const call of calls) {
    assert.equal(call.task, "Refine previous analysis");
    assert.equal(call.context, "Round 1 summary here");
  }
});

