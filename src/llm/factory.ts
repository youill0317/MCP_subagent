import type { LLMProvider } from "../config/env.js";
import type { LLMClient } from "./types.js";
import { OpenAIClient } from "./openai-client.js";
import { AnthropicClient } from "./anthropic-client.js";
import { GoogleClient } from "./google-client.js";

export function createLLMClient(provider: LLMProvider, apiKey: string): LLMClient {
  switch (provider) {
    case "openai":
      return new OpenAIClient(apiKey);
    case "anthropic":
      return new AnthropicClient(apiKey);
    case "google":
      return new GoogleClient(apiKey);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}
