import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyVite from "@fastify/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSessions, stopAllSessions, stopSession } from "../core/sessions/SessionManager.js";
import { listAdbDevices } from "../core/adb/AdbClient.js";
import { ScrcpyManager } from "../core/scrcpy/ScrcpyManager.js";

export type CreateWebServerOptions = {
  scrcpyPath?: string;
  scrcpyVideoBitRate?: string;
  scrcpyMaxSize?: number;
  scrcpyMaxFps?: number;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");
const webRoot = path.join(projectRoot, "web");

export async function createWebServer(options: CreateWebServerOptions) {
  const app = Fastify({ logger: true });

  const scrcpyManager = new ScrcpyManager(options.scrcpyPath ?? "scrcpy");

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
      recordToStdout?: boolean;
      maxSize?: number;
      videoBitRate?: string;
      maxFps?: number;
    } | null;

    const deviceSerial = body?.deviceSerial;
    if (!deviceSerial) {
      reply.code(400);
      return { ok: false, error: "deviceSerial is required" };
    }

    const result = scrcpyManager.start(deviceSerial, {
      noDisplay: true,
      recordToStdout: body?.recordToStdout ?? false,
      transcodeToFMP4: body?.recordToStdout ?? false,
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

      const onData = (chunk: Buffer) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(chunk);
        }
      };

      const onExit = () => {
        if (socket.readyState === socket.OPEN) {
          socket.close(1000, "scrcpy process exited");
        }
      };

      proc.on("data", onData);
      proc.on("exit", onExit);

      socket.on("close", () => {
        proc.off("data", onData);
        proc.off("exit", onExit);
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
  });

  return app;
}

