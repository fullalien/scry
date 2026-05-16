import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_DIR } from './constants.js';

export type ServerState = {
  pid: number;
  host: string;
  port: number;
  dev: boolean;
  startedAt: number;
};

const PID_FILE = path.join(CONFIG_DIR, 'server.pid');

export class ServerStateManager {

  save(state: ServerState): void {
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(PID_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
  }

  read(): ServerState | null {
    if (!existsSync(PID_FILE)) {
      return null;
    }
    try {
      const raw = readFileSync(PID_FILE, 'utf8');
      return JSON.parse(raw) as ServerState;
    } catch {
      return null;
    }
  }

  clear(): void {
    if (existsSync(PID_FILE)) {
      rmSync(PID_FILE);
    }
  }

  isAlive(): boolean {
    const state = this.read();
    if (!state) {
      return false;
    }
    try {
      process.kill(state.pid, 0);
      return true;
    } catch {
      this.clear();
      return false;
    }
  }
}

export const serverStateManager = new ServerStateManager();
export default serverStateManager;
