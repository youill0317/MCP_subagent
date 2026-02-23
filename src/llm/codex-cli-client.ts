import { spawn } from "node:child_process";
import type { MCPServerConfig } from "../config/mcp-servers.js";
import type { ChatRequest, ChatResponse, LLMClient, Message, ToolResult } from "./types.js";

export interface CodexCliClientOptions {
  cliPath: string;
  mcpServers?: Record<string, MCPServerConfig>;
  cwd?: string;
}

interface ParsedCodexOutput {
  finalText: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  errorMessages: string[];
}

export class CodexCliClient implements LLMClient {
  readonly provider = "codex";
  private readonly cliPath: string;
  private readonly mcpServers: Record<string, MCPServerConfig>;
  private readonly cwd: string;

  constructor(options: CodexCliClientOptions) {
    this.cliPath = options.cliPath?.trim() || "codex";
    this.mcpServers = options.mcpServers ?? {};
    this.cwd = options.cwd ?? process.cwd();
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const prompt = buildPrompt(request.system_prompt, request.messages);
    const args = buildCodexExecArgs({
      model: request.model,
      prompt,
      mcpServers: this.mcpServers,
    });

    const { stdout, stderr } = await runCommand(this.cliPath, args, {
      cwd: this.cwd,
      signal: request.signal,
    });

    const parsed = parseCodexOutput(stdout);
    if (parsed.errorMessages.length > 0) {
      throw new Error(`Codex execution failed: ${parsed.errorMessages.join(" | ")}`);
    }

    const content = parsed.finalText.trim();
    if (!content) {
      const detail = stderr.trim() || stdout.trim() || "No assistant response in codex output";
      throw new Error(`Codex returned empty output: ${detail}`);
    }

    return {
      content,
      usage: parsed.usage,
      stop_reason: "end_turn",
    };
  }
}

function buildCodexExecArgs(params: {
  model: string;
  prompt: string;
  mcpServers: Record<string, MCPServerConfig>;
}): string[] {
  const configOverrides = buildMcpOverrides(params.mcpServers);
  const args: string[] = [];

  for (const override of configOverrides) {
    args.push("--config", override);
  }

  args.push(
    "exec",
    "--skip-git-repo-check",
    "--json",
    "--model",
    params.model,
    params.prompt,
  );

  return args;
}

function buildMcpOverrides(mcpServers: Record<string, MCPServerConfig>): string[] {
  const overrides: string[] = [];
  const names = Object.keys(mcpServers).sort();

  for (const name of names) {
    const server = mcpServers[name];
    const key = `mcp_servers.${toTomlKey(name)}`;

    overrides.push(`${key}.enabled=true`);
    overrides.push(`${key}.command=${toTomlString(server.command)}`);
    overrides.push(`${key}.args=${toTomlArray(server.args)}`);

    if (server.cwd) {
      overrides.push(`${key}.cwd=${toTomlString(server.cwd)}`);
    }

    const envEntries = Object.entries(server.env).sort(([a], [b]) => a.localeCompare(b));
    for (const [envKey, envValue] of envEntries) {
      overrides.push(`${key}.env.${toTomlKey(envKey)}=${toTomlString(envValue)}`);
    }
  }

  return overrides;
}

function toTomlArray(values: string[]): string {
  return `[${values.map((value) => toTomlString(value)).join(", ")}]`;
}

function toTomlString(value: string): string {
  return JSON.stringify(value ?? "");
}

function toTomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key);
}

function buildPrompt(systemPrompt: string, messages: Message[]): string {
  const lines: string[] = [
    "## System Prompt",
    systemPrompt,
    "",
    "## Conversation",
  ];

  for (const message of messages) {
    lines.push(...formatMessage(message));
  }

  lines.push("");
  lines.push("Respond to the latest user request.");
  return lines.join("\n");
}

function formatMessage(message: Message): string[] {
  if (message.role === "tool_result") {
    const results = Array.isArray(message.content) ? (message.content as ToolResult[]) : [];
    const chunks: string[] = ["[tool_result]"];
    for (const result of results) {
      chunks.push(
        `tool_call_id=${result.tool_call_id} tool_name=${result.tool_name ?? "unknown"} is_error=${Boolean(result.is_error)}`,
      );
      chunks.push(result.result);
    }
    return chunks;
  }

  const lines: string[] = [`[${message.role}]`];
  lines.push(typeof message.content === "string" ? message.content : "");

  if (message.role === "assistant" && message.tool_calls && message.tool_calls.length > 0) {
    lines.push("[assistant_tool_calls]");
    for (const toolCall of message.tool_calls) {
      lines.push(`${toolCall.id} ${toolCall.name} ${JSON.stringify(toolCall.arguments ?? {})}`);
    }
  }

  return lines;
}

async function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
  return await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";

    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finalize = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      callback();
    };

    const onAbort = () => {
      child.kill();
      const abortError = new Error("Codex execution aborted");
      abortError.name = "AbortError";
      finalize(() => reject(abortError));
    };

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
    }

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      const maybeErrno = error as NodeJS.ErrnoException;
      if (maybeErrno.code === "ENOENT") {
        finalize(() => reject(new Error(`Codex CLI not found: ${command}. Set CODEX_CLI_PATH correctly.`)));
        return;
      }

      finalize(() => reject(error));
    });

    child.on("close", (code, signal) => {
      if (code === 0) {
        finalize(() => resolve({ stdout, stderr }));
        return;
      }

      const detail = stderr.trim() || stdout.trim() || `signal=${signal ?? "unknown"}`;
      finalize(() => reject(new Error(`Codex CLI exited with code ${code ?? -1}: ${detail}`)));
    });
  });
}

function parseCodexOutput(stdout: string): ParsedCodexOutput {
  let finalText = "";
  let usage = {
    input_tokens: 0,
    output_tokens: 0,
  };
  const errorMessages: string[] = [];

  for (const rawLine of stdout.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (!parsed || typeof parsed !== "object") {
      continue;
    }

    const event = parsed as {
      type?: string;
      message?: string;
      item?: unknown;
      usage?: Record<string, unknown>;
      turn?: { usage?: Record<string, unknown> };
    };

    if (event.type === "error" && typeof event.message === "string" && event.message.trim()) {
      errorMessages.push(event.message.trim());
      continue;
    }

    if (event.type === "item.completed") {
      const candidate = extractItemText(event.item);
      if (candidate.trim()) {
        finalText = candidate.trim();
      }
      continue;
    }

    if (event.type === "turn.completed") {
      const usagePayload = event.usage ?? event.turn?.usage;
      if (usagePayload) {
        usage = {
          input_tokens: readTokenCount(usagePayload, ["input_tokens", "prompt_tokens", "inputTokens"]),
          output_tokens: readTokenCount(usagePayload, ["output_tokens", "completion_tokens", "outputTokens"]),
        };
      }
    }
  }

  return {
    finalText,
    usage,
    errorMessages,
  };
}

function extractItemText(item: unknown): string {
  if (!item || typeof item !== "object") {
    return "";
  }

  const record = item as {
    type?: string;
    text?: unknown;
    output_text?: unknown;
    content?: unknown;
  };

  if (record.type && !record.type.includes("message")) {
    return "";
  }

  if (typeof record.text === "string") {
    return record.text;
  }

  if (typeof record.output_text === "string") {
    return record.output_text;
  }

  if (!Array.isArray(record.content)) {
    return "";
  }

  const fragments = record.content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (!part || typeof part !== "object") {
        return "";
      }

      const contentPart = part as { text?: unknown };
      return typeof contentPart.text === "string" ? contentPart.text : "";
    })
    .filter((part) => part.length > 0);

  return fragments.join("\n").trim();
}

function readTokenCount(payload: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
  }
  return 0;
}
