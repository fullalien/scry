import type { Command } from 'commander';
import { randomUUID } from 'node:crypto';
import { createWebServer } from '../../web-server/app.js';
import {
  findRunningSessionByAddress,
  markSessionStopped,
  registerSession,
} from '../../core/sessions/session-manager.js';
import { initLogger, getLogger } from '../../core/logger/logger.js';
import type { AppConfig } from '../config/schema.js';

export function registerStartCommand(program: Command, config: AppConfig) {
  program
    .command('start')
    .description('Start Fastify server and mount Vite app')
    .option('--host <host>', 'Host', config.server.host)
    .option('--port <port>', 'Port', String(config.server.port))
    .option('--session-name <name>', 'Optional human-readable session name')
    .action(async options => {
      // Initialize logger early so all subsequent operations are logged
      initLogger({
        level: config.logs.level,
        file: config.logs.file,
      });

      const host = options.host as string;
      const port = Number(options.port);
      const sessionName = options.sessionName as string | undefined;
      const sessionId = randomUUID();

      const existing = findRunningSessionByAddress(host, port);
      if (existing) {
        getLogger().error(
          `Another running session is already bound to ${host}:${port} (session=${existing.id}).`
        );
        getLogger().appendCliLog({
          level: 'error',
          command: 'start',
          session: existing.id,
          msg: 'Port conflict while starting session',
          details: { host, port },
        });
        process.exitCode = 1;
        return;
      }

      const server = await createWebServer({
        scrcpyVideoBitRate: config.scrcpy.videoBitRate,
        scrcpyMaxSize: config.scrcpy.maxSize,
        scrcpyMaxFps: config.scrcpy.maxFps,
        logger: {
          level: config.logs.level,
          file: config.logs.file,
        },
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
        getLogger().appendCliLog({
          level: 'info',
          command: 'start',
          session: sessionId,
          msg: 'Session stopped',
          details: { host, port },
        });
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

      getLogger().info(
        `scrcpy-web started at http://${host}:${port} (session=${sessionId}${sessionName ? `, name=${sessionName}` : ''})`
      );
      getLogger().appendCliLog({
        level: 'info',
        command: 'start',
        session: sessionId,
        msg: 'Session started',
        details: { host, port, sessionName },
      });
    });
}
