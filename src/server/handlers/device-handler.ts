import type { FastifyInstance } from 'fastify';
import { listAdbDevices } from '../../core/adb/adb-client.js';
import { DEVICES_PATH } from '../path.server.js';

export function registerDeviceHandlers(app: FastifyInstance) {
  app.get(DEVICES_PATH, async (_request, reply) => {
    try {
      const devices = await listAdbDevices();
      return { devices };
    } catch {
      reply.code(500);
      return { ok: false, error: 'Failed to list ADB devices' };
    }
  });
}
