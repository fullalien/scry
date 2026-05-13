import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import fastifyVite from "@fastify/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listSessions, stopAllSessions, stopSession } from "../core/sessions/SessionManager.js";

export type CreateWebServerOptions = {
  dev: boolean;
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../");
const webRoot = path.join(projectRoot, "web");

export async function createWebServer(options: CreateWebServerOptions) {
  const app = Fastify({ logger: true });

  await app.register(fastifyWebsocket);

  await app.register(fastifyVite, {
    root: webRoot,
    dev: options.dev,
    spa: true,
  });

  await app.vite.ready();

  app.get("/api/health", async () => {
    return { ok: true, mode: options.dev ? "dev" : "prod" };
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

  app.get("/ws", { websocket: true }, (socket) => {
    socket.send(JSON.stringify({ type: "hello", message: "ws connected" }));
  });

  // Let @fastify/vite serve index.html and client assets.
  app.get("/*", async (request, reply) => {
    return reply.html();
  });

  return app;
}
