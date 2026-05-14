import { z } from "zod";

export const appConfigSchema = z.object({
  server: z.object({
    host: z.string().default("127.0.0.1"),
    port: z.number().int().min(1).max(65535).default(8787),
  }).default({ host: "127.0.0.1", port: 8787 }),
  adb: z.object({
    path: z.string().default("adb"),
  }).default({ path: "adb" }),
  scrcpy: z.object({
    path: z.string().default("scrcpy"),
    maxSize: z.number().int().positive().optional(),
    videoBitRate: z.string().default("8M"),
    maxFps: z.number().int().positive().optional(),
  }).default({ path: "scrcpy", videoBitRate: "8M" }),
  logs: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
    file: z.string().default("~/.scrcpy-web/logs/app.log"),
  }).default({ level: "info", file: "~/.scrcpy-web/logs/app.log" }),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
