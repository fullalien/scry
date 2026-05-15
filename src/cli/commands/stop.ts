import type { Command } from "commander";
import { stopAllSessions, stopSession } from "../../core/sessions/session-manager.js";
import { loadConfig } from "../config/load-config.js";
import { initLogger, getLogger } from "../../core/logger/logger.js";

export function registerStopCommand(program: Command) {
  const config = loadConfig();
  initLogger({
    level: config.logs.level,
    file: config.logs.file,
  });

  program
    .command("stop")
    .description("Stop one session or all sessions")
    .option("--session <id>", "Session id")
    .option("--all", "Stop all sessions", false)
    .action((options) => {
      const stopAll = Boolean(options.all);
      const id = options.session as string | undefined;

      if (!stopAll && !id) {
        getLogger().error("Provide --session <id> or --all");
        getLogger().appendCliLog({
          level: "error",
          command: "stop",
          msg: "Invalid stop arguments",
        });
        process.exitCode = 1;
        return;
      }

      if (stopAll) {
        const result = stopAllSessions();
        getLogger().info(
          `Stop all finished: stopped=${result.stopped.length}, already-stopped=${result.alreadyStopped.length}, failed=${result.failed.length}`,
        );
        if (result.failed.length > 0) {
          process.exitCode = 1;
        }
        getLogger().appendCliLog({
          level: result.failed.length > 0 ? "warn" : "info",
          command: "stop",
          msg: "Stop all executed",
          details: result,
        });
        return;
      }

      const targetId = id as string;
      const result = stopSession(targetId);

      if (result === "not-found") {
        getLogger().warn(`Session not found: ${targetId}`);
        getLogger().appendCliLog({
          level: "warn",
          command: "stop",
          session: targetId,
          msg: "Session not found",
        });
        process.exitCode = 1;
        return;
      }

      if (result === "already-stopped") {
        getLogger().info(`Session already stopped: ${targetId}`);
        getLogger().appendCliLog({
          level: "info",
          command: "stop",
          session: targetId,
          msg: "Session already stopped",
        });
        return;
      }

      if (result === "failed") {
        getLogger().error(`Failed to stop session: ${targetId}`);
        getLogger().appendCliLog({
          level: "error",
          command: "stop",
          session: targetId,
          msg: "Session stop failed",
        });
        process.exitCode = 1;
        return;
      }

      getLogger().info(`Stopped session: ${targetId}`);
      getLogger().appendCliLog({
        level: "info",
        command: "stop",
        session: targetId,
        msg: "Session stopped",
      });
    });
}
