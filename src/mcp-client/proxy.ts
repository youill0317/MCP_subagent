import type { ToolDefinition } from "../llm/types.js";
import { MCPClientManager } from "./manager.js";

export class MCPToolProxy {
  constructor(private readonly manager: MCPClientManager) {}

  listToolsForAgent(serverNames: string[]): ToolDefinition[] {
    return this.manager.getToolsForAgent(serverNames);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<string> {
    return this.manager.callTool(name, args);
  }
}
