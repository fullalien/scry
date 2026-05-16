import type { FastifyInstance } from 'fastify';
import { HEALTH_PATH } from '../path.server.js';

export function registerHealthHandler(app: FastifyInstance) {
  app.get(HEALTH_PATH, async () => {
    return { ok: true };
  });
}
