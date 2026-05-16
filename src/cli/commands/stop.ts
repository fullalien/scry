import type { Command } from 'commander';
import { serverStateManager } from '../../core/server-state.js';

export function registerStopCommand(program: Command) {
  program
    .command('stop')
    .description('Stop the running server')
    .action(() => {
      const state = serverStateManager.read();
      if (!state) {
        console.log('No running server found.');
        return;
      }

      try {
        process.kill(state.pid, 'SIGTERM');
      } catch {
        console.log(`Process ${state.pid} is not running.`);
        serverStateManager.clear();
        return;
      }

      console.log(`Sent SIGTERM to server (PID ${state.pid}).`);
      serverStateManager.clear();
    });
}
