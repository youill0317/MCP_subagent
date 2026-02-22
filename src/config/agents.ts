import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppEnv, LLMProvider } from "./env.js";

const AgentPresetSchema = z.object({
  description: z.string().min(1),
  provider: z.enum(["openai", "anthropic", "google"]).optional(),
  model: z.string().trim().min(1).optional(),
  system_prompt: z.string().min(1),
  mcp_servers: z.array(z.string().min(1)).default([]),
  max_iterations: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
});

const AgentsFileSchema = z.object({
  agents: z.record(AgentPresetSchema),
});

export interface AgentConfig {
  name: string;
  description: string;
  provider: LLMProvider;
  model: string;
  system_prompt: string;
  mcp_servers: string[];
  max_iterations: number;
  temperature?: number;
}

export interface AgentsConfig {
  agents: Record<string, AgentConfig>;
}

export function loadAgentsConfig(
  env: AppEnv,
  filePath = path.resolve(process.cwd(), "agents.json"),
): AgentsConfig {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = AgentsFileSchema.parse(JSON.parse(raw));

  const agents: Record<string, AgentConfig> = {};
  for (const [name, preset] of Object.entries(parsed.agents)) {
    agents[name] = {
      name,
      description: preset.description,
      provider: preset.provider ?? env.DEFAULT_PROVIDER,
      model: preset.model ?? env.DEFAULT_MODEL,
      system_prompt: preset.system_prompt,
      mcp_servers: preset.mcp_servers,
      max_iterations: preset.max_iterations ?? env.MAX_AGENT_ITERATIONS,
      temperature: preset.temperature,
    };
  }

  return { agents };
}

export function getAgentConfig(config: AgentsConfig, agentId: string): AgentConfig {
  const agent = config.agents[agentId];
  if (!agent) {
    const available = Object.keys(config.agents).join(", ");
    throw new Error(`Unknown agent_id: ${agentId}. Available agents: ${available}`);
  }
  return agent;
}

export function listAgentIds(config: AgentsConfig): string[] {
  return Object.keys(config.agents);
}
