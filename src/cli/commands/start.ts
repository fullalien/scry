import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { serverStateManager } from '../../core/server-state.js';
import { homedir } from 'node:os';
import type { AppConfig } from '../../core/config/schema.js';
import { getAvailablePort } from '../../core/net/port.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function registerStartCommand(program: Command, config: AppConfig) {
  program
    .command('start')
    .description('Start the scry server')
    .option('--host <host>', 'Host', config.server.host)
    .option('--port <port>', 'Port', config.server.port.toString())
    .option('--foreground', 'Run in foreground for debugging', false)
    .action(async options => {
      const host = options.host as string;
      // Resolve available port (in case preferred port is occupied)
      const port = await getAvailablePort(host, Number(options.port));
      const foreground = options.foreground as boolean;

      if (foreground) {
        await runForegroundServer(host, port, config);
        console.log(`Server running at http://${host}:${port}`);
        return;
      }

      // Background mode: spawn a foreground child
      const existing = serverStateManager.read();
      if (existing && serverStateManager.isAlive()) {
        console.error(
          `Server is already running at http://${existing.host}:${existing.port} (PID ${existing.pid}).`
        );
        process.exitCode = 1;
        return;
      }

      const binPath = path.resolve(__dirname, '../../bin.js');
      const child = spawn(
        process.execPath,
        [
          binPath,
          'start',
          '--foreground',
          '--host',
          host,
          '--port',
          String(port),
        ],
        {
          cwd: homedir(),
          detached: true,
          stdio: 'inherit',
        }
      );

      // Wait for server to become ready
      const ready = await waitForServer(host, port, 15_000);
      if (!ready) {
        console.error('Server failed to start. Check logs above.');
        child.kill('SIGTERM');
        process.exitCode = 1;
        return;
      }

      const state = {
        pid: child.pid!,
        host,
        port,
        startedAt: new Date().toLocaleString(),
      };
      serverStateManager.save(state);

      // Detach child so it survives parent exit
      child.unref();
    });
}

async function waitForServer(
  host: string,
  port: number,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const ok = await tryHealthCheck(host, port);
    if (ok) return true;
  }
  return false;
}

function tryHealthCheck(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get(
      `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}/api/health`,
      res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode === 200));
      }
    );
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function runForegroundServer(host: string, port: number, config: AppConfig): Promise<void> {
  const { createServer } = await import('../../server/server.js');
  const server = await createServer({
    scrcpyMaxSize: config.scrcpy.maxSize,
    scrcpyVideoBitRate: config.scrcpy.videoBitRate,
    scrcpyMaxFps: config.scrcpy.maxFps,
  });
  await server.listen({ host, port });
}
