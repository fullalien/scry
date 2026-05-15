import type { Command } from "commander";
import { execFile } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import type { AppConfig } from "../config/schema.js";
import { initLogger, getLogger } from "../../core/logger/logger.js";

const execFileAsync = promisify(execFile);

async function isPortAvailable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => {
      resolve(false);
    });

    server.once("listening", () => {
      server.close(() => resolve(true));
    });

    server.listen(port, host);
  });
}

export function registerDoctorCommand(program: Command, config: AppConfig) {
  program
    .command("doctor")
    .description("Run environment checks")
    .option("--host <host>", "Host for port check", config.server.host)
    .option("--port <port>", "Port for port check", String(config.server.port))
    .action(async (options) => {
      initLogger({
        level: config.logs.level,
        file: config.logs.file,
      });

      const host = options.host as string;
      const port = Number(options.port);
      let adbOk = false;
      let scrcpyOk = false;
      let portAvailable = false;

      try {
        await execFileAsync(config.adb.path, ["version"]);
        adbOk = true;
      } catch {
        adbOk = false;
      }

      try {
        await execFileAsync(config.scrcpy.path, ["--version"]);
        scrcpyOk = true;
      } catch {
        scrcpyOk = false;
      }

      portAvailable = await isPortAvailable(host, port);

      getLogger().info(`Node.js: ${process.version}`);
      getLogger().info(`adb: ${adbOk ? "ok" : "missing"}`);
      getLogger().info(`scrcpy: ${scrcpyOk ? "ok" : "missing"}`);
      getLogger().info(`port ${host}:${port}: ${portAvailable ? "available" : "in use"}`);
      getLogger().info("WebCodecs: check in browser runtime (feature-detect in client)");

      getLogger().appendCliLog({
        level: "info",
        command: "doctor",
        msg: "Doctor checks completed",
        details: {
          adbOk,
          scrcpyOk,
          host,
          port,
          portAvailable,
        },
      });
    });
}
