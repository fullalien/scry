import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const DEFAULT_LOG_FILE = path.join(homedir(), 'scrcpy-web', 'logs', 'app.log');

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
  console?: boolean;
};

export class Logger {
  private minLevel: LogLevel;
  private logToConsole: boolean;

  constructor(options: LoggerOptions = {}) {
    this.minLevel = options.level ?? 'info';
    this.logToConsole = options.console ?? false;
  }

  configure(options: LoggerOptions): void {
    if (options.level !== undefined) {
      this.minLevel = options.level;
    }
    if (options.console !== undefined) {
      this.logToConsole = options.console;
    }
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

    try {
      mkdirSync(path.dirname(DEFAULT_LOG_FILE), { recursive: true });
      appendFileSync(DEFAULT_LOG_FILE, `${line}\n`, 'utf8');
    } catch {
      // Silently fail if we can't write to the log file
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

export const logger = new Logger({ console: true });
export default logger;
