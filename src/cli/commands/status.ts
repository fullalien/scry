import type { Command } from 'commander';
import { serverStateManager } from '../../core/server-state.js';

export function registerStatusCommand(program: Command) {
  program
    .command('status')
    .description('Show current server status')
    .action(() => {
      const state = serverStateManager.read();
      if (!state || !serverStateManager.isAlive()) {
        console.log('Server is not running.');
        return;
      }

      const startedAt = new Date(state.startedAt).toISOString();
      console.log(`Server is running`);
      console.log(`  PID:       ${state.pid}`);
      console.log(`  Address:   http://${state.host}:${state.port}`);
      console.log(`  Mode:      ${state.dev ? 'development' : 'production'}`);
      console.log(`  Started:   ${startedAt}`);
    });
}
