import type { AgentConfig } from "../config/agents.js";
import type { LLMClient, ToolResult } from "../llm/types.js";
import { MCPClientManager } from "../mcp-client/manager.js";
import { TokenCounter } from "../utils/token-counter.js";
import { AgentConversationContext } from "./context.js";

export interface AgentRunResult {
  agent_id: string;
  final_response: string;
  iterations: number;
  tool_calls_made: number;
  total_tokens: { input: number; output: number };
  error?: string;
}

export async function runAgent(
  agentConfig: AgentConfig,
  task: string,
  context: string | undefined,
  llmClient: LLMClient,
  mcpManager: MCPClientManager,
): Promise<AgentRunResult> {
  const conversation = new AgentConversationContext();
  const tools = mcpManager.getToolsForAgent(agentConfig.mcp_servers);

  const initialMessage = context
    ? `## Previous Context\n${context}\n\n## Current Task\n${task}`
    : task;

  conversation.addUser(initialMessage);

  let iterations = 0;
  let toolCallsMade = 0;
  const tokenCounter = new TokenCounter();

  while (iterations < agentConfig.max_iterations) {
    iterations += 1;

    const response = await llmClient.chat({
      model: agentConfig.model,
      system_prompt: agentConfig.system_prompt,
      messages: conversation.getMessages(),
      tools: tools.length > 0 ? tools : undefined,
      temperature: agentConfig.temperature,
    });

    tokenCounter.add(response.usage.input_tokens, response.usage.output_tokens);

    if (response.stop_reason === "end_turn" || !response.tool_calls || response.tool_calls.length === 0) {
      return {
        agent_id: agentConfig.name,
        final_response: response.content,
        iterations,
        tool_calls_made: toolCallsMade,
        total_tokens: tokenCounter.snapshot(),
      };
    }

    conversation.addAssistant(response.content, response.tool_calls);

    const toolResults: ToolResult[] = [];
    for (const toolCall of response.tool_calls) {
      toolCallsMade += 1;
      try {
        const result = await mcpManager.callTool(toolCall.name, toolCall.arguments);
        toolResults.push({
          tool_call_id: toolCall.id,
          tool_name: toolCall.name,
          result,
        });
      } catch (error) {
        toolResults.push({
          tool_call_id: toolCall.id,
          tool_name: toolCall.name,
          result: `Error: ${error instanceof Error ? error.message : String(error)}`,
          is_error: true,
        });
      }
    }

    conversation.addToolResults(toolResults);
  }

  return {
    agent_id: agentConfig.name,
    final_response: `[max_iterations_reached] ${conversation.getLastText()}`,
    iterations,
    tool_calls_made: toolCallsMade,
    total_tokens: tokenCounter.snapshot(),
    error: "Max iterations reached",
  };
}
