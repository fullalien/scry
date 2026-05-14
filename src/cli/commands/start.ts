import type { Command } from "commander";
import { randomUUID } from "node:crypto";
import { createWebServer } from "../../web-server/app.js";
import {
  findRunningSessionByAddress,
  markSessionStopped,
  registerSession,
} from "../../core/sessions/SessionManager.js";
import { appendCliLog } from "../output/logger.js";
import type { AppConfig } from "../config/schema.js";

export function registerStartCommand(program: Command, config: AppConfig) {
  program
    .command("start")
    .description("Start Fastify server and mount Vite app")
    .option("--host <host>", "Host", config.server.host)
    .option("--port <port>", "Port", String(config.server.port))
    .option("--session-name <name>", "Optional human-readable session name")
    .option("--dev", "Run in development mode", false)
    .action(async (options) => {
      const host = options.host as string;
      const port = Number(options.port);
      const dev = Boolean(options.dev);
      const sessionName = options.sessionName as string | undefined;
      const sessionId = randomUUID();

      const existing = findRunningSessionByAddress(host, port);
      if (existing) {
        console.error(
          `Another running session is already bound to ${host}:${port} (session=${existing.id}).`,
        );
        appendCliLog(config.logs.file, {
          level: "error",
          command: "start",
          session: existing.id,
          msg: "Port conflict while starting session",
          details: { host, port },
        });
        process.exitCode = 1;
        return;
      }

      const server = await createWebServer({
        dev,
        scrcpyPath: config.scrcpy.path,
        scrcpyVideoBitRate: config.scrcpy.videoBitRate,
        scrcpyMaxSize: config.scrcpy.maxSize,
        scrcpyMaxFps: config.scrcpy.maxFps,
      });
      await server.listen({ host, port });

      const now = Date.now();
      registerSession({
        id: sessionId,
        name: sessionName,
        host,
        port,
        pid: process.pid,
        dev,
        status: "running",
        createdAt: now,
        updatedAt: now,
      });

      let stopping = false;

      const shutdown = async () => {
        if (stopping) {
          return;
        }
        stopping = true;
        markSessionStopped(sessionId);
        appendCliLog(config.logs.file, {
          level: "info",
          command: "start",
          session: sessionId,
          msg: "Session stopped",
          details: { host, port },
        });
        await server.close();
      };

      process.once("SIGINT", () => {
        void shutdown().finally(() => process.exit(0));
      });
      process.once("SIGTERM", () => {
        void shutdown().finally(() => process.exit(0));
      });
      process.once("exit", () => {
        markSessionStopped(sessionId);
      });

      server.log.info(
        `scrcpy-web started at http://${host}:${port} (dev=${dev}, session=${sessionId}${sessionName ? `, name=${sessionName}` : ""})`,
      );
      appendCliLog(config.logs.file, {
        level: "info",
        command: "start",
        session: sessionId,
        msg: "Session started",
        details: { host, port, dev, sessionName },
      });
    });
}
