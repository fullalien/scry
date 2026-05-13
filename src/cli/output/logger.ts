import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export type CliLogLevel = "debug" | "info" | "warn" | "error";

export type CliLogRecord = {
  ts: string;
  level: CliLogLevel;
  msg: string;
  command?: string;
  session?: string;
  details?: Record<string, unknown>;
};

export function appendCliLog(logFilePath: string, record: Omit<CliLogRecord, "ts">): void {
  const finalRecord: CliLogRecord = {
    ts: new Date().toISOString(),
    ...record,
  };

  mkdirSync(path.dirname(logFilePath), { recursive: true });
  appendFileSync(logFilePath, `${JSON.stringify(finalRecord)}\n`, "utf8");
}
