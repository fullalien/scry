import type { FastifyReply, FastifyRequest } from 'fastify';
import { getHostDisplays } from '../../core/display/host-display.js';
import { logger } from '../../core/logger/logger.js';

export const getHostDisplayInfo = async (
  _request: FastifyRequest,
  reply: FastifyReply
) => {
  try {
    return { displays: await getHostDisplays() };
  } catch (err) {
    logger.error('[HostDisplayHandler] Failed to inspect host displays', {
      error: err instanceof Error ? err.message : String(err),
    });
    reply.code(500);
    return { ok: false, error: 'Failed to inspect host displays' };
  }
};
