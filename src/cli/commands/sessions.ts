import type { Command } from "commander";
import { listSessions } from "../../core/sessions/session-manager.js";

export function registerSessionsCommand(program: Command) {
  program
    .command("sessions")
    .description("List scrcpy-web sessions")
    .option("--all", "Include stopped sessions", false)
    .option("--running", "Only show running sessions", false)
    .action((options) => {
      const includeAll = Boolean(options.all);
      const runningOnly = Boolean(options.running);
      const status = includeAll ? undefined : "running";
      const sessions = listSessions({ status: runningOnly ? "running" : status });

      if (sessions.length === 0) {
        console.log("No sessions found.");
        return;
      }

      for (const session of sessions) {
        const createdAt = new Date(session.createdAt).toISOString();
        const name = session.name ? `name=${session.name}\t` : "";
        console.log(
          `${session.id}\t${session.status}\t${name}pid=${session.pid}\t${session.host}:${session.port}\tcreated=${createdAt}`,
        );
      }
    });
}
