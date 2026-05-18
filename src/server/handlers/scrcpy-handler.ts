import type { FastifyInstance } from 'fastify';
import type { ScrcpyManager } from '../../core/scrcpy/scrcpy-manager.js';
import type { ServerOptions } from '../server.js';
import {
  SCRCPY_PATH,
  SCRCPY_STOP_PATH,
  SCRCPY_STREAM_PATH,
  SCRCPY_DEVICE_STREAM_PATH,
} from '../path.server.js';
import { logger } from '../../core/logger/logger.js';
import { validateDeviceId } from '../../core/adb/adb-client.js';

const MAX_PENDING_FRAMES = 10;

export function registerScrcpyHandlers(
  app: FastifyInstance,
  scrcpyManager: ScrcpyManager,
  options: ServerOptions
) {
  app.get(SCRCPY_PATH, async () => {
    return { sessions: scrcpyManager.list() };
  });

  app.post(SCRCPY_PATH, async (request, reply) => {
    const body = request.body as {
      deviceSerial?: string;
      maxSize?: number;
      videoBitRate?: number;
      maxFps?: number;
    } | null;

    const deviceSerial = body?.deviceSerial;
    if (!deviceSerial) {
      reply.code(400);
      return { ok: false, error: 'deviceSerial is required' };
    }

    // Validate deviceSerial format to prevent command injection
    if (typeof deviceSerial !== 'string') {
      reply.code(400);
      return { ok: false, error: 'Invalid deviceSerial format' };
    }

    try {
      validateDeviceId(deviceSerial);
    } catch (err) {
      reply.code(400);
      return { ok: false, error: err instanceof Error ? err.message : 'Invalid deviceSerial format' };
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

  app.post(SCRCPY_STOP_PATH, async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = scrcpyManager.stop(id);

    if (result === 'not-found') {
      reply.code(404);
      return { ok: false, error: 'not-found' };
    }

    return { ok: true, result };
  });

  app.get(SCRCPY_STREAM_PATH, { websocket: true }, (socket, request) => {
    const { id } = request.params as { id: string };
    const proc = scrcpyManager.getProcess(id);

    if (!proc) {
      socket.close(1008, 'Session not found');
      return;
    }

    if (!proc.running) {
      socket.close(1011, 'Session not running');
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
        if (pendingFrames.length >= MAX_PENDING_FRAMES) {
          pendingFrames.shift();
        }
        pendingFrames.push(chunk);
      }
    };

    const onExit = () => {
      if (socket.readyState === socket.OPEN) {
        socket.close(1000, 'scrcpy-server exited');
      }
    };

    const onDeviceMessage = (msg: unknown) => {
      if (socket.readyState !== socket.OPEN) {
        return;
      }

      socket.send(
        JSON.stringify({
          type: 'device-message',
          payload:
            typeof msg === 'object' &&
            msg !== null &&
            'type' in (msg as Record<string, unknown>)
              ? {
                  ...(msg as Record<string, unknown>),
                  ...(Buffer.isBuffer((msg as { data?: unknown }).data)
                    ? {
                        data: (msg as { data: Buffer }).data.toString('base64'),
                      }
                    : {}),
                }
              : msg,
        })
      );
    };

    proc.on('data', onData);
    proc.on('exit', onExit);
    proc.on('device-message', onDeviceMessage);

    const codecConfigFrame = proc.getLatestCodecConfigFrame();
    const keyFrame = proc.getLatestKeyFrame();

    if (keyFrame) {
      pendingFrames.unshift(keyFrame);
    }
    if (codecConfigFrame) {
      pendingFrames.unshift(codecConfigFrame);
    }

    if (socket.readyState === socket.OPEN) {
      flushPending();
    }
    socket.on('open', flushPending);

    socket.on('message', (msg: Buffer) => {
      proc.sendControl(msg);
    });

    socket.on('error', (err: Error) => {
      logger.warn('[ScrcpyHandler] Stream socket error', {
        sessionId: id,
        error: err.message,
      });
    });

    socket.on('close', () => {
      logger.info('[ScrcpyHandler] Stream client disconnected', {
        sessionId: id,
      });
      proc.off('data', onData);
      proc.off('exit', onExit);
      proc.off('device-message', onDeviceMessage);
    });
  });

  app.get(
    SCRCPY_DEVICE_STREAM_PATH,
    { websocket: true },
    async (socket, request) => {
      const { deviceSerial } = request.params as { deviceSerial: string };

      // Validate deviceSerial format to prevent command injection
      if (!deviceSerial || typeof deviceSerial !== 'string') {
        socket.close(1008, 'Invalid deviceSerial format');
        return;
      }

      try {
        validateDeviceId(deviceSerial);
      } catch (err) {
        socket.close(1008, err instanceof Error ? err.message : 'Invalid deviceSerial format');
        return;
      }

      const result = await scrcpyManager.startForViewer(deviceSerial, {
        maxSize: options.scrcpyMaxSize,
        videoBitRate: options.scrcpyVideoBitRate,
        maxFps: options.scrcpyMaxFps,
      });

      if (!result.ok) {
        socket.close(1008, result.error);
        return;
      }

      const proc = scrcpyManager.getProcess(result.session.id);
      if (!proc || !proc.running) {
        scrcpyManager.removeViewer(deviceSerial);
        socket.close(1011, 'Session not running');
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
          if (pendingFrames.length >= MAX_PENDING_FRAMES) {
            pendingFrames.shift();
          }
          pendingFrames.push(chunk);
        }
      };

      const onExit = () => {
        if (socket.readyState === socket.OPEN) {
          socket.close(1000, 'scrcpy-server exited');
        }
      };

      const onDeviceMessage = (msg: unknown) => {
        if (socket.readyState !== socket.OPEN) {
          return;
        }

        socket.send(
          JSON.stringify({
            type: 'device-message',
            payload:
              typeof msg === 'object' &&
              msg !== null &&
              'type' in (msg as Record<string, unknown>)
                ? {
                    ...(msg as Record<string, unknown>),
                    ...(Buffer.isBuffer((msg as { data?: unknown }).data)
                      ? {
                          data: (msg as { data: Buffer }).data.toString(
                            'base64'
                          ),
                        }
                      : {}),
                  }
                : msg,
          })
        );
      };

      proc.on('data', onData);
      proc.on('exit', onExit);
      proc.on('device-message', onDeviceMessage);

      const codecConfigFrame = proc.getLatestCodecConfigFrame();
      const keyFrame = proc.getLatestKeyFrame();

      if (keyFrame) {
        pendingFrames.unshift(keyFrame);
      }
      if (codecConfigFrame) {
        pendingFrames.unshift(codecConfigFrame);
      }

      if (socket.readyState === socket.OPEN) {
        flushPending();
      }
      socket.on('open', flushPending);

      socket.on('message', (msg: Buffer) => {
        proc.sendControl(msg);
      });

      socket.on('error', (err: Error) => {
        logger.warn('[ScrcpyHandler] Stream socket error', {
          deviceSerial,
          error: err.message,
        });
      });

      socket.on('close', () => {
        logger.info('[ScrcpyHandler] Device stream client disconnected', {
          deviceSerial,
          viewerCount: scrcpyManager.getViewerCount(deviceSerial),
        });
        proc.off('data', onData);
        proc.off('exit', onExit);
        proc.off('device-message', onDeviceMessage);
        scrcpyManager.removeViewer(deviceSerial);
      });
    }
  );
}
