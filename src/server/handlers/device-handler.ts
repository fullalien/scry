import type { FastifyInstance } from 'fastify';
import { listAdbDevices } from '../../core/adb/adb-client.js';
import { DEVICES_PATH } from '../../shared/constants/path.server.js';
import { logger } from '../../core/logger/logger.js';

export function registerDeviceHandlers(app: FastifyInstance) {
  app.get(DEVICES_PATH, async (_request, reply) => {
    try {
      const devices = await listAdbDevices();
      return { devices };
    } catch (err) {
      logger.error('[DeviceHandler] Failed to list devices', {
        error: err instanceof Error ? err.message : String(err),
      });
      reply.code(500);
      return { ok: false, error: 'Failed to list ADB devices' };
    }
  });
}
