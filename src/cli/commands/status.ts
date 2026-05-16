import type { Command } from 'commander';
import chalk from 'chalk';
import { serverStateManager } from '../../core/server-state.js';

export function registerStatusCommand(program: Command) {
  program
    .command('status')
    .description('Show current server status')
    .action(() => {
      const state = serverStateManager.read();
      if (!state || !serverStateManager.isAlive()) {
        console.log(chalk.yellow('Server is not running.'));
        return;
      }

      console.log(chalk.green('Server is running'));
      console.log(`${chalk.bold('PID:')}       ${state.pid}`);
      console.log(
        `${chalk.bold('Address:')}   ${chalk.cyan(`http://${state.host}:${state.port}`)}`
      );
      console.log(`${chalk.bold('Started:')}   ${state.startedAt}`);
    });
}
