import { z } from "zod";

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
  OPENROUTER_PROVIDER_ORDER?: string[];
  OPENROUTER_ALLOW_FALLBACKS?: boolean;
  OPENROUTER_HTTP_REFERER?: string;
  OPENROUTER_X_TITLE?: string;
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

const OptionalBooleanEnvSchema = z.preprocess((value) => {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "string" && value.trim() === "") {
    return undefined;
  }
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
}, z.boolean().optional());

const EnvSchema = z.object({
  OPENAI_API_KEY: z.string().trim().optional(),
  ANTHROPIC_API_KEY: z.string().trim().optional(),
  GOOGLE_API_KEY: z.string().trim().optional(),
  CUSTOM_API_KEY: z.string().trim().optional(),
  OPENAI_BASE_URL: z.string().trim().optional(),
  ANTHROPIC_BASE_URL: z.string().trim().optional(),
  GOOGLE_BASE_URL: z.string().trim().optional(),
  CUSTOM_BASE_URL: z.string().trim().optional(),
  OPENROUTER_PROVIDER_ORDER: z.string().trim().optional(),
  OPENROUTER_ALLOW_FALLBACKS: OptionalBooleanEnvSchema,
  OPENROUTER_HTTP_REFERER: z.string().trim().optional(),
  OPENROUTER_X_TITLE: z.string().trim().optional(),
  DEFAULT_PROVIDER: z.enum(PROVIDERS).default("anthropic"),
  DEFAULT_MODEL: z.string().trim().min(1).default("claude-sonnet-4-20250514"),
  MAX_AGENT_ITERATIONS: z.coerce.number().int().positive().default(15),
  MAX_PARALLEL_AGENTS: z.coerce.number().int().min(1).max(20).default(5),
  AGENT_TIMEOUT_MS: z.coerce.number().int().min(1000).default(300_000),

  STRICT_CONFIG_VALIDATION: BooleanEnvSchema.default(false),
  RATE_LIMIT_CAPACITY: z.coerce.number().min(1).default(10),
  RATE_LIMIT_REFILL_PER_SECOND: z.coerce.number().positive().default(5),
});

let cachedEnv: AppEnv | null = null;

export function loadEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

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
    OPENROUTER_PROVIDER_ORDER: parseCommaSeparatedList(parsed.OPENROUTER_PROVIDER_ORDER),
    OPENROUTER_ALLOW_FALLBACKS: parsed.OPENROUTER_ALLOW_FALLBACKS,
    OPENROUTER_HTTP_REFERER: normalizeOptional(parsed.OPENROUTER_HTTP_REFERER),
    OPENROUTER_X_TITLE: normalizeOptional(parsed.OPENROUTER_X_TITLE),
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

  if (enabledProviders.length === 0) {
    throw new Error("No enabled LLM provider. Configure at least one provider API key.");
  }

  const defaultProvider: LLMProvider = normalized.DEFAULT_PROVIDER;
  if (!enabledProviders.includes(defaultProvider)) {
    throw new Error(
      `DEFAULT_PROVIDER=${defaultProvider} is not enabled. Configure ${defaultProvider.toUpperCase()}_API_KEY or switch DEFAULT_PROVIDER.`,
    );
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
  return normalizeBaseValue(value, fallback).replace(/\/+$/g, "");
}

function normalizeBaseValue(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    return fallback;
  }

  return trimmed;
}

function parseCommaSeparatedList(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const deduped = new Set<string>();
  for (const rawItem of value.split(",")) {
    const item = rawItem.trim();
    if (!item) {
      continue;
    }
    deduped.add(item);
  }

  if (deduped.size === 0) {
    return undefined;
  }

  return [...deduped];
}
