export type StopReason = "end_turn" | "tool_use" | "max_tokens";

export interface LLMClient {
  provider: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export interface ChatRequest {
  model: string;
  system_prompt: string;
  messages: Message[];
  tools?: ToolDefinition[];
  temperature?: number;
}

export interface ChatResponse {
  content: string;
  tool_calls?: ToolCallRequest[];
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  stop_reason: StopReason;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface Message {
  role: "user" | "assistant" | "tool_result";
  content: string | ToolResult[];
  tool_calls?: ToolCallRequest[];
}

export interface ToolResult {
  tool_call_id: string;
  tool_name?: string;
  result: string;
  is_error?: boolean;
}
