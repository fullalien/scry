import type { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { createServer } from '../../server/server.js';
import {
  findRunningSessionByAddress,
  markSessionStopped,
  registerSession,
} from '../../core/sessions/session-manager.js';
import type { AppConfig } from '../../core/config/schema.js';

export function registerStartCommand(program: Command, config: AppConfig) {
  program
    .command('start')
    .description('Start Fastify server and mount Vite app')
    .option('--host <host>', 'Host', config.server.host)
    .option('--port <port>', 'Port', String(config.server.port))
    .option('--session-name <name>', 'Optional human-readable session name')
    .action(async options => {
      const host = options.host as string;
      const port = Number(options.port);
      const sessionName = options.sessionName as string | undefined;
      const sessionId = randomUUID();

      const existing = findRunningSessionByAddress(host, port);
      if (existing) {
        console.error(
          `Another running session is already bound to ${host}:${port} (session=${existing.id}).`
        );
        process.exitCode = 1;
        return;
      }

      const server = await createServer({
        scrcpyVideoBitRate: config.scrcpy.videoBitRate,
        scrcpyMaxSize: config.scrcpy.maxSize,
        scrcpyMaxFps: config.scrcpy.maxFps,
      });
      await server.listen({ host, port });

      const now = Date.now();
      registerSession({
        id: sessionId,
        name: sessionName,
        host,
        port,
        pid: process.pid,
        dev: false,
        status: 'running',
        createdAt: now,
        updatedAt: now,
      });

      let stopping = false;

      const shutdown = async () => {
        if (stopping) {
          return;
        }
        stopping = true;
        markSessionStopped(sessionId);
        await server.close();
      };

      process.once('SIGINT', () => {
        void shutdown().finally(() => process.exit(0));
      });
      process.once('SIGTERM', () => {
        void shutdown().finally(() => process.exit(0));
      });
      process.once('exit', () => {
        markSessionStopped(sessionId);
      });

      console.info(
        `scrcpy-web started at http://${host}:${port} (session=${sessionId}${sessionName ? `, name=${sessionName}` : ''})`
      );
    });
}
