import type { LLMProvider } from "../config/env.js";
import type { LLMClient } from "./types.js";
import { OpenAIClient } from "./openai-client.js";
import { AnthropicClient } from "./anthropic-client.js";
import { GoogleClient } from "./google-client.js";

export interface LLMBaseUrls {
  openai: string;
  anthropic: string;
  google: string;
  custom: string;
}

export interface CustomClientOptions {
  openrouterProviderOrder?: string[];
  openrouterAllowFallbacks?: boolean;
  openrouterHttpReferer?: string;
  openrouterXTitle?: string;
}

export interface CreateLLMClientOptions {
  custom?: CustomClientOptions;
}

export function createLLMClient(
  provider: LLMProvider,
  apiKey: string | undefined,
  baseUrls: LLMBaseUrls,
  options: CreateLLMClientOptions = {},
): LLMClient {
  switch (provider) {
    case "openai":
      if (!apiKey) {
        throw new Error("openai API key is not configured");
      }
      return new OpenAIClient(apiKey, baseUrls.openai);
    case "anthropic":
      if (!apiKey) {
        throw new Error("anthropic API key is not configured");
      }
      return new AnthropicClient(apiKey, baseUrls.anthropic);
    case "google":
      if (!apiKey) {
        throw new Error("google API key is not configured");
      }
      return new GoogleClient(apiKey, baseUrls.google);
    case "custom":
      if (!apiKey) {
        throw new Error("custom API key is not configured");
      }
      return new OpenAIClient(apiKey, baseUrls.custom, options.custom);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
