import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyVite from "@fastify/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSessions, stopAllSessions, stopSession, startAutoCleanup as startSessionAutoCleanup, stopAutoCleanup as stopSessionAutoCleanup } from "../core/sessions/session-manager.js";
import { listAdbDevices } from "../core/adb/adb-client.js";
import { ScrcpyManager } from "../core/scrcpy/scrcpy-manager.js";
import { initLogger, type LoggerOptions } from "../core/logger/logger.js";

export type CreateWebServerOptions = {
  scrcpyVideoBitRate?: number;
  scrcpyMaxSize?: number;
  scrcpyMaxFps?: number;
  logger?: LoggerOptions;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");
const webRoot = path.join(projectRoot, "web");

export async function createWebServer(options: CreateWebServerOptions) {
  // Initialize the global logger
  if (options.logger) {
    initLogger(options.logger);
  }

  const app = Fastify({ logger: false });

  const scrcpyManager = new ScrcpyManager();
  
  // Start auto-cleanup for stopped sessions
  scrcpyManager.startAutoCleanup();
  startSessionAutoCleanup();

  await app.register(fastifyWebsocket);

  await app.register(fastifyVite, {
    root: webRoot,
    dev: false,
    spa: true,
  });

  await app.vite.ready();

  app.get("/api/health", async () => {
    return { ok: true };
  });

  app.get("/api/sessions", async () => {
    return { sessions: listSessions() };
  });

  app.post("/api/sessions/:id/stop", async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const result = stopSession(id);

    if (result === "not-found") {
      reply.code(404);
      return { ok: false, error: "not-found" };
    }

    if (result === "failed") {
      reply.code(500);
      return { ok: false, error: "failed" };
    }

    return { ok: true, result };
  });

  app.post("/api/sessions/stop-all", async () => {
    return { ok: true, result: stopAllSessions() };
  });

  app.get("/api/devices", async (_request, reply) => {
    try {
      const devices = await listAdbDevices();
      return { devices };
    } catch {
      reply.code(500);
      return { ok: false, error: "Failed to list ADB devices" };
    }
  });

  app.get("/api/scrcpy", async () => {
    return { sessions: scrcpyManager.list() };
  });

  app.post("/api/scrcpy", async (request, reply) => {
    const body = request.body as {
      deviceSerial?: string;
      maxSize?: number;
      videoBitRate?: number;
      maxFps?: number;
    } | null;

    const deviceSerial = body?.deviceSerial;
    if (!deviceSerial) {
      reply.code(400);
      return { ok: false, error: "deviceSerial is required" };
    }

    const result = await scrcpyManager.start(deviceSerial, {
      maxSize: body?.maxSize ?? options.scrcpyMaxSize,
      videoBitRate: body?.videoBitRate ?? options.scrcpyVideoBitRate,
      maxFps: body?.maxFps ?? options.scrcpyMaxFps,
    });

    if (!result.ok) {
      reply.code(409);
      return { ok: false, error: result.error };
    }

    reply.code(201);
    return { ok: true, session: result.session };
  });

  app.post("/api/scrcpy/:id/stop", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = scrcpyManager.stop(id);

    if (result === "not-found") {
      reply.code(404);
      return { ok: false, error: "not-found" };
    }

    return { ok: true, result };
  });

  app.get(
    "/ws/stream/:id",
    { websocket: true },
    (socket, request) => {
      const { id } = request.params as { id: string };
      const proc = scrcpyManager.getProcess(id);

      if (!proc) {
        socket.close(1008, "Session not found");
        return;
      }

      if (!proc.running) {
        socket.close(1011, "Session not running");
        return;
      }

      const pendingFrames: Buffer[] = [];
      let flushed = false;

      const flushPending = () => {
        if (flushed || socket.readyState !== socket.OPEN) return;
        flushed = true;
        for (const frame of pendingFrames) {
          socket.send(frame);
        }
        pendingFrames.length = 0;
      };

      const onData = (chunk: Buffer) => {
        if (flushed && socket.readyState === socket.OPEN) {
          socket.send(chunk);
        } else {
          pendingFrames.push(chunk);
        }
      };

      const onExit = () => {
        if (socket.readyState === socket.OPEN) {
          socket.close(1000, "scrcpy-server exited");
        }
      };

      const onDeviceMessage = (msg: unknown) => {
        if (socket.readyState !== socket.OPEN) {
          return;
        }

        // Device messages are sent as JSON envelopes to avoid colliding with video binary frames.
        socket.send(
          JSON.stringify({
            type: "device-message",
            payload:
              typeof msg === "object" && msg !== null && "type" in (msg as Record<string, unknown>)
                ? {
                    ...(msg as Record<string, unknown>),
                    ...(Buffer.isBuffer((msg as { data?: unknown }).data)
                      ? { data: ((msg as { data: Buffer }).data).toString("base64") }
                      : {}),
                  }
                : msg,
          }),
        );
      };

      proc.on("data", onData);
      proc.on("exit", onExit);
      proc.on("device-message", onDeviceMessage);

      const codecConfigFrame = proc.getLatestCodecConfigFrame();
      const keyFrame = proc.getLatestKeyFrame();

      // Must prepend in reverse order via unshift: codec config first, then keyframe.
      if (keyFrame) {
        pendingFrames.unshift(keyFrame);
      }
      if (codecConfigFrame) {
        pendingFrames.unshift(codecConfigFrame);
      }

      if (socket.readyState === socket.OPEN) {
        flushPending();
      }
      socket.on("open", flushPending);

      socket.on("message", (msg: Buffer) => {
        // Forward raw control messages from browser to the device
        proc.sendControl(msg);
      });

      socket.on("close", () => {
        proc.off("data", onData);
        proc.off("exit", onExit);
        proc.off("device-message", onDeviceMessage);
      });
    },
  );

  app.get("/ws", { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: "hello", message: "ws connected" }));
  });

  // Let @fastify/vite serve index.html and client assets.
  app.get("/*", async (request, reply) => {
    return reply.html();
  });

  app.addHook("onClose", () => {
    scrcpyManager.stopAll();
    scrcpyManager.stopAutoCleanup();
    stopSessionAutoCleanup();
  });

  return app;
}
