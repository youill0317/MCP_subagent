import { postJsonWithRetry } from "./retry.js";
import type {
  ChatRequest,
  ChatResponse,
  LLMClient,
  Message,
  ToolCallRequest,
  ToolResult,
} from "./types.js";

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

interface AnthropicResponse {
  content?: AnthropicContentBlock[];
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export class AnthropicClient implements LLMClient {
  readonly provider = "anthropic";
  private readonly baseUrl: string;

  constructor(
    private readonly apiKey: string,
    baseUrl: string,
  ) {
    this.baseUrl = stripTrailingSlash(baseUrl);
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const response = await postJsonWithRetry<AnthropicResponse>(`${this.baseUrl}/messages`, {
      headers: {
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: {
        model: request.model,
        system: request.system_prompt,
        max_tokens: request.max_tokens ?? 2048,
        temperature: request.temperature,
        messages: toAnthropicMessages(request.messages),
        ...(request.tools && request.tools.length > 0
          ? {
              tools: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.input_schema,
              })),
            }
          : {}),
      },
    }, {
      signal: request.signal,
    });

    const blocks = response.content ?? [];
    const text = blocks
      .filter((block): block is Extract<AnthropicContentBlock, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    const toolCalls: ToolCallRequest[] = blocks
      .filter((block): block is Extract<AnthropicContentBlock, { type: "tool_use" }> => block.type === "tool_use")
      .map((block) => ({
        id: block.id,
        name: block.name,
        arguments: block.input ?? {},
      }));

    const stopReason: ChatResponse["stop_reason"] = toolCalls.length > 0 || response.stop_reason === "tool_use"
      ? "tool_use"
      : response.stop_reason === "max_tokens"
        ? "max_tokens"
        : "end_turn";

    return {
      content: text,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        input_tokens: response.usage?.input_tokens ?? 0,
        output_tokens: response.usage?.output_tokens ?? 0,
      },
      stop_reason: stopReason,
      raw_stop_reason: response.stop_reason ?? undefined,
    };
  }
}

function toAnthropicMessages(messages: Message[]): Array<{ role: "user" | "assistant"; content: AnthropicContentBlock[] }> {
  const mapped: Array<{ role: "user" | "assistant"; content: AnthropicContentBlock[] }> = [];

  for (const message of messages) {
    if (message.role === "user") {
      mapped.push({
        role: "user",
        content: [
          {
            type: "text",
            text: String(message.content),
          },
        ],
      });
      continue;
    }

    if (message.role === "assistant") {
      const content: AnthropicContentBlock[] = [];
      if (typeof message.content === "string" && message.content.trim().length > 0) {
        content.push({ type: "text", text: message.content });
      }

      for (const toolCall of message.tool_calls ?? []) {
        content.push({
          type: "tool_use",
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.arguments,
        });
      }

      if (content.length === 0) {
        content.push({ type: "text", text: "" });
      }

      mapped.push({ role: "assistant", content });
      continue;
    }

    const content: AnthropicContentBlock[] = [];
    const results = Array.isArray(message.content) ? (message.content as ToolResult[]) : [];

    for (const result of results) {
      content.push({
        type: "tool_result",
        tool_use_id: result.tool_call_id,
        content: result.result,
        ...(result.is_error ? { is_error: true } : {}),
      });
    }

    if (content.length === 0) {
      content.push({ type: "text", text: String(message.content) });
    }

    mapped.push({ role: "user", content });
  }

  return mapped;
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}
