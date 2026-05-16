import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import JSON5 from 'json5';
import { CONFIG_DIR } from './constants.js';
import { logger } from './logger/logger.js';

export type ServerState = {
  pid: number;
  host: string;
  port: number;
  startedAt: string;
};

const PID_FILE = path.join(CONFIG_DIR, 'server.pid');

export class ServerStateManager {
  static readonly instance = new ServerStateManager();

  private constructor() {}

  save(state: ServerState): void {
    try {
      mkdirSync(CONFIG_DIR, { recursive: true });
      writeFileSync(PID_FILE, JSON.stringify(state, null, 2) + '\n', 'utf8');
    } catch (err) {
      logger.warn('[ServerStateManager] Failed to save state file', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  read(): ServerState | null {
    if (!existsSync(PID_FILE)) {
      return null;
    }
    try {
      const raw = readFileSync(PID_FILE, 'utf8');
      return JSON5.parse(raw) as ServerState;
    } catch (err) {
      logger.warn('[ServerStateManager] Corrupted state file, removing', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.clear();
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

export const serverStateManager = ServerStateManager.instance;
export default serverStateManager;
