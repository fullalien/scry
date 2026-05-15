import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type SessionStatus = 'running' | 'stopped';

export type Session = {
  id: string;
  name?: string;
  host: string;
  port: number;
  pid: number;
  dev: boolean;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
};

export type StopSessionResult =
  | 'stopped'
  | 'not-found'
  | 'already-stopped'
  | 'failed';
export type StopAllSessionsResult = {
  stopped: string[];
  failed: string[];
  alreadyStopped: string[];
};
export type ListSessionsOptions = {
  status?: SessionStatus;
};

const STATE_DIR = process.env['SCRCPY_WEB_STATE_DIR']
  ? path.resolve(process.env['SCRCPY_WEB_STATE_DIR'])
  : path.join(homedir(), '.scrcpy-web');
const STATE_FILE = path.join(STATE_DIR, 'sessions.json');
const LEGACY_STATE_FILE = path.resolve(
  process.cwd(),
  '.scrcpy-web',
  'sessions.json'
);
const STOPPED_SESSION_TTL_MS = parseInt(
  process.env['STOPPED_SESSION_TTL_MS'] ?? '3600000',
  10
); // Default: 1 hour

let cleanupIntervalId: NodeJS.Timeout | null = null;

function migrateLegacyStateFileIfNeeded(): void {
  if (existsSync(STATE_FILE) || !existsSync(LEGACY_STATE_FILE)) {
    return;
  }

  mkdirSync(STATE_DIR, { recursive: true });
  copyFileSync(LEGACY_STATE_FILE, STATE_FILE);
}

function readSessionsMap(): Map<string, Session> {
  migrateLegacyStateFileIfNeeded();

  try {
    const raw = readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { sessions?: Session[] };
    const sessions = parsed.sessions ?? [];
    return new Map(sessions.map(session => [session.id, session]));
  } catch {
    return new Map();
  }
}

function writeSessionsMap(sessions: Map<string, Session>): void {
  migrateLegacyStateFileIfNeeded();
  mkdirSync(STATE_DIR, { recursive: true });
  const payload = {
    sessions: [...sessions.values()],
  };
  writeFileSync(STATE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function refreshSessionStates(sessions: Map<string, Session>): void {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (session.status === 'running' && !isProcessAlive(session.pid)) {
      sessions.set(id, {
        ...session,
        status: 'stopped',
        updatedAt: now,
      });
    }
  }
}

function cleanupStoppedSessions(sessions: Map<string, Session>): void {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (
      session.status === 'stopped' &&
      now - session.updatedAt > STOPPED_SESSION_TTL_MS
    ) {
      sessions.delete(id);
    }
  }
}

export function startAutoCleanup(intervalMs = 300000): void {
  // Default: 5 minutes
  if (cleanupIntervalId) return;
  cleanupStoppedSessions(readSessionsMap());
  cleanupIntervalId = setInterval(() => {
    const sessions = readSessionsMap();
    cleanupStoppedSessions(sessions);
    writeSessionsMap(sessions);
  }, intervalMs);
}

export function stopAutoCleanup(): void {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
}

export function listSessions(options?: ListSessionsOptions): Session[] {
  const sessions = readSessionsMap();
  refreshSessionStates(sessions);
  cleanupStoppedSessions(sessions);
  writeSessionsMap(sessions);
  const values = [...sessions.values()].sort(
    (a, b) => b.createdAt - a.createdAt
  );
  if (!options?.status) {
    return values;
  }

  return values.filter(session => session.status === options.status);
}

export function registerSession(session: Session): void {
  const sessions = readSessionsMap();
  refreshSessionStates(sessions);
  sessions.set(session.id, session);
  writeSessionsMap(sessions);
}

export function markSessionStopped(id: string): boolean {
  const sessions = readSessionsMap();
  refreshSessionStates(sessions);
  const session = sessions.get(id);

  if (!session) {
    return false;
  }

  sessions.set(id, {
    ...session,
    status: 'stopped',
    updatedAt: Date.now(),
  });
  writeSessionsMap(sessions);
  return true;
}

export function stopSession(id: string): StopSessionResult {
  const sessions = readSessionsMap();
  refreshSessionStates(sessions);
  const session = sessions.get(id);

  if (!session) {
    return 'not-found';
  }

  if (session.status !== 'running') {
    return 'already-stopped';
  }

  try {
    process.kill(session.pid, 'SIGTERM');
  } catch {
    return 'failed';
  }

  sessions.set(id, {
    ...session,
    status: 'stopped',
    updatedAt: Date.now(),
  });
  writeSessionsMap(sessions);
  return 'stopped';
}

export function stopAllSessions(): StopAllSessionsResult {
  const sessions = readSessionsMap();
  refreshSessionStates(sessions);

  const result: StopAllSessionsResult = {
    stopped: [],
    failed: [],
    alreadyStopped: [],
  };

  for (const [id, session] of sessions.entries()) {
    if (session.status !== 'running') {
      result.alreadyStopped.push(id);
      continue;
    }

    try {
      process.kill(session.pid, 'SIGTERM');
      sessions.set(id, {
        ...session,
        status: 'stopped',
        updatedAt: Date.now(),
      });
      result.stopped.push(id);
    } catch {
      result.failed.push(id);
    }
  }

  writeSessionsMap(sessions);
  return result;
}

export function findRunningSessionByAddress(
  host: string,
  port: number
): Session | null {
  const running = listSessions({ status: 'running' });
  const found = running.find(
    session => session.host === host && session.port === port
  );
  return found ?? null;
}
