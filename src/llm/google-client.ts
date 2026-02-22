import { postJsonWithRetry } from "./retry.js";
import type {
  ChatRequest,
  ChatResponse,
  LLMClient,
  Message,
  ToolCallRequest,
  ToolResult,
} from "./types.js";

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args?: Record<string, unknown>; id?: string } }
  | { functionResponse: { name: string; response: Record<string, unknown> } };

interface GeminiResponse {
  candidates?: Array<{
    finishReason?: string;
    content?: {
      parts?: GeminiPart[];
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

export class GoogleClient implements LLMClient {
  readonly provider = "google";
  private readonly baseUrl = "https://generativelanguage.googleapis.com/v1beta";

  constructor(private readonly apiKey: string) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const generationConfig: Record<string, unknown> = {};
    if (typeof request.temperature === "number") {
      generationConfig.temperature = request.temperature;
    }
    if (typeof request.max_tokens === "number") {
      generationConfig.maxOutputTokens = request.max_tokens;
    }

    const response = await postJsonWithRetry<GeminiResponse>(
      `${this.baseUrl}/models/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`,
      {
        headers: {},
        body: {
          systemInstruction: {
            parts: [{ text: request.system_prompt }],
          },
          contents: toGeminiContents(request.messages),
          ...(request.tools && request.tools.length > 0
            ? {
                tools: [
                  {
                    functionDeclarations: request.tools.map((tool) => ({
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.input_schema,
                    })),
                  },
                ],
              }
            : {}),
          ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
        },
      },
      {
        signal: request.signal,
      },
    );

    const candidate = response.candidates?.[0];
    if (!candidate) {
      throw new Error("Google Gemini returned no candidates");
    }

    const parts = candidate.content?.parts ?? [];
    const text = parts
      .filter((part): part is Extract<GeminiPart, { text: string }> => "text" in part)
      .map((part) => part.text)
      .join("\n")
      .trim();

    const toolCalls: ToolCallRequest[] = parts
      .filter(
        (part): part is Extract<GeminiPart, { functionCall: { name: string; args?: Record<string, unknown>; id?: string } }> =>
          "functionCall" in part,
      )
      .map((part, index) => ({
        id: part.functionCall.id ?? `google-tool-call-${index + 1}`,
        name: part.functionCall.name,
        arguments: part.functionCall.args ?? {},
      }));

    const stopReason: ChatResponse["stop_reason"] = toolCalls.length > 0
      ? "tool_use"
      : candidate.finishReason === "MAX_TOKENS"
        ? "max_tokens"
        : "end_turn";

    return {
      content: text,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        input_tokens: response.usageMetadata?.promptTokenCount ?? 0,
        output_tokens: response.usageMetadata?.candidatesTokenCount ?? 0,
      },
      stop_reason: stopReason,
      raw_stop_reason: candidate.finishReason,
    };
  }
}

function toGeminiContents(messages: Message[]): Array<{ role: "user" | "model"; parts: GeminiPart[] }> {
  const mapped: Array<{ role: "user" | "model"; parts: GeminiPart[] }> = [];
  const toolNameByCallId = new Map<string, string>();

  for (const message of messages) {
    if (message.role === "user") {
      mapped.push({
        role: "user",
        parts: [{ text: String(message.content) }],
      });
      continue;
    }

    if (message.role === "assistant") {
      const parts: GeminiPart[] = [];
      if (typeof message.content === "string" && message.content.trim().length > 0) {
        parts.push({ text: message.content });
      }

      for (const toolCall of message.tool_calls ?? []) {
        toolNameByCallId.set(toolCall.id, toolCall.name);
        parts.push({
          functionCall: {
            name: toolCall.name,
            args: toolCall.arguments,
            id: toolCall.id,
          },
        });
      }

      if (parts.length === 0) {
        parts.push({ text: "" });
      }

      mapped.push({ role: "model", parts });
      continue;
    }

    const parts: GeminiPart[] = [];
    const results = Array.isArray(message.content) ? (message.content as ToolResult[]) : [];

    for (const result of results) {
      const resolvedName = result.tool_name ?? toolNameByCallId.get(result.tool_call_id);
      if (!resolvedName) {
        parts.push({
          text: `Tool result (${result.tool_call_id}): ${result.result}`,
        });
        continue;
      }

      parts.push({
        functionResponse: {
          name: resolvedName,
          response: {
            content: result.result,
            is_error: Boolean(result.is_error),
          },
        },
      });
    }

    if (parts.length === 0) {
      parts.push({ text: typeof message.content === "string" ? message.content : "" });
    }

    mapped.push({ role: "user", parts });
  }

  return mapped;
}
