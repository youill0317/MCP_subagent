import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const MCPServerSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
  cwd: z.string().optional(),
  description: z.string().optional(),
});

const MCPServersConfigSchema = z.object({
  servers: z.record(MCPServerSchema),
});

export type MCPServerConfig = z.infer<typeof MCPServerSchema>;
export type MCPServersConfig = z.infer<typeof MCPServersConfigSchema>;

export function loadMCPServersConfig(
  filePath = path.resolve(process.cwd(), "mcp-servers.json"),
): MCPServersConfig {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = MCPServersConfigSchema.parse(JSON.parse(raw));

  const resolvedServers: MCPServersConfig["servers"] = {};
  for (const [name, config] of Object.entries(parsed.servers)) {
    const resolvedEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(config.env)) {
      resolvedEnv[key] = resolveEnvTemplate(value);
    }

    resolvedServers[name] = {
      ...config,
      env: resolvedEnv,
    };
  }

  return {
    servers: resolvedServers,
  };
}

function resolveEnvTemplate(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_, variableName: string) => {
    const resolved = process.env[variableName];
    return resolved ?? "";
  });
}
