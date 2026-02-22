import type { Message, ToolCallRequest, ToolResult } from "../llm/types.js";

export class AgentConversationContext {
  private readonly messages: Message[] = [];

  addUser(content: string): void {
    this.messages.push({ role: "user", content });
  }

  addAssistant(content: string, toolCalls?: ToolCallRequest[]): void {
    this.messages.push({
      role: "assistant",
      content,
      ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  }

  addToolResults(results: ToolResult[]): void {
    this.messages.push({ role: "tool_result", content: results });
  }

  getMessages(): Message[] {
    return [...this.messages];
  }

  getLastText(): string {
    for (let i = this.messages.length - 1; i >= 0; i -= 1) {
      const message = this.messages[i];
      if (typeof message.content === "string" && message.content.trim().length > 0) {
        return message.content;
      }
    }

    return "";
  }
}
