import assert from "node:assert/strict";
import test from "node:test";
import type { AgentRunResult } from "../src/agent/runtime.js";
import { createDebateTaskExecutor } from "../src/orchestrator/debate.js";
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
  assert.equal(result.individual_results[0]?.attempts, 1);
  assert.equal(result.individual_results[0]?.retried, false);
});

test("ensemble retries timeout failure once and keeps successful retry output", async () => {
  const attemptsByAgent: Record<string, number> = {};

  const delegateTask = async (agentId: string, task: string, context?: string): Promise<AgentRunResult> => {
    if (context && context.includes("###")) {
      return makeResult({
        agent_id: agentId,
        final_response: "synthesized",
        total_tokens: { input: 2, output: 1 },
      });
    }

    attemptsByAgent[agentId] = (attemptsByAgent[agentId] ?? 0) + 1;

    if (agentId === "beta" && attemptsByAgent[agentId] === 1) {
      return makeResult({
        agent_id: agentId,
        final_response: "",
        total_tokens: { input: 3, output: 2 },
        error: "Agent timed out after 120000 ms",
      });
    }

    return makeResult({
      agent_id: agentId,
      final_response: `${agentId}-answer`,
      total_tokens: { input: 1, output: 1 },
    });
  };

  const ensembleTask = createEnsembleTaskExecutor({
    delegateTask,
    maxParallelAgents: 2,
    retryEnabled: true,
    retryMaxAttempts: 2,
  });

  const result = await ensembleTask({
    agentIds: ["alpha", "beta"],
    task: "analyze",
    synthesize: true,
  });

  assert.equal(result.individual_results.length, 2);
  assert.equal(result.individual_results.find((item) => item.agent_id === "beta")?.attempts, 2);
  assert.equal(result.individual_results.find((item) => item.agent_id === "beta")?.retried, true);
  assert.equal(result.individual_results.find((item) => item.agent_id === "beta")?.error, undefined);
  assert.deepEqual(result.individual_results.find((item) => item.agent_id === "beta")?.total_tokens, {
    input: 4,
    output: 3,
  });
  assert.deepEqual(result.total_tokens, {
    input: 7,
    output: 5,
  });
});

test("ensemble does not retry non-retryable agent error", async () => {
  let alphaCalls = 0;

  const delegateTask = async (agentId: string): Promise<AgentRunResult> => {
    if (agentId === "alpha") {
      alphaCalls += 1;
      return makeResult({
        agent_id: agentId,
        final_response: "",
        error: "Unknown agent_id: alpha",
      });
    }

    return makeResult({
      agent_id: agentId,
      final_response: "ok",
    });
  };

  const ensembleTask = createEnsembleTaskExecutor({
    delegateTask,
    maxParallelAgents: 2,
    retryEnabled: true,
    retryMaxAttempts: 2,
  });

  const result = await ensembleTask({
    agentIds: ["alpha", "beta"],
    task: "analyze",
    synthesize: false,
  });

  const alpha = result.individual_results.find((item) => item.agent_id === "alpha");
  assert.equal(alphaCalls, 1);
  assert.equal(alpha?.attempts, 1);
  assert.equal(alpha?.retried, false);
});

test("ensemble retries HTTP 409 once", async () => {
  const attemptsByAgent: Record<string, number> = {};

  const delegateTask = async (agentId: string): Promise<AgentRunResult> => {
    attemptsByAgent[agentId] = (attemptsByAgent[agentId] ?? 0) + 1;

    if (agentId === "beta" && attemptsByAgent[agentId] === 1) {
      return makeResult({
        agent_id: agentId,
        final_response: "",
        total_tokens: { input: 2, output: 1 },
        error: "HTTP 409 Conflict",
      });
    }

    return makeResult({
      agent_id: agentId,
      final_response: `${agentId}-answer`,
      total_tokens: agentId === "beta" ? { input: 4, output: 2 } : { input: 1, output: 1 },
    });
  };

  const ensembleTask = createEnsembleTaskExecutor({
    delegateTask,
    maxParallelAgents: 2,
    retryEnabled: true,
    retryMaxAttempts: 2,
  });

  const result = await ensembleTask({
    agentIds: ["alpha", "beta"],
    task: "analyze",
    synthesize: false,
  });

  const beta = result.individual_results.find((item) => item.agent_id === "beta");
  assert.equal(beta?.attempts, 2);
  assert.equal(beta?.retried, true);
  assert.equal(beta?.error, undefined);
  assert.deepEqual(beta?.total_tokens, { input: 6, output: 3 });
  assert.deepEqual(result.total_tokens, { input: 7, output: 4 });
});

test("debate runs multiple rounds with shared context and moderator synthesis", async () => {
  const calls: Array<{ agentId: string; task: string; context?: string }> = [];
  const perAgentRound: Record<string, number> = {};

  const delegateTask = async (agentId: string, task: string, context?: string): Promise<AgentRunResult> => {
    calls.push({ agentId, task, context });

    if (task.startsWith("Synthesize the entire discussion")) {
      return makeResult({
        agent_id: agentId,
        final_response: "final conclusion",
        total_tokens: { input: 2, output: 1 },
      });
    }

    perAgentRound[agentId] = (perAgentRound[agentId] ?? 0) + 1;

    return makeResult({
      agent_id: agentId,
      final_response: `${agentId}-r${perAgentRound[agentId]}`,
      total_tokens: { input: 1, output: 1 },
    });
  };

  const debateTask = createDebateTaskExecutor({
    delegateTask,
    maxParallelAgents: 2,
    availableAgentIds: ["creative", "critical", "logical"],
  });

  const result = await debateTask({
    agentIds: ["creative", "critical"],
    task: "Debate the best launch strategy",
    rounds: 3,
  });

  assert.equal(result.rounds.length, 3);
  assert.equal(result.total_rounds, 3);
  assert.equal(result.moderator_agent_id, "logical");
  assert.equal(result.conclusion, "final conclusion");
  assert.equal(result.total_tokens.input, 8);
  assert.equal(result.total_tokens.output, 7);
  assert.equal(calls.length, 7);

  const participantCalls = calls.filter((call) => call.agentId !== "logical");
  assert.equal(participantCalls.length, 6);
  assert.equal(participantCalls.filter((call) => call.context === undefined).length, 2);
  assert.equal(
    participantCalls.filter(
      (call) => (call.context?.includes("## Round 1") ?? false) && !(call.context?.includes("## Round 2") ?? false),
    ).length,
    2,
  );
  assert.equal(
    participantCalls.filter((call) => call.context?.includes("## Round 2") ?? false).length,
    2,
  );

  const moderatorCall = calls.find((call) => call.agentId === "logical");
  assert.ok(moderatorCall);
  assert.match(moderatorCall?.context ?? "", /## Round 3/);
});

test("debate continues on participant failure and returns partial error summary", async () => {
  const calls: Array<{ agentId: string; task: string; context?: string }> = [];
  const perAgentRound: Record<string, number> = {};

  const delegateTask = async (agentId: string, task: string, context?: string): Promise<AgentRunResult> => {
    calls.push({ agentId, task, context });

    if (task.startsWith("Synthesize the entire discussion")) {
      return makeResult({
        agent_id: agentId,
        final_response: "synthesized despite errors",
        total_tokens: { input: 1, output: 1 },
      });
    }

    perAgentRound[agentId] = (perAgentRound[agentId] ?? 0) + 1;

    if (agentId === "critical" && perAgentRound[agentId] === 2) {
      return makeResult({
        agent_id: agentId,
        final_response: "",
        total_tokens: { input: 1, output: 0 },
        error: "failed in round 2",
      });
    }

    return makeResult({
      agent_id: agentId,
      final_response: `${agentId}-r${perAgentRound[agentId]}`,
      total_tokens: { input: 1, output: 1 },
    });
  };

  const debateTask = createDebateTaskExecutor({
    delegateTask,
    maxParallelAgents: 2,
    availableAgentIds: ["creative", "critical", "logical"],
  });

  const result = await debateTask({
    agentIds: ["creative", "critical"],
    task: "Debate risk controls",
    rounds: 3,
  });

  assert.equal(calls.length, 7);
  assert.equal(result.conclusion, "synthesized despite errors");
  assert.match(result.error ?? "", /Round 2 \(critical\): failed in round 2/);
  assert.ok(result.rounds[1]?.responses.find((item) => item.agent_id === "critical")?.result.error);
  assert.ok(calls.some((call) => call.agentId === "logical"));
});

test("debate falls back to the last participant when logical moderator is unavailable", async () => {
  const calls: Array<{ agentId: string; task: string; context?: string }> = [];

  const delegateTask = async (agentId: string, task: string, context?: string): Promise<AgentRunResult> => {
    calls.push({ agentId, task, context });

    if (task.startsWith("Synthesize the entire discussion")) {
      return makeResult({
        agent_id: agentId,
        final_response: "fallback conclusion",
        total_tokens: { input: 1, output: 1 },
      });
    }

    return makeResult({
      agent_id: agentId,
      final_response: `${agentId}-reply`,
      total_tokens: { input: 1, output: 1 },
    });
  };

  const debateTask = createDebateTaskExecutor({
    delegateTask,
    maxParallelAgents: 2,
    availableAgentIds: ["creative", "critical"],
  });

  const result = await debateTask({
    agentIds: ["creative", "critical"],
    task: "Debate rollout risk",
    rounds: 2,
  });

  assert.equal(result.moderator_agent_id, "critical");
  assert.equal(result.conclusion, "fallback conclusion");
  assert.equal(calls.filter((call) => call.task.startsWith("Synthesize the entire discussion")).length, 1);
  assert.equal(calls.at(-1)?.agentId, "critical");
});

test("debate rejects unknown moderator when available agents are provided", async () => {
  const debateTask = createDebateTaskExecutor({
    delegateTask: async () => makeResult(),
    maxParallelAgents: 2,
    availableAgentIds: ["creative", "critical"],
  });

  await assert.rejects(
    debateTask({
      agentIds: ["creative", "critical"],
      task: "Debate release plan",
      rounds: 1,
      moderatorAgentId: "logical",
    }),
    /Unknown moderator_agent_id/,
  );
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
