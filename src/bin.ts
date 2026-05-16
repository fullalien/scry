#!/usr/bin/env node
import { Command } from 'commander';
import { APP_NAME } from './core/constants.js';
import { registerStartCommand } from './cli/commands/start.js';
import { registerDevicesCommand } from './cli/commands/devices.js';
import { registerDoctorCommand } from './cli/commands/doctor.js';
import { registerSessionsCommand } from './cli/commands/sessions.js';
import { registerStopCommand } from './cli/commands/stop.js';
import { loadConfig } from './core/config/config.js';
import { logger } from './core/logger/logger.js';

async function main() {
  const program = new Command();
  const config = loadConfig();

  logger.configure({
    level: 'info',
    console: false,
  });

  program.name(APP_NAME).description('scrcpy-web CLI').version('0.1.0');

  registerStartCommand(program, config);
  registerDevicesCommand(program);
  registerDoctorCommand(program, config);
  registerSessionsCommand(program);
  registerStopCommand(program);

  await program.parseAsync(process.argv);
}

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
