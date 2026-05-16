import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

export type LoggerOptions = {
  level?: LogLevel;
  file?: string;
  console?: boolean;
};

function resolveLogPath(file: string): string {
  if (file.startsWith('~')) {
    return path.join(homedir(), file.slice(1));
  }
  return path.resolve(file);
}

export class Logger {
  private static instance: Logger | null = null;
  private readonly minLevel: LogLevel;
  private readonly logFile: string | null;
  private readonly logToConsole: boolean;

  private constructor(options: LoggerOptions = {}) {
    this.minLevel = options.level ?? 'info';
    this.logFile = options.file ? resolveLogPath(options.file) : null;
    this.logToConsole = options.console ?? false;
  }

  static init(options: LoggerOptions = {}): Logger {
    if (Logger.instance) {
      return Logger.instance;
    }
    Logger.instance = new Logger(options);
    return Logger.instance;
  }

  static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger({ console: true });
    }
    return Logger.instance;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel];
  }

  private format(
    level: LogLevel,
    msg: string,
    context?: Record<string, unknown>
  ): string {
    const ts = new Date().toISOString();
    const levelLabel = LEVEL_LABELS[level];
    const ctx = context ? ` ${JSON.stringify(context)}` : '';
    return `[${ts}] [${levelLabel}] ${msg}${ctx}`;
  }

  private write(
    level: LogLevel,
    msg: string,
    context?: Record<string, unknown>
  ): void {
    if (!this.shouldLog(level)) return;

    const line = this.format(level, msg, context);

    if (this.logToConsole) {
      if (level === 'error') {
        console.error(line);
      } else if (level === 'warn') {
        console.warn(line);
      } else {
        console.log(line);
      }
    }

    if (this.logFile) {
      try {
        mkdirSync(path.dirname(this.logFile), { recursive: true });
        appendFileSync(this.logFile, `${line}\n`, 'utf8');
      } catch {
        // Silently fail if we can't write to the log file
      }
    }
  }

  debug(msg: string, context?: Record<string, unknown>): void {
    this.write('debug', msg, context);
  }

  info(msg: string, context?: Record<string, unknown>): void {
    this.write('info', msg, context);
  }

  warn(msg: string, context?: Record<string, unknown>): void {
    this.write('warn', msg, context);
  }

  error(msg: string, context?: Record<string, unknown>): void {
    this.write('error', msg, context);
  }
}

export const logger = Logger.getInstance();
export default logger;
