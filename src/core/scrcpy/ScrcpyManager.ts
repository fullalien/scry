import { randomUUID } from "node:crypto";
import { ScrcpyServer, type ScrcpyServerOptions } from "./ScrcpyServer.js";

export type ScrcpySessionStatus = "running" | "stopped" | "error";

export type ScrcpySession = {
  id: string;
  deviceSerial: string;
  pid: number;
  status: ScrcpySessionStatus;
  createdAt: number;
  updatedAt: number;
};

export type StartScrcpyOptions = Partial<
  Omit<ScrcpyServerOptions, "deviceSerial">
>;

export type StartScrcpyResult =
  | { ok: true; session: ScrcpySession }
  | { ok: false; error: string };

export type StopScrcpyResult = "stopped" | "not-found" | "already-stopped";

type ScrcpyEntry = { session: ScrcpySession; process: ScrcpyServer };

export class ScrcpyManager {
  private readonly entries = new Map<string, ScrcpyEntry>();

  async start(
    deviceSerial: string,
    options?: StartScrcpyOptions,
  ): Promise<StartScrcpyResult> {
    for (const entry of this.entries.values()) {
      if (
        entry.session.deviceSerial === deviceSerial &&
        entry.session.status === "running"
      ) {
        return {
          ok: false,
          error: `scrcpy already running for device ${deviceSerial} (session=${entry.session.id})`,
        };
      }
    }

    const id = randomUUID();
    const now = Date.now();

    const server = new ScrcpyServer();

    try {
      await server.start({
        deviceSerial,
        maxSize: options?.maxSize,
        maxFps: options?.maxFps,
        videoBitRate: options?.videoBitRate,
      });
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error ? err.message : "Failed to start scrcpy-server",
      };
    }

    const session: ScrcpySession = {
      id,
      deviceSerial,
      pid: server.pid,
      status: "running",
      createdAt: now,
      updatedAt: now,
    };

    this.entries.set(id, { session, process: server });

    server.on("exit", () => {
      const entry = this.entries.get(id);
      if (entry) {
        this.entries.set(id, {
          ...entry,
          session: { ...entry.session, status: "stopped", updatedAt: Date.now() },
        });
      }
    });

    server.on("error", () => {
      const entry = this.entries.get(id);
      if (entry) {
        this.entries.set(id, {
          ...entry,
          session: { ...entry.session, status: "error", updatedAt: Date.now() },
        });
      }
    });

    return { ok: true, session };
  }

  stop(id: string): StopScrcpyResult {
    const entry = this.entries.get(id);
    if (!entry) return "not-found";
    if (entry.session.status !== "running") return "already-stopped";

    entry.process.stop();
    this.entries.set(id, {
      ...entry,
      session: { ...entry.session, status: "stopped", updatedAt: Date.now() },
    });
    return "stopped";
  }

  stopByDevice(deviceSerial: string): StopScrcpyResult {
    for (const [id, entry] of this.entries) {
      if (
        entry.session.deviceSerial === deviceSerial &&
        entry.session.status === "running"
      ) {
        return this.stop(id);
      }
    }
    return "not-found";
  }

  stopAll(): void {
    for (const id of this.entries.keys()) {
      this.stop(id);
    }
  }

  list(): ScrcpySession[] {
    return [...this.entries.values()]
      .map((e) => e.session)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  getProcess(id: string): ScrcpyServer | undefined {
    return this.entries.get(id)?.process;
  }
}
