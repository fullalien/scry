import type { Command } from 'commander';
import { execFile } from 'node:child_process';
import net from 'node:net';
import { promisify } from 'node:util';
import type { AppConfig } from '../../core/config/schema.js';

const execFileAsync = promisify(execFile);

async function isPortAvailable(host: string, port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();

    server.once('error', () => {
      resolve(false);
    });

    server.once('listening', () => {
      server.close(() => resolve(true));
    });

    server.listen(port, host);
  });
}

export function registerDoctorCommand(program: Command, config: AppConfig) {
  program
    .command('doctor')
    .description('Run environment checks')
    .option('--host <host>', 'Host for port check', config.server.host)
    .option('--port <port>', 'Port for port check', String(config.server.port))
    .action(async options => {
      const host = options.host as string;
      const port = Number(options.port);
      let adbOk = false;
      let adbError = '';
      let portAvailable = false;

      try {
        await execFileAsync(config.adb.path, ['version']);
        adbOk = true;
      } catch (e: any) {
        adbError = e?.message || e?.stderr || String(e);
      }

      portAvailable = await isPortAvailable(host, port);

      console.log(`Node.js: ${process.version}`);
      console.log(`adb: ${adbOk ? 'ok' : `missing (${adbError})`}`);
      console.log(
        `port ${host}:${port}: ${portAvailable ? 'available' : 'in use'}`
      );
    });
}
