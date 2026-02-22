export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  private readonly minLevel: LogLevel;

  constructor(level: LogLevel = "info") {
    this.minLevel = level;
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.log("debug", message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.log("info", message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.log("warn", message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.log("error", message, metadata);
  }

  private log(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(metadata ? { metadata } : {}),
    };

    const serialized = JSON.stringify(payload);
    if (level === "error" || level === "warn") {
      console.error(serialized);
      return;
    }

    console.log(serialized);
  }
}

const configuredLevel = (process.env.LOG_LEVEL as LogLevel | undefined) ?? "info";
export const logger = new Logger(configuredLevel);
