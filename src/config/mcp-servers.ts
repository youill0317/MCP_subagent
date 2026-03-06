import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const MCPServerSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  description: z.string().optional(),
}).strict();

const MCPServersConfigSchema = z.object({
  servers: z.record(MCPServerSchema),
}).strict();

export type MCPServerConfig = z.infer<typeof MCPServerSchema>;
export type MCPServersConfig = z.infer<typeof MCPServersConfigSchema>;

export function loadMCPServersConfig(
  filePath = path.resolve(process.cwd(), "mcp-servers.json"),
): MCPServersConfig {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = MCPServersConfigSchema.parse(JSON.parse(raw));
  assertNoTemplatePlaceholders(parsed);
  return parsed;
}

function assertNoTemplatePlaceholders(config: MCPServersConfig): void {
  const TEMPLATE_PATTERN = /\$\{[A-Z0-9_]+\}/i;

  for (const [serverName, server] of Object.entries(config.servers)) {
    if (TEMPLATE_PATTERN.test(server.command)) {
      throw new Error(
        `Template placeholder is not supported in mcp-servers.json: ${serverName}.command. Use a concrete command and pass runtime values via process.env.`,
      );
    }

    for (let index = 0; index < server.args.length; index += 1) {
      const arg = server.args[index];
      if (TEMPLATE_PATTERN.test(arg)) {
        throw new Error(
          `Template placeholder is not supported in mcp-servers.json: ${serverName}.args[${index}]. Use a concrete value and pass runtime values via process.env.`,
        );
      }
    }

    if (server.cwd && TEMPLATE_PATTERN.test(server.cwd)) {
      throw new Error(
        `Template placeholder is not supported in mcp-servers.json: ${serverName}.cwd. Use a concrete path and pass runtime values via process.env.`,
      );
    }
  }
}
