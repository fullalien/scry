import type { Command } from "commander";
import { stopAllSessions, stopSession } from "../../core/sessions/SessionManager.js";
import { loadConfig } from "../config/loadConfig.js";
import { appendCliLog } from "../output/logger.js";

export function registerStopCommand(program: Command) {
  const config = loadConfig();

  program
    .command("stop")
    .description("Stop one session or all sessions")
    .option("--session <id>", "Session id")
    .option("--all", "Stop all sessions", false)
    .action((options) => {
      const stopAll = Boolean(options.all);
      const id = options.session as string | undefined;

      if (!stopAll && !id) {
        console.log("Provide --session <id> or --all");
        appendCliLog(config.logs.file, {
          level: "error",
          command: "stop",
          msg: "Invalid stop arguments",
        });
        process.exitCode = 1;
        return;
      }

      if (stopAll) {
        const result = stopAllSessions();
        console.log(
          `Stop all finished: stopped=${result.stopped.length}, already-stopped=${result.alreadyStopped.length}, failed=${result.failed.length}`,
        );
        if (result.failed.length > 0) {
          process.exitCode = 1;
        }
        appendCliLog(config.logs.file, {
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
        console.log(`Session not found: ${targetId}`);
        appendCliLog(config.logs.file, {
          level: "warn",
          command: "stop",
          session: targetId,
          msg: "Session not found",
        });
        process.exitCode = 1;
        return;
      }

      if (result === "already-stopped") {
        console.log(`Session already stopped: ${targetId}`);
        appendCliLog(config.logs.file, {
          level: "info",
          command: "stop",
          session: targetId,
          msg: "Session already stopped",
        });
        return;
      }

      if (result === "failed") {
        console.log(`Failed to stop session: ${targetId}`);
        appendCliLog(config.logs.file, {
          level: "error",
          command: "stop",
          session: targetId,
          msg: "Session stop failed",
        });
        process.exitCode = 1;
        return;
      }

      console.log(`Stopped session: ${targetId}`);
      appendCliLog(config.logs.file, {
        level: "info",
        command: "stop",
        session: targetId,
        msg: "Session stopped",
      });
    });
}
