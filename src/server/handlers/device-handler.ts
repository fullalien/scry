import type { FastifyRequest, FastifyReply } from 'fastify';
import { listAdbDevices } from '../../core/adb/adb-client.js';
import { logger } from '../../core/logger/logger.js';

export const listDevices = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
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
};
