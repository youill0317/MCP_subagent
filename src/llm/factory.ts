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

export function createLLMClient(provider: LLMProvider, apiKey: string, baseUrls: LLMBaseUrls): LLMClient {
  switch (provider) {
    case "openai":
      return new OpenAIClient(apiKey, baseUrls.openai);
    case "anthropic":
      return new AnthropicClient(apiKey, baseUrls.anthropic);
    case "google":
      return new GoogleClient(apiKey, baseUrls.google);
    case "custom":
      return new OpenAIClient(apiKey, baseUrls.custom);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
