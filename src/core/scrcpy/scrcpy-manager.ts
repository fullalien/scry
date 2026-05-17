import { randomUUID } from 'node:crypto';
import {
  ScrcpyServer,
  type ScrcpyServerOptions,
  type ScrcpyServerStats,
} from './scrcpy-server.js';
import { logger } from '../logger/logger.js';

export type ScrcpySessionStatus = 'running' | 'stopped' | 'error';

export type ScrcpySession = {
  id: string;
  deviceSerial: string;
  pid: number;
  status: ScrcpySessionStatus;
  createdAt: number;
  updatedAt: number;
  error?: string;
  stats?: ScrcpyServerStats;
  viewerCount: number;
};

export type StartScrcpyOptions = Partial<
  Omit<ScrcpyServerOptions, 'deviceSerial'>
>;

export type StartScrcpyResult =
  | { ok: true; session: ScrcpySession }
  | { ok: false; error: string };

export type StopScrcpyResult = 'stopped' | 'not-found' | 'already-stopped';

type ScrcpyEntry = {
  session: ScrcpySession;
  process: ScrcpyServer;
  viewerCount: number;
};

export class ScrcpyManager {
  static readonly instance = new ScrcpyManager();

  private readonly entries = new Map<string, ScrcpyEntry>();
  private readonly pendingStarts = new Map<
    string,
    Promise<ScrcpySession | null>
  >();

  private constructor() {}

  async start(
    deviceSerial: string,
    options?: StartScrcpyOptions
  ): Promise<StartScrcpyResult> {
    for (const entry of this.entries.values()) {
      if (
        entry.session.deviceSerial === deviceSerial &&
        entry.session.status === 'running'
      ) {
        return {
          ok: false,
          error: `scrcpy already running for device ${deviceSerial} (session=${entry.session.id})`,
        };
      }
    }

    if (this.pendingStarts.has(deviceSerial)) {
      return {
        ok: false,
        error: `scrcpy start already in progress for device ${deviceSerial}`,
      };
    }

    const session = await this.doStart(deviceSerial, options);
    if (!session) {
      return {
        ok: false,
        error: 'Failed to start scrcpy-server',
      };
    }

    return { ok: true, session };
  }

  async startForViewer(
    deviceSerial: string,
    options?: StartScrcpyOptions
  ): Promise<
    { ok: true; session: ScrcpySession } | { ok: false; error: string }
  > {
    for (const entry of this.entries.values()) {
      if (
        entry.session.deviceSerial === deviceSerial &&
        entry.session.status === 'running'
      ) {
        entry.viewerCount++;
        logger.info('[ScrcpyManager] Viewer added to existing session', {
          sessionId: entry.session.id,
          deviceSerial,
          viewerCount: entry.viewerCount,
        });
        return { ok: true, session: entry.session };
      }
    }

    let pending = this.pendingStarts.get(deviceSerial);
    if (!pending) {
      pending = this.doStart(deviceSerial, options);
      this.pendingStarts.set(deviceSerial, pending);
    }

    const session = await pending;
    this.pendingStarts.delete(deviceSerial);

    if (!session) {
      return { ok: false, error: 'Failed to start scrcpy-server' };
    }

    const entry = this.entries.get(session.id);
    if (!entry) {
      return { ok: false, error: 'Session was already removed' };
    }

    entry.viewerCount++;
    logger.info('[ScrcpyManager] Viewer added to new session', {
      sessionId: session.id,
      deviceSerial,
      viewerCount: entry.viewerCount,
    });
    return { ok: true, session };
  }

  removeViewer(deviceSerial: string): void {
    for (const [id, entry] of this.entries) {
      if (entry.session.deviceSerial === deviceSerial) {
        entry.viewerCount = Math.max(0, entry.viewerCount - 1);
        logger.info('[ScrcpyManager] Viewer removed', {
          sessionId: id,
          deviceSerial,
          viewerCount: entry.viewerCount,
        });
        if (entry.viewerCount === 0) {
          logger.info(
            '[ScrcpyManager] Last viewer disconnected, auto-stopping',
            {
              sessionId: id,
              deviceSerial,
            }
          );
          entry.process.stop();
        }
        return;
      }
    }
  }

  getViewerCount(deviceSerial: string): number {
    for (const entry of this.entries.values()) {
      if (entry.session.deviceSerial === deviceSerial) {
        return entry.viewerCount;
      }
    }
    return 0;
  }

  private async doStart(
    deviceSerial: string,
    options?: StartScrcpyOptions
  ): Promise<ScrcpySession | null> {
    const id = randomUUID();
    const now = Date.now();

    const server = new ScrcpyServer();

    try {
      logger.info('Starting scrcpy-server', { sessionId: id, deviceSerial });
      await server.start({
        deviceSerial,
        maxSize: options?.maxSize,
        maxFps: options?.maxFps,
        videoBitRate: options?.videoBitRate,
        control: true,
      });
    } catch (err) {
      try {
        server.stop();
      } catch {
        /* best-effort cleanup */
      }
      logger.error('scrcpy-session start failed', {
        deviceSerial,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }

    const session: ScrcpySession = {
      id,
      deviceSerial,
      pid: server.pid,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      viewerCount: 0,
    };

    this.entries.set(id, { session, process: server, viewerCount: 0 });

    logger.info('scrcpy-session started', {
      sessionId: id,
      deviceSerial,
      pid: server.pid,
    });

    server.on('exit', () => {
      logger.info('scrcpy-server exited', { sessionId: id });
      this.entries.delete(id);
    });

    server.on('error', err => {
      logger.error('scrcpy-server error', {
        sessionId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      const entry = this.entries.get(id);
      if (entry) {
        this.entries.set(id, {
          ...entry,
          session: {
            ...entry.session,
            status: 'error',
            updatedAt: Date.now(),
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    });

    return session;
  }

  stop(id: string): StopScrcpyResult {
    const entry = this.entries.get(id);
    if (!entry) return 'not-found';
    if (entry.session.status !== 'running') return 'already-stopped';

    logger.info('stopping scrcpy-session', {
      sessionId: id,
      deviceSerial: entry.session.deviceSerial,
    });
    entry.process.stop();
    return 'stopped';
  }

  stopByDevice(deviceSerial: string): StopScrcpyResult {
    for (const [id, entry] of this.entries) {
      if (
        entry.session.deviceSerial === deviceSerial &&
        entry.session.status === 'running'
      ) {
        return this.stop(id);
      }
    }
    return 'not-found';
  }

  stopAll(): void {
    for (const id of this.entries.keys()) {
      this.stop(id);
    }
  }

  list(): ScrcpySession[] {
    return [...this.entries.values()]
      .map(e => ({
        ...e.session,
        viewerCount: e.viewerCount,
        stats: e.process.getStats(),
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getProcess(id: string): ScrcpyServer | undefined {
    return this.entries.get(id)?.process;
  }
}

export const scrcpyManager = ScrcpyManager.instance;
export default scrcpyManager;
