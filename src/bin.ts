#!/usr/bin/env node
import { Command } from "commander";
import { registerStartCommand } from "./cli/commands/start.js";
import { registerDevicesCommand } from "./cli/commands/devices.js";
import { registerDoctorCommand } from "./cli/commands/doctor.js";
import { registerSessionsCommand } from "./cli/commands/sessions.js";
import { registerStopCommand } from "./cli/commands/stop.js";
import { registerLogsCommand } from "./cli/commands/logs.js";
import { loadConfig } from "./cli/config/load-config.js";

async function main() {
  const program = new Command();
  const config = loadConfig();

  program
    .name("scrcpy-web")
    .description("scrcpy-web CLI")
    .version("0.1.0");

  registerStartCommand(program, config);
  registerDevicesCommand(program);
  registerDoctorCommand(program, config);
  registerSessionsCommand(program);
  registerStopCommand(program);
  registerLogsCommand(program, config);

  await program.parseAsync(process.argv);
}

main().catch((error) => {
  console.error("Unexpected error:", error);
  process.exit(1);
});
