/**
 * ScrcpyServer: directly implements the scrcpy-server TCP protocol (v4.0).
 *
 * WS frame format emitted on the "data" event (our internal protocol):
 *   byte 0     : 0x01 (video)
 *   bytes 1-8  : pts_flags big-endian uint64 (unchanged from server)
 *   bytes 9+   : encoded payload bytes
 */

import fs from 'node:fs';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import {
  adbPush,
  adbShell,
  adbForward,
  adbForwardRemove,
  adbShellSpawn,
} from '../adb/adb-client.js';
import { getServerJarPath, SERVER_VERSION } from './server-jar.js';
import { logger } from '../logger/logger.js';
import {
  SCRCPY_FORWARD_PORT,
  DEFAULT_SCID,
  toScidHex,
} from './scrcpy-connection.js';
import {
  DEVICE_NAME_LEN,
  CODEC_ID_LEN,
  CODEC_ID_DISABLED,
  CODEC_ID_CONFIG_ERROR,
  codecIdToText,
} from './scrcpy-handshake.js';
import { parseBitRate } from './scrcpy-utils.js';
import type {
  ScrcpyServerOptions,
  ScrcpyServerStats,
} from './scrcpy-server.types.js';
import { SESSION_HEADER_SIZE } from './protocol/header.js';
import { parseSessionHeader, isSessionPacket } from './protocol/session.js';
import {
  parseMediaHeader,
  buildVideoFrame,
  hasIdrNal,
  findNalUnitType,
  MAX_VIDEO_PAYLOAD_SIZE,
} from './protocol/video.js';
import {
  parseDeviceMessage,
  type DeviceMessage,
} from './protocol/device-message.js';

const REMOTE_JAR = '/data/local/tmp/scrcpy-server-v4.0.jar';

export type { ScrcpyServerOptions, ScrcpyServerStats, DeviceMessage };

/**
 * Buffers a Node.js TCP socket and exposes promise-based `read(n)`.
 * All pending reads are resolved in FIFO order as bytes arrive.
 */
class SocketReader {
  private buf = Buffer.alloc(0);
  private readonly pending: Array<{
    n: number;
    resolve: (b: Buffer) => void;
    reject: (e: Error) => void;
  }> = [];

  constructor(socket: net.Socket) {
    socket.on('data', (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.drain();
    });
    socket.on('error', (err: Error) => {
      for (const p of this.pending) p.reject(err);
      this.pending.length = 0;
    });
    socket.on('close', () => {
      const err = new Error('Video socket closed');
      for (const p of this.pending) p.reject(err);
      this.pending.length = 0;
    });
  }

  read(n: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.pending.push({ n, resolve, reject });
      this.drain();
    });
  }

  private drain(): void {
    while (this.pending.length > 0) {
      const req = this.pending[0];
      if (!req || this.buf.length < req.n) break;
      const { n, resolve } = this.pending.shift()!;
      resolve(this.buf.subarray(0, n));
      this.buf = this.buf.subarray(n);
    }
  }
}

function tcpConnect(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ port, host: '127.0.0.1' });
    s.once('error', reject);
    s.once('connect', () => {
      // The adb forwarder may accept the TCP connection but immediately close it
      // when the abstract socket on the device side isn't listening yet.
      // Wait 200ms: if the socket closes in that window → reject so caller retries;
      // otherwise the connection is live and we resolve.
      // Do NOT add a "data" listener here — it would consume bytes from the stream
      // before SocketReader is attached, causing data loss.
      let settled = false;
      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        s.off('close', onClose);
        s.off('error', onEarlyError);
        fn();
      };

      const timer = setTimeout(() => settle(() => resolve(s)), 200);
      const onClose = () =>
        settle(() =>
          reject(new Error('Socket closed immediately after connect'))
        );
      const onEarlyError = (err: Error) => settle(() => reject(err));

      s.once('close', onClose);
      s.once('error', onEarlyError);
    });
  });
}

async function tcpConnectWithRetry(
  port: number,
  maxAttempts = 40,
  delayMs = 300
): Promise<net.Socket> {
  let last: Error | undefined;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await tcpConnect(port);
    } catch (err) {
      last = err as Error;
      await sleep(delayMs);
    }
  }
  logger.error(
    `[ScrcpyServer] TCP connect to port ${port} failed after ${maxAttempts} attempts`
  );
  throw last!;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export class ScrcpyServer extends EventEmitter {
  private scid = DEFAULT_SCID;
  private videoSocket!: net.Socket;
  private videoReader!: SocketReader;
  private controlSocket?: net.Socket;
  private controlReader?: SocketReader;
  private audioSocket?: net.Socket;
  private audioReader?: SocketReader;

  private shellProcess!: ChildProcess;
  private _running = false;
  private controlEnabled = false;
  private audioEnabled = false;
  private deviceSerial = '';
  private shellExitMessage: string | undefined;
  private latestCodecConfigFrame: Buffer | undefined;
  private latestKeyFrame: Buffer | undefined;
  private readonly stats: ScrcpyServerStats = {
    packets: 0,
    sessionMeta: 0,
    configs: 0,
    keyframes: 0,
    deviceMessages: 0,
  };

  /** Always 0 — this is not a traditional process PID. */
  readonly pid = 0;

  get running(): boolean {
    return this._running;
  }

  getLatestCodecConfigFrame(): Buffer | undefined {
    return this.latestCodecConfigFrame;
  }

  getLatestKeyFrame(): Buffer | undefined {
    return this.latestKeyFrame;
  }

  getStats(): ScrcpyServerStats {
    return { ...this.stats };
  }

  async start(options: ScrcpyServerOptions): Promise<void> {
    this.deviceSerial = options.deviceSerial;
    this.controlEnabled = options.control ?? false;
    this.audioEnabled = options.audio ?? false;
    this.scid = options.scid ?? DEFAULT_SCID;
    const socketName =
      this.scid === DEFAULT_SCID ? 'scrcpy' : `scrcpy_${toScidHex(this.scid)}`;

    // 1. Get bundled jar path
    const localJar = getServerJarPath();

    // 2. Push jar to device only if remote file is missing or size differs
    const localJarSize = fs.statSync(localJar).size;
    const needsPush = await (async () => {
      try {
        const out = await adbShell(
          options.deviceSerial,
          `stat -c %s ${REMOTE_JAR} 2>/dev/null || echo missing`
        );
        const trimmed = out.trim();
        if (trimmed === 'missing' || trimmed === '') return true;
        return parseInt(trimmed, 10) !== localJarSize;
      } catch {
        return true;
      }
    })();

    if (needsPush) {
      logger.info(`[ScrcpyServer] Pushing jar (${localJarSize} bytes)…`);
      await adbPush(options.deviceSerial, localJar, REMOTE_JAR);
    } else {
      logger.info(
        '[ScrcpyServer] Jar already up-to-date on device, skipping push.'
      );
    }

    // 3. Kill any stale scrcpy-server process on the device to avoid socket conflicts
    await adbShell(
      options.deviceSerial,
      'pkill -f com.genymobile.scrcpy.Server 2>/dev/null; true'
    ).catch(err => {
      logger.warn('[ScrcpyServer] Failed to kill stale server process', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    // 4. Set up port forward (remove any stale forward first)
    await adbForwardRemove(options.deviceSerial, SCRCPY_FORWARD_PORT);
    await adbForward(options.deviceSerial, SCRCPY_FORWARD_PORT, socketName);

    // 5. Launch the scrcpy Java server (runs indefinitely — do NOT await)
    try {
      this.shellProcess = adbShellSpawn(options.deviceSerial, [
        `CLASSPATH=${REMOTE_JAR}`,
        'app_process',
        '/',
        'com.genymobile.scrcpy.Server',
        SERVER_VERSION,
        ...(this.scid === DEFAULT_SCID ? [] : [`scid=${toScidHex(this.scid)}`]),
        'tunnel_forward=true',
        'video_codec=h264',
        `max_size=${options.maxSize ?? 0}`,
        `max_fps=${options.maxFps ?? 60}`,
        `video_bit_rate=${parseBitRate(options.videoBitRate)}`,
        `audio=${this.audioEnabled}`,
        `control=${this.controlEnabled}`,
        'send_device_meta=true',
        'send_stream_meta=true',
        'send_frame_meta=true',
        'send_dummy_byte=true',
      ]);
    } catch (err) {
      logger.error('[ScrcpyServer] Failed to spawn shell process', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.cleanup();
      throw err;
    }

    this.shellProcess.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        logger.info('[scrcpy-server:out] ' + text, {
          deviceSerial: this.deviceSerial,
        });
      }
    });
    this.shellProcess.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        logger.error('[scrcpy-server] ' + text, {
          deviceSerial: this.deviceSerial,
        });
      }
    });

    this.shellProcess.on('exit', (code, signal) => {
      this.shellExitMessage = `code=${code} signal=${signal}`;
      if (this._running) {
        this._running = false;
        logger.warn('[ScrcpyServer] Shell process exited unexpectedly', {
          code,
          signal,
        });
        this.emit('exit', code, signal);
      }
    });

    // 6. Connect and complete handshake (with retry while server boots)
    try {
      // Give the JVM a moment to start before the first connection attempt.
      await sleep(800);
      logger.info('[ScrcpyServer] Connecting to server socket…', { socketName });
      await this.connectAndHandshake(socketName);
    } catch (err) {
      logger.error('[ScrcpyServer] Handshake failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      this.cleanup();
      throw err;
    }

    this._running = true;
    logger.info('[ScrcpyServer] Server started successfully', {
      scid: this.scid,
    });

    // 7. Start streaming packets in the background
    void this.streamPackets();
  }

  private async connectAndHandshake(socketName: string): Promise<void> {
    this.videoSocket = await tcpConnectWithRetry(SCRCPY_FORWARD_PORT);
    this.videoReader = new SocketReader(this.videoSocket);

    // should connect control before reading video data
    if (this.controlEnabled) {
      logger.info('[ScrcpyServer] Control enabled, connecting to control socket…');
      void this.connectControlSocket();
    }

    // should connect audio before reading video data
    if (this.audioEnabled) {
      logger.info('[ScrcpyServer] Audio enabled, connecting to audio socket…');
      this.audioSocket = await tcpConnectWithRetry(SCRCPY_FORWARD_PORT);
      this.audioReader = new SocketReader(this.audioSocket);
    }

    // 1. Discard the 1-byte dummy (0x00) sent by the server (sendDummyByte=true default).
    await this.readOrThrowShellError(1);

    // 2. Read 64-byte device name (null-padded UTF-8)
    const deviceNameBuf = await this.readOrThrowShellError(DEVICE_NAME_LEN);
    const deviceName = deviceNameBuf.toString('utf8').replace(/\0/g, '');

    // 3. Read video codec id (4 bytes only — v4.0 Streamer.writeVideoHeader).
    const codecIdBuf = await this.readOrThrowShellError(CODEC_ID_LEN);
    const videoCodecId = codecIdBuf.readUInt32BE(0);

    // 4. Read session header (12 bytes): flags + width + height.
    const sessionHeader = await this.readOrThrowShellError(SESSION_HEADER_SIZE);
    const parsed = parseSessionHeader(sessionHeader);
    if (!parsed.isSession) {
      throw new Error(
        `[ScrcpyServer] Expected session header but got flags=0x${parsed.flags.toString(16)}`
      );
    }

    if (videoCodecId === CODEC_ID_DISABLED) {
      throw new Error(
        '[ScrcpyServer] Device disabled the video stream (codec_id=0)'
      );
    }
    if (videoCodecId === CODEC_ID_CONFIG_ERROR) {
      throw new Error(
        '[ScrcpyServer] Device reported video codec configuration error (codec_id=1)'
      );
    }

    if (this.audioEnabled) {
      const audioCodecMeta = await this.audioReader?.read(CODEC_ID_LEN);
      const audioCodecId = audioCodecMeta?.readUInt32BE(0);
      if (audioCodecId === CODEC_ID_DISABLED) {
        logger.warn('[ScrcpyServer] Device disabled audio stream (codec_id=0)');
      } else if (audioCodecId === CODEC_ID_CONFIG_ERROR) {
        logger.warn(
          '[ScrcpyServer] Device reported audio codec configuration error (codec_id=1)'
        );
      } else {
        logger.info(
          `[ScrcpyServer] Audio codec: "${codecIdToText(audioCodecId ?? 0)}"`
        );
      }
    }

    logger.info(
      `[ScrcpyServer] Connected (${socketName}) — device: "${deviceName}", video codec: "${codecIdToText(
        videoCodecId
      )}" ${parsed.width}x${parsed.height}`
    );
  }

  private async connectControlSocket(): Promise<void> {
    try {
      this.controlSocket = await tcpConnectWithRetry(SCRCPY_FORWARD_PORT);
      this.controlReader = new SocketReader(this.controlSocket);
      void this.readDeviceMessages();
    } catch (err) {
      logger.warn('[ScrcpyServer] Failed to connect control socket', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Read `n` bytes from the video socket, or re-throw with a richer error
   * message if the shell process has already exited.
   */
  private async readOrThrowShellError(n: number): Promise<Buffer> {
    try {
      return await this.videoReader.read(n);
    } catch (err) {
      const msg =
        this.shellExitMessage ??
        (err instanceof Error ? err.message : String(err));
      throw new Error(
        `[ScrcpyServer] Video socket closed during handshake (reading ${n}B). ` +
        `Shell exit: ${msg}. Check server logs above.`
      );
    }
  }

  private async streamPackets(): Promise<void> {
    try {
      while (this._running) {
        const header = await this.videoReader.read(SESSION_HEADER_SIZE);

        if (isSessionPacket(header)) {
          const parsed = parseSessionHeader(header);
          this.stats.sessionMeta += 1;
          this.stats.lastHeader = `session ${parsed.width}x${parsed.height}`;
          continue;
        }

        const parsed = parseMediaHeader(header);
        if (parsed.size > MAX_VIDEO_PAYLOAD_SIZE) {
          throw new Error(
            `[ScrcpyServer] Invalid video packet size ${parsed.size}`
          );
        }

        const data =
          parsed.size > 0
            ? await this.videoReader.read(parsed.size)
            : Buffer.alloc(0);

        const isKeyFrame = parsed.isKeyFrame || hasIdrNal(data);

        this.stats.packets += 1;
        this.stats.lastHeader = `pts=0x${parsed.ptsAndFlags.toString(16)} size=${parsed.size}`;
        this.stats.lastNalType = findNalUnitType(data);

        const frame = buildVideoFrame(parsed.ptsAndFlags, data);

        if (parsed.isConfig) {
          this.stats.configs += 1;
          this.latestCodecConfigFrame = frame;
        } else if (isKeyFrame) {
          this.stats.keyframes += 1;
          this.latestKeyFrame = frame;
        }

        this.emit('data', frame);
      }
    } catch (err) {
      if (this._running) {
        this._running = false;
        logger.error('[ScrcpyServer] Streaming failed', {
          packets: this.stats.packets,
          error: err instanceof Error ? err.message : String(err),
        });
        const error =
          err instanceof Error
            ? new Error(
              `[ScrcpyServer] Stream failed after ${this.stats.packets} packet(s): ${err.message}`
            )
            : new Error(
              `[ScrcpyServer] Stream failed after ${this.stats.packets} packet(s): ${String(err)}`
            );
        this.emit('error', error);
        this.emit('exit', 1, null);
      }
    }
  }

  private async readDeviceMessages(): Promise<void> {
    if (!this.controlReader) return;

    try {
      while (this._running) {
        const msg = await parseDeviceMessage(n => this.controlReader!.read(n));
        this.stats.deviceMessages += 1;
        this.emit('device-message', msg);
      }
    } catch (err) {
      if (!this._running) return;
      const message = err instanceof Error ? err.message : String(err);
      logger.warn('[ScrcpyServer] Control reader stopped unexpectedly', {
        message,
      });
    }
  }

  /** Tear down all resources (sockets, process, forward). Idempotent. */
  private cleanup(): void {
    this.videoSocket?.destroy();
    this.controlSocket?.destroy();
    try {
      this.shellProcess?.kill('SIGTERM');
    } catch {
      // process may already be dead
    }
    if (this.deviceSerial) {
      adbForwardRemove(this.deviceSerial, SCRCPY_FORWARD_PORT).catch(err => {
        logger.warn(
          '[ScrcpyServer] Failed to remove port forward during cleanup',
          { error: err instanceof Error ? err.message : String(err) }
        );
      });
    }
  }

  sendControl(data: Buffer | Uint8Array): void {
    if (
      !this.controlEnabled ||
      !this.controlSocket ||
      this.controlSocket.destroyed
    ) {
      return;
    }

    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.controlSocket.write(payload);
  }

  stop(): void {
    if (!this._running) {
      logger.debug('[ScrcpyServer] stop() called but not running, skipping');
      return;
    }
    logger.info('[ScrcpyServer] Stopping server', { scid: this.scid });
    this._running = false;
    this.cleanup();
    this.emit('exit', 0, null);
  }
}
