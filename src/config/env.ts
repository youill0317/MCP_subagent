import path from "node:path";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";
import { logger } from "../utils/logger.js";

const PROVIDERS = ["openai", "anthropic", "google"] as const;

export type LLMProvider = (typeof PROVIDERS)[number];

export interface AppEnv {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  DEFAULT_PROVIDER: LLMProvider;
  DEFAULT_MODEL: string;
  MAX_AGENT_ITERATIONS: number;
  MAX_PARALLEL_AGENTS: number;
  AGENT_TIMEOUT_MS: number;
  providerApiKeys: Record<LLMProvider, string | undefined>;
  enabledProviders: LLMProvider[];
}

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().trim().optional(),
  ANTHROPIC_API_KEY: z.string().trim().optional(),
  GOOGLE_API_KEY: z.string().trim().optional(),
  DEFAULT_PROVIDER: z.enum(PROVIDERS).default("anthropic"),
  DEFAULT_MODEL: z.string().trim().min(1).default("claude-sonnet-4-20250514"),
  MAX_AGENT_ITERATIONS: z.coerce.number().int().positive().default(15),
  MAX_PARALLEL_AGENTS: z.coerce.number().int().min(1).max(20).default(5),
  AGENT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120_000),
});

let cachedEnv: AppEnv | null = null;

export function loadEnv(envPath = path.resolve(process.cwd(), ".env")): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  loadDotEnv({ path: envPath });

  const parsed = EnvSchema.parse(process.env);
  const normalized = {
    OPENAI_API_KEY: normalizeOptional(parsed.OPENAI_API_KEY),
    ANTHROPIC_API_KEY: normalizeOptional(parsed.ANTHROPIC_API_KEY),
    GOOGLE_API_KEY: normalizeOptional(parsed.GOOGLE_API_KEY),
    DEFAULT_PROVIDER: parsed.DEFAULT_PROVIDER,
    DEFAULT_MODEL: parsed.DEFAULT_MODEL,
    MAX_AGENT_ITERATIONS: parsed.MAX_AGENT_ITERATIONS,
    MAX_PARALLEL_AGENTS: parsed.MAX_PARALLEL_AGENTS,
    AGENT_TIMEOUT_MS: parsed.AGENT_TIMEOUT_MS,
  };

  const providerApiKeys: Record<LLMProvider, string | undefined> = {
    openai: normalized.OPENAI_API_KEY,
    anthropic: normalized.ANTHROPIC_API_KEY,
    google: normalized.GOOGLE_API_KEY,
  };

  const enabledProviders = PROVIDERS.filter((provider) => Boolean(providerApiKeys[provider]));
  for (const provider of PROVIDERS) {
    if (!providerApiKeys[provider]) {
      logger.warn(`${provider} disabled (no API key)`);
    }
  }

  if (enabledProviders.length === 0) {
    throw new Error("At least one LLM API key is required (OPENAI/ANTHROPIC/GOOGLE).");
  }

  let defaultProvider: LLMProvider = normalized.DEFAULT_PROVIDER;
  if (!providerApiKeys[defaultProvider]) {
    defaultProvider = enabledProviders[0];
    logger.warn("DEFAULT_PROVIDER is unavailable; falling back to first enabled provider", {
      requested: normalized.DEFAULT_PROVIDER,
      fallback: defaultProvider,
    });
  }

  cachedEnv = {
    ...normalized,
    DEFAULT_PROVIDER: defaultProvider,
    providerApiKeys,
    enabledProviders,
  };

  return cachedEnv;
}

function normalizeOptional(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
