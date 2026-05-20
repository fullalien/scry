#!/usr/bin/env node
import { Command } from 'commander';
import { APP_NAME, APP_VERSION } from './core/constants.js';
import { registerStartCommand } from './cli/commands/start.js';
import { registerDevicesCommand } from './cli/commands/devices.js';
import { registerDoctorCommand } from './cli/commands/doctor.js';
import { registerStatusCommand } from './cli/commands/status.js';
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

  program.name(APP_NAME).description('scry CLI').version(APP_VERSION);

  registerStartCommand(program, config);
  registerDevicesCommand(program);
  registerDoctorCommand(program, config);
  registerStatusCommand(program);
  registerStopCommand(program);

  await program.parseAsync(process.argv);
}

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
