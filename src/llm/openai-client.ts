import { postJsonWithRetry } from "./retry.js";
import type {
  ChatRequest,
  ChatResponse,
  LLMClient,
  Message,
  ToolCallRequest,
  ToolDefinition,
  ToolResult,
} from "./types.js";

interface OpenAICompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null;
      tool_calls?: Array<{
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export class OpenAIClient implements LLMClient {
  readonly provider = "openai";
  private readonly baseUrl = "https://api.openai.com/v1";

  constructor(private readonly apiKey: string) {}

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: toOpenAIMessages(request.system_prompt, request.messages),
      temperature: request.temperature,
    };

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(toOpenAIToolDefinition);
    }

    const response = await postJsonWithRetry<OpenAICompletionResponse>(
      `${this.baseUrl}/chat/completions`,
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        body,
      },
    );

    const choice = response.choices?.[0];
    if (!choice?.message) {
      throw new Error("OpenAI returned no choices");
    }

    const toolCalls = parseOpenAIToolCalls(choice.message.tool_calls);
    const stopReason: ChatResponse["stop_reason"] = toolCalls.length > 0 || choice.finish_reason === "tool_calls"
      ? "tool_use"
      : choice.finish_reason === "length"
        ? "max_tokens"
        : "end_turn";

    return {
      content: normalizeText(choice.message.content),
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        input_tokens: response.usage?.prompt_tokens ?? 0,
        output_tokens: response.usage?.completion_tokens ?? 0,
      },
      stop_reason: stopReason,
    };
  }
}

function toOpenAIMessages(systemPrompt: string, messages: Message[]): Array<Record<string, unknown>> {
  const mapped: Array<Record<string, unknown>> = [
    {
      role: "system",
      content: systemPrompt,
    },
  ];

  for (const message of messages) {
    if (message.role === "user") {
      mapped.push({ role: "user", content: String(message.content) });
      continue;
    }

    if (message.role === "assistant") {
      const toolCalls = (message.tool_calls ?? []).map((toolCall) => ({
        id: toolCall.id,
        type: "function",
        function: {
          name: toolCall.name,
          arguments: JSON.stringify(toolCall.arguments ?? {}),
        },
      }));

      mapped.push({
        role: "assistant",
        content: normalizeAssistantText(message.content),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    const results = Array.isArray(message.content) ? (message.content as ToolResult[]) : [];
    for (const result of results) {
      mapped.push({
        role: "tool",
        tool_call_id: result.tool_call_id,
        content: result.result,
      });
    }
  }

  return mapped;
}

function toOpenAIToolDefinition(tool: ToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  };
}

function parseOpenAIToolCalls(
  rawCalls:
    | Array<{
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>
    | undefined,
): ToolCallRequest[] {
  if (!rawCalls || rawCalls.length === 0) {
    return [];
  }

  return rawCalls
    .filter((call) => call?.function?.name)
    .map((call, index) => ({
      id: call.id ?? `openai-tool-call-${index + 1}`,
      name: call.function?.name ?? "",
      arguments: parseArguments(call.function?.arguments),
    }));
}

function parseArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function normalizeText(content: string | Array<{ type?: string; text?: string }> | null | undefined): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim();
  }

  return "";
}

function normalizeAssistantText(content: Message["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  return "";
}
