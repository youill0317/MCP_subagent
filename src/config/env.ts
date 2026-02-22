import path from "node:path";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";
import { logger } from "../utils/logger.js";

const PROVIDERS = ["openai", "anthropic", "google", "custom"] as const;
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_GOOGLE_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_CUSTOM_BASE_URL = DEFAULT_OPENAI_BASE_URL;

export type LLMProvider = (typeof PROVIDERS)[number];

export interface AppEnv {
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  CUSTOM_API_KEY?: string;
  OPENAI_BASE_URL: string;
  ANTHROPIC_BASE_URL: string;
  GOOGLE_BASE_URL: string;
  CUSTOM_BASE_URL: string;
  DEFAULT_PROVIDER: LLMProvider;
  DEFAULT_MODEL: string;
  MAX_AGENT_ITERATIONS: number;
  MAX_PARALLEL_AGENTS: number;
  AGENT_TIMEOUT_MS: number;
  STRICT_CONFIG_VALIDATION: boolean;
  RATE_LIMIT_CAPACITY: number;
  RATE_LIMIT_REFILL_PER_SECOND: number;
  providerApiKeys: Record<LLMProvider, string | undefined>;
  enabledProviders: LLMProvider[];
}

const BooleanEnvSchema = z.preprocess((value) => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value !== "string") {
    return value;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") {
    return false;
  }
  return value;
}, z.boolean());

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().trim().optional(),
  ANTHROPIC_API_KEY: z.string().trim().optional(),
  GOOGLE_API_KEY: z.string().trim().optional(),
  CUSTOM_API_KEY: z.string().trim().optional(),
  OPENAI_BASE_URL: z.string().trim().optional(),
  ANTHROPIC_BASE_URL: z.string().trim().optional(),
  GOOGLE_BASE_URL: z.string().trim().optional(),
  CUSTOM_BASE_URL: z.string().trim().optional(),
  DEFAULT_PROVIDER: z.enum(PROVIDERS).default("anthropic"),
  DEFAULT_MODEL: z.string().trim().min(1).default("claude-sonnet-4-20250514"),
  MAX_AGENT_ITERATIONS: z.coerce.number().int().positive().default(15),
  MAX_PARALLEL_AGENTS: z.coerce.number().int().min(1).max(20).default(5),
  AGENT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(120_000),
  STRICT_CONFIG_VALIDATION: BooleanEnvSchema.default(true),
  RATE_LIMIT_CAPACITY: z.coerce.number().min(1).default(10),
  RATE_LIMIT_REFILL_PER_SECOND: z.coerce.number().positive().default(5),
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
    CUSTOM_API_KEY: normalizeOptional(parsed.CUSTOM_API_KEY),
    OPENAI_BASE_URL: normalizeBaseUrl(parsed.OPENAI_BASE_URL, DEFAULT_OPENAI_BASE_URL),
    ANTHROPIC_BASE_URL: normalizeBaseUrl(parsed.ANTHROPIC_BASE_URL, DEFAULT_ANTHROPIC_BASE_URL),
    GOOGLE_BASE_URL: normalizeBaseUrl(parsed.GOOGLE_BASE_URL, DEFAULT_GOOGLE_BASE_URL),
    CUSTOM_BASE_URL: normalizeBaseUrl(parsed.CUSTOM_BASE_URL, DEFAULT_CUSTOM_BASE_URL),
    DEFAULT_PROVIDER: parsed.DEFAULT_PROVIDER,
    DEFAULT_MODEL: parsed.DEFAULT_MODEL,
    MAX_AGENT_ITERATIONS: parsed.MAX_AGENT_ITERATIONS,
    MAX_PARALLEL_AGENTS: parsed.MAX_PARALLEL_AGENTS,
    AGENT_TIMEOUT_MS: parsed.AGENT_TIMEOUT_MS,
    STRICT_CONFIG_VALIDATION: parsed.STRICT_CONFIG_VALIDATION,
    RATE_LIMIT_CAPACITY: parsed.RATE_LIMIT_CAPACITY,
    RATE_LIMIT_REFILL_PER_SECOND: parsed.RATE_LIMIT_REFILL_PER_SECOND,
  };

  const providerApiKeys: Record<LLMProvider, string | undefined> = {
    openai: normalized.OPENAI_API_KEY,
    anthropic: normalized.ANTHROPIC_API_KEY,
    google: normalized.GOOGLE_API_KEY,
    custom: normalized.CUSTOM_API_KEY,
  };

  const enabledProviders = PROVIDERS.filter((provider) => Boolean(providerApiKeys[provider]));
  for (const provider of PROVIDERS) {
    if (!providerApiKeys[provider]) {
      logger.warn(`${provider} disabled (no API key)`);
    }
  }

  if (enabledProviders.length === 0) {
    throw new Error("At least one LLM API key is required (OPENAI/ANTHROPIC/GOOGLE/CUSTOM).");
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

function normalizeBaseUrl(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return fallback;
  }

  return trimmed.replace(/\/+$/g, "");
}
