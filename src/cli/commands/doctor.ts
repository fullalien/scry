import type { Command } from "commander";
import { execFile } from "node:child_process";
import net from "node:net";
import { promisify } from "node:util";
import type { AppConfig } from "../config/schema.js";
import { appendCliLog } from "../output/logger.js";

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

      console.log(`Node.js: ${process.version}`);
      console.log(`adb: ${adbOk ? "ok" : "missing"}`);
      console.log(`scrcpy: ${scrcpyOk ? "ok" : "missing"}`);
      console.log(`port ${host}:${port}: ${portAvailable ? "available" : "in use"}`);
      console.log("WebCodecs: check in browser runtime (feature-detect in client)");

      appendCliLog(config.logs.file, {
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
