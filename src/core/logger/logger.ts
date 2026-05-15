import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "DEBUG",
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

export type LoggerOptions = {
  level?: LogLevel;
  file?: string;
  console?: boolean;
};

function resolveLogPath(file: string): string {
  if (file.startsWith("~")) {
    return path.join(homedir(), file.slice(1));
  }
  return path.resolve(file);
}

export class Logger {
  private readonly minLevel: LogLevel;
  private readonly logFile: string | null;
  private readonly logToConsole: boolean;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = options.level ?? "info";
    this.logFile = options.file ? resolveLogPath(options.file) : null;
    this.logToConsole = options.console ?? false;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel];
  }

  private format(level: LogLevel, msg: string, context?: Record<string, unknown>): string {
    const ts = new Date().toISOString();
    const levelLabel = LEVEL_LABELS[level];
    const ctx = context ? ` ${JSON.stringify(context)}` : "";
    return `[${ts}] [${levelLabel}] ${msg}${ctx}`;
  }

  private write(level: LogLevel, msg: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const line = this.format(level, msg, context);

    if (this.logToConsole) {
      if (level === "error") {
        console.error(line);
      } else if (level === "warn") {
        console.warn(line);
      } else {
        console.log(line);
      }
    }

    if (this.logFile) {
      try {
        mkdirSync(path.dirname(this.logFile), { recursive: true });
        appendFileSync(this.logFile, `${line}\n`, "utf8");
      } catch {
        // Silently fail if we can't write to the log file
      }
    }
  }

  debug(msg: string, context?: Record<string, unknown>): void {
    this.write("debug", msg, context);
  }

  info(msg: string, context?: Record<string, unknown>): void {
    this.write("info", msg, context);
  }

  warn(msg: string, context?: Record<string, unknown>): void {
    this.write("warn", msg, context);
  }

  error(msg: string, context?: Record<string, unknown>): void {
    this.write("error", msg, context);
  }

  appendCliLog(record: {
    level: LogLevel;
    command?: string;
    session?: string;
    msg: string;
    details?: Record<string, unknown>;
  }): void {
    if (!this.logFile) return;

    const finalRecord = {
      ts: new Date().toISOString(),
      level: record.level,
      command: record.command,
      session: record.session,
      msg: record.msg,
      details: record.details,
    };

    try {
      mkdirSync(path.dirname(this.logFile), { recursive: true });
      appendFileSync(this.logFile, `${JSON.stringify(finalRecord)}\n`, "utf8");
    } catch {
      // Silently fail if we can't write to the log file
    }
  }
}

let defaultLogger: Logger | null = null;

export function initLogger(options: LoggerOptions = {}): Logger {
  if (defaultLogger) {
    return defaultLogger;
  }
  defaultLogger = new Logger(options);
  return defaultLogger;
}

export function getLogger(): Logger {
  if (!defaultLogger) {
    defaultLogger = new Logger({ console: true });
  }
  return defaultLogger;
}
