import type { FastifyRequest, FastifyReply } from 'fastify';
import type { ScrcpyManager } from '../../core/scrcpy/scrcpy-manager.js';
import type { ServerOptions } from '../server.js';
import { logger } from '../../core/logger/logger.js';
import { validateDeviceId } from '../../core/adb/adb-client.js';
import {
  hasIdrNal,
  PKT_FLAG_CONFIG,
  PKT_FLAG_KEY_FRAME,
  VIDEO_MSG_TYPE,
} from '../../shared/scrcpy/index.js';

const MAX_PENDING_FRAMES = 1;
const WS_BUFFER_HIGH_WATERMARK_BYTES = 1024 * 1024;
const WS_BUFFER_LOW_WATERMARK_BYTES = 128 * 1024;

function serializeDeviceMessage(msg: unknown): string {
  return JSON.stringify({
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
  });
}

function getSocketBufferedAmount(socket: any): number {
  return typeof socket.bufferedAmount === 'number' ? socket.bufferedAmount : 0;
}

function pushPendingFrame(pendingFrames: Buffer[], frame: Buffer): void {
  while (pendingFrames.length >= MAX_PENDING_FRAMES) {
    pendingFrames.shift();
  }
  pendingFrames.push(frame);
}

function getPtsFlags(frame: Buffer): bigint | undefined {
  if (frame.length < 9 || frame[0] !== VIDEO_MSG_TYPE) {
    return undefined;
  }
  return frame.readBigUInt64BE(1);
}

function isConfigFrame(frame: Buffer): boolean {
  const ptsFlags = getPtsFlags(frame);
  return ptsFlags !== undefined && (ptsFlags & PKT_FLAG_CONFIG) !== 0n;
}

function isKeyFrame(frame: Buffer): boolean {
  const ptsFlags = getPtsFlags(frame);
  if (ptsFlags !== undefined && (ptsFlags & PKT_FLAG_KEY_FRAME) !== 0n) {
    return true;
  }
  if (frame.length <= 9 || frame[0] !== VIDEO_MSG_TYPE) {
    return false;
  }
  return hasIdrNal(frame.subarray(9));
}

export const listSessions = (scrcpyManager: ScrcpyManager) => async () => {
  return { sessions: scrcpyManager.list() };
};

export const startSession =
  (scrcpyManager: ScrcpyManager, options: ServerOptions) =>
  async (request: FastifyRequest, reply: FastifyReply) => {
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

    if (typeof deviceSerial !== 'string' || !validateDeviceId(deviceSerial)) {
      reply.code(400);
      return { ok: false, error: 'Invalid deviceSerial format' };
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
  };

export const stopSession =
  (scrcpyManager: ScrcpyManager) =>
  async (request: FastifyRequest, reply: FastifyReply) => {
    const { id } = request.params as { id: string };
    const result = scrcpyManager.stop(id);

    if (result === 'not-found') {
      reply.code(404);
      return { ok: false, error: 'not-found' };
    }

    return { ok: true, result };
  };

export const scrcpyStream =
  (scrcpyManager: ScrcpyManager) => (socket: any, request: FastifyRequest) => {
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
    const bootstrapFrames: Buffer[] = [];
    let flushed = false;
    let droppingForLatency = false;
    let droppedFrameCount = 0;
    let recoveryConfigFrame: Buffer | undefined;
    let recoveryKeyFrame: Buffer | undefined;

    const captureRecoveryFrame = (frame: Buffer) => {
      if (isConfigFrame(frame)) {
        recoveryConfigFrame = frame;
      }
      if (isKeyFrame(frame)) {
        recoveryKeyFrame = frame;
      }
    };

    const flushRecoveryFrames = () => {
      if (socket.readyState !== socket.OPEN) return;
      if (recoveryConfigFrame) {
        socket.send(recoveryConfigFrame);
        recoveryConfigFrame = undefined;
      }
      if (recoveryKeyFrame) {
        socket.send(recoveryKeyFrame);
        recoveryKeyFrame = undefined;
      }
    };

    const flushPending = () => {
      if (flushed || socket.readyState !== socket.OPEN) return;
      flushed = true;
      for (const frame of bootstrapFrames) {
        socket.send(frame);
      }
      bootstrapFrames.length = 0;
      for (const frame of pendingFrames) {
        socket.send(frame);
      }
      pendingFrames.length = 0;
    };

    const onData = (chunk: Buffer) => {
      if (socket.readyState !== socket.OPEN) {
        return;
      }

      if (!flushed) {
        pushPendingFrame(pendingFrames, chunk);
        return;
      }

      const bufferedAmount = getSocketBufferedAmount(socket);
      if (droppingForLatency) {
        if (bufferedAmount <= WS_BUFFER_LOW_WATERMARK_BYTES) {
          droppingForLatency = false;
          flushRecoveryFrames();
        } else {
          captureRecoveryFrame(chunk);
          droppedFrameCount += 1;
          return;
        }
      }

      if (getSocketBufferedAmount(socket) >= WS_BUFFER_HIGH_WATERMARK_BYTES) {
        droppingForLatency = true;
        captureRecoveryFrame(chunk);
        droppedFrameCount += 1;
        return;
      }

      socket.send(chunk);
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
      socket.send(serializeDeviceMessage(msg));
    };

    proc.on('data', onData);
    proc.on('exit', onExit);
    proc.on('device-message', onDeviceMessage);

    const codecConfigFrame = proc.getLatestCodecConfigFrame();
    const keyFrame = proc.getLatestKeyFrame();

    if (codecConfigFrame) {
      bootstrapFrames.push(codecConfigFrame);
    }
    if (keyFrame) {
      bootstrapFrames.push(keyFrame);
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
        droppedFrameCount,
      });
      proc.off('data', onData);
      proc.off('exit', onExit);
      proc.off('device-message', onDeviceMessage);
    });
  };

export const scrcpyDeviceStream =
  (scrcpyManager: ScrcpyManager, options: ServerOptions) =>
  async (socket: any, request: FastifyRequest) => {
    const { deviceSerial } = request.params as { deviceSerial: string };

    if (
      !deviceSerial ||
      typeof deviceSerial !== 'string' ||
      !validateDeviceId(deviceSerial)
    ) {
      socket.close(1008, 'Invalid deviceSerial format');
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
    const bootstrapFrames: Buffer[] = [];
    let flushed = false;
    let droppingForLatency = false;
    let droppedFrameCount = 0;
    let recoveryConfigFrame: Buffer | undefined;
    let recoveryKeyFrame: Buffer | undefined;

    const captureRecoveryFrame = (frame: Buffer) => {
      if (isConfigFrame(frame)) {
        recoveryConfigFrame = frame;
      }
      if (isKeyFrame(frame)) {
        recoveryKeyFrame = frame;
      }
    };

    const flushRecoveryFrames = () => {
      if (socket.readyState !== socket.OPEN) return;
      if (recoveryConfigFrame) {
        socket.send(recoveryConfigFrame);
        recoveryConfigFrame = undefined;
      }
      if (recoveryKeyFrame) {
        socket.send(recoveryKeyFrame);
        recoveryKeyFrame = undefined;
      }
    };

    const flushPending = () => {
      if (flushed || socket.readyState !== socket.OPEN) return;
      flushed = true;
      for (const frame of bootstrapFrames) {
        socket.send(frame);
      }
      bootstrapFrames.length = 0;
      for (const frame of pendingFrames) {
        socket.send(frame);
      }
      pendingFrames.length = 0;
    };

    const onData = (chunk: Buffer) => {
      if (socket.readyState !== socket.OPEN) {
        return;
      }

      if (!flushed) {
        pushPendingFrame(pendingFrames, chunk);
        return;
      }

      const bufferedAmount = getSocketBufferedAmount(socket);
      if (droppingForLatency) {
        if (bufferedAmount <= WS_BUFFER_LOW_WATERMARK_BYTES) {
          droppingForLatency = false;
          flushRecoveryFrames();
        } else {
          captureRecoveryFrame(chunk);
          droppedFrameCount += 1;
          return;
        }
      }

      if (getSocketBufferedAmount(socket) >= WS_BUFFER_HIGH_WATERMARK_BYTES) {
        droppingForLatency = true;
        captureRecoveryFrame(chunk);
        droppedFrameCount += 1;
        return;
      }

      socket.send(chunk);
    };

    const onExit = () => {
      if (socket.readyState === socket.OPEN) {
        socket.close(1000, 'scrcpy-server exited');
      }
    };

    proc.on('data', onData);
    proc.on('exit', onExit);

    const codecConfigFrame = proc.getLatestCodecConfigFrame();
    const keyFrame = proc.getLatestKeyFrame();

    if (codecConfigFrame) {
      bootstrapFrames.push(codecConfigFrame);
    }
    if (keyFrame) {
      bootstrapFrames.push(keyFrame);
    }

    if (socket.readyState === socket.OPEN) {
      flushPending();
    }
    socket.on('open', flushPending);

    socket.on('error', (err: Error) => {
      logger.warn('[ScrcpyHandler] Stream socket error', {
        deviceSerial,
        error: err.message,
      });
    });

    socket.on('close', () => {
      scrcpyManager.removeViewer(deviceSerial);
      logger.info('[ScrcpyHandler] Device stream client disconnected', {
        deviceSerial,
        activeChannelCount: scrcpyManager.getActiveChannelCount(deviceSerial),
        droppedFrameCount,
      });
      proc.off('data', onData);
      proc.off('exit', onExit);
    });
  };

export const scrcpyDeviceControl =
  (scrcpyManager: ScrcpyManager) =>
  (socket: any, request: FastifyRequest) => {
    const { deviceSerial } = request.params as { deviceSerial: string };

    if (
      !deviceSerial ||
      typeof deviceSerial !== 'string' ||
      !validateDeviceId(deviceSerial)
    ) {
      socket.close(1008, 'Invalid deviceSerial format');
      return;
    }

    const attached = scrcpyManager.attachViewerByDevice(deviceSerial);
    if (!attached || !attached.process.running) {
      socket.close(1011, 'Session not running');
      return;
    }

    const { sessionId, process: proc } = attached;

    const onExit = () => {
      if (socket.readyState === socket.OPEN) {
        socket.close(1000, 'scrcpy-server exited');
      }
    };

    const onDeviceMessage = (msg: unknown) => {
      if (socket.readyState !== socket.OPEN) {
        return;
      }
      socket.send(serializeDeviceMessage(msg));
    };

    proc.on('exit', onExit);
    proc.on('device-message', onDeviceMessage);

    socket.on('message', (msg: Buffer) => {
      proc.sendControl(msg);
    });

    socket.on('error', (err: Error) => {
      logger.warn('[ScrcpyHandler] Control socket error', {
        sessionId,
        deviceSerial,
        error: err.message,
      });
    });

    socket.on('close', () => {
      scrcpyManager.removeViewer(deviceSerial);
      logger.info('[ScrcpyHandler] Device control client disconnected', {
        sessionId,
        deviceSerial,
        activeChannelCount: scrcpyManager.getActiveChannelCount(deviceSerial),
      });
      proc.off('exit', onExit);
      proc.off('device-message', onDeviceMessage);
    });
  };
