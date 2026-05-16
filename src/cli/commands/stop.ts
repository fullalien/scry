import type { Command } from 'commander';
import {
  stopAllSessions,
  stopSession,
} from '../../core/sessions/session-manager.js';

export function registerStopCommand(program: Command) {
  program
    .command('stop')
    .description('Stop one session or all sessions')
    .option('--session <id>', 'Session id')
    .option('--all', 'Stop all sessions', false)
    .action(options => {
      const stopAll = Boolean(options.all);
      const id = options.session as string | undefined;

      if (!stopAll && !id) {
        console.error('Provide --session <id> or --all');
        process.exitCode = 1;
        return;
      }

      if (stopAll) {
        const result = stopAllSessions();
        console.info(
          `Stop all finished: stopped=${result.stopped.length}, already-stopped=${result.alreadyStopped.length}, failed=${result.failed.length}`
        );
        if (result.failed.length > 0) {
          process.exitCode = 1;
        }
        return;
      }

      const targetId = id as string;
      const result = stopSession(targetId);

      if (result === 'not-found') {
        console.warn(`Session not found: ${targetId}`);
        process.exitCode = 1;
        return;
      }

      if (result === 'already-stopped') {
        console.info(`Session already stopped: ${targetId}`);
        return;
      }

      if (result === 'failed') {
        console.error(`Failed to stop session: ${targetId}`);
        process.exitCode = 1;
        return;
      }

      console.info(`Stopped session: ${targetId}`);
    });
}
