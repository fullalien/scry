import type { FastifyInstance } from 'fastify';
import {
  listSessions,
  stopAllSessions,
  stopSession,
} from '../../core/sessions/session-manager.js';
import {
  SESSIONS_PATH,
  SESSION_STOP_PATH,
  SESSIONS_STOP_ALL_PATH,
} from '../path.server.js';

export function registerSessionHandlers(app: FastifyInstance) {
  app.get(SESSIONS_PATH, async () => {
    return { sessions: listSessions() };
  });

  app.post(SESSION_STOP_PATH, async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const result = stopSession(id);

    if (result === 'not-found') {
      reply.code(404);
      return { ok: false, error: 'not-found' };
    }

    if (result === 'failed') {
      reply.code(500);
      return { ok: false, error: 'failed' };
    }

    return { ok: true, result };
  });

  app.post(SESSIONS_STOP_ALL_PATH, async () => {
    return { ok: true, result: stopAllSessions() };
  });
}
