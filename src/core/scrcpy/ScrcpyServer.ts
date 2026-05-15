/**
 * ScrcpyServer: directly implements the scrcpy-server TCP protocol (v4.0).
 *
 * WS frame format emitted on the "data" event (our internal protocol):
 *   byte 0     : 0x01 (video)
 *   bytes 1-8  : pts_flags big-endian uint64 (unchanged from server)
 *   bytes 9+   : encoded payload bytes
 */

import fs from "node:fs";
import net from "node:net";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  adbPush,
  adbShell,
  adbForward,
  adbForwardRemove,
  adbShellSpawn,
} from "../adb/AdbClient.js";
import { getServerJarPath, SERVER_VERSION } from "./ServerJar.js";

const REMOTE_JAR = "/data/local/tmp/scrcpy-server-v4.0.jar";
const FORWARD_PORT = 27183;
const DEFAULT_SCID = 0;

// scrcpy-server v4.0 packet flags (matching Streamer.java).
const PKT_FLAG_SESSION = 0x8000000000000000n;   // bit 63
const PKT_FLAG_CONFIG = 0x4000000000000000n;     // bit 62
const PKT_FLAG_KEY_FRAME = 0x2000000000000000n;  // bit 61
const PKT_PTS_MASK = 0x1fffffffffffffffn;         // lower 61 bits
const NAL_IDR = 5;
const VIDEO_MSG_TYPE = 0x01;

const DEVICE_MSG_TYPE_CLIPBOARD = 0x00;
const DEVICE_MSG_TYPE_ACK_CLIPBOARD = 0x01;
const DEVICE_MSG_TYPE_UHID_OUTPUT = 0x02;

export type ScrcpyServerOptions = {
  deviceSerial: string;
  maxSize?: number;
  maxFps?: number;
  control?: boolean;
  audio?: boolean;
  scid?: number;
  /** Bit rate in bps, or a suffixed string: "8M" = 8_000_000, "4000K" = 4_000_000. */
  videoBitRate?: number | string;
};

export type ScrcpyServerStats = {
  packets: number;
  sessionMeta: number;
  configs: number;
  keyframes: number;
  deviceMessages: number;
  lastHeader?: string;
  lastNalType?: number;
};

type DeviceMessage =
  | { type: "clipboard"; text: string }
  | { type: "ack_clipboard"; sequence: string }
  | { type: "uhid_output"; id: number; data: Buffer };

function toScidHex(scid: number): string {
  const normalized = (scid & 0x7fffffff) >>> 0;
  return normalized.toString(16).padStart(8, "0");
}

function codecIdToText(codecId: number): string {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(codecId, 0);
  const text = b.toString("ascii").replace(/\0/g, "");
  return text.length > 0 ? text : `0x${codecId.toString(16).padStart(8, "0")}`;
}

/** Parse bit-rate values like "8M", "4000K", or plain numbers → bps integer. */
function parseBitRate(value: number | string | undefined, defaultBps = 4_000_000): number {
  if (value === undefined || value === null) return defaultBps;
  if (typeof value === "number") return value;
  const match = /^(\d+(?:\.\d+)?)\s*([KkMmGg])?$/.exec(value.trim());
  if (!match) return defaultBps;
  const n = parseFloat(match[1]);
  const suffix = (match[2] ?? "").toUpperCase();
  if (suffix === "K") return Math.round(n * 1_000);
  if (suffix === "M") return Math.round(n * 1_000_000);
  if (suffix === "G") return Math.round(n * 1_000_000_000);
  return Math.round(n);
}

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

  constructor(private readonly socket: net.Socket) {
    socket.on("data", (chunk: Buffer) => {
      this.buf = Buffer.concat([this.buf, chunk]);
      this.drain();
    });
    socket.on("error", (err) => {
      for (const p of this.pending) p.reject(err);
      this.pending.length = 0;
    });
    socket.on("close", () => {
      const err = new Error("Video socket closed");
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

  /** Put bytes back at the front of the internal buffer (for debug peek-and-replay). */
  prepend(data: Buffer): void {
    this.buf = Buffer.concat([data, this.buf]);
  }

  private drain(): void {
    while (this.pending.length > 0 && this.buf.length >= this.pending[0].n) {
      const { n, resolve } = this.pending.shift()!;
      resolve(this.buf.subarray(0, n));
      this.buf = this.buf.subarray(n);
    }
  }
}

function tcpConnect(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ port, host: "127.0.0.1" });
    s.once("error", reject);
    s.once("connect", () => {
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
        s.off("close", onClose);
        s.off("error", onEarlyError);
        fn();
      };

      const timer = setTimeout(() => settle(() => resolve(s)), 200);
      const onClose = () => settle(() => reject(new Error("Socket closed immediately after connect")));
      const onEarlyError = (err: Error) => settle(() => reject(err));

      s.once("close", onClose);
      s.once("error", onEarlyError);
    });
  });
}

async function tcpConnectWithRetry(
  port: number,
  maxAttempts = 40,
  delayMs = 300,
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
  throw last!;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function hasIdrNal(data: Buffer): boolean {
  return findNalType(data, NAL_IDR) !== undefined;
}

function findFirstNalType(data: Buffer): number | undefined {
  return findNalType(data);
}

function findNalType(data: Buffer, wantedType?: number): number | undefined {
  for (let i = 0; i <= data.length - 4; i++) {
    if (data[i] !== 0 || data[i + 1] !== 0) {
      continue;
    }

    let headerOff = -1;
    if (data[i + 2] === 1) {
      headerOff = i + 3;
    } else if (data[i + 2] === 0 && data[i + 3] === 1) {
      headerOff = i + 4;
    }

    if (headerOff !== -1 && headerOff < data.length) {
      const nalType = data[headerOff] & 0x1f;
      if (wantedType === undefined || nalType === wantedType) {
        return nalType;
      }
    }
  }

  return undefined;
}

export class ScrcpyServer extends EventEmitter {
  private scid = DEFAULT_SCID;
  private videoSocket!: net.Socket;
  private videoReader!: SocketReader;
  private controlSocket?: net.Socket;
  private controlReader?: SocketReader;
  private shellProcess!: ChildProcess;
  private _running = false;
  private controlEnabled = false;
  private audioEnabled = false;
  private deviceSerial = "";
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

  /** Always 0 — we don't have a single process PID like ScrcpyProcess did. */
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
    const socketName = this.scid === DEFAULT_SCID ? "scrcpy" : `scrcpy_${toScidHex(this.scid)}`;

    // 1. Get bundled jar path
    const localJar = getServerJarPath();

    // 2. Push jar to device only if remote file is missing or size differs
    const localJarSize = fs.statSync(localJar).size;
    const needsPush = await (async () => {
      try {
        const out = await adbShell(
          options.deviceSerial,
          `stat -c %s ${REMOTE_JAR} 2>/dev/null || echo missing`,
        );
        const trimmed = out.trim();
        if (trimmed === "missing" || trimmed === "") return true;
        return parseInt(trimmed, 10) !== localJarSize;
      } catch {
        return true;
      }
    })();

    if (needsPush) {
      console.log(`[ScrcpyServer] Pushing jar (${localJarSize} bytes)…`);
      await adbPush(options.deviceSerial, localJar, REMOTE_JAR);
    } else {
      console.log("[ScrcpyServer] Jar already up-to-date on device, skipping push.");
    }

    // 3. Kill any stale scrcpy-server process on the device to avoid socket conflicts
    await adbShell(options.deviceSerial, "pkill -f com.genymobile.scrcpy.Server 2>/dev/null; true").catch(() => {});

    // 4. Set up port forward (remove any stale forward first)
    await adbForwardRemove(options.deviceSerial, FORWARD_PORT);
    await adbForward(options.deviceSerial, FORWARD_PORT, socketName);

    // 5. Launch the scrcpy Java server (runs indefinitely — do NOT await)
    this.shellProcess = adbShellSpawn(options.deviceSerial, [
      `CLASSPATH=${REMOTE_JAR}`,
      "app_process",
      "/",
      "com.genymobile.scrcpy.Server",
      SERVER_VERSION,
      ...(this.scid === DEFAULT_SCID ? [] : [`scid=${toScidHex(this.scid)}`]),
      "tunnel_forward=true",
      "video_codec=h264",
      `max_size=${options.maxSize ?? 1080}`,
      `max_fps=${options.maxFps ?? 60}`,
      `video_bit_rate=${parseBitRate(options.videoBitRate)}`,
      `audio=${this.audioEnabled}`,
      `control=${this.controlEnabled}`,
      "send_device_meta=true",
      "send_stream_meta=true",
      "send_frame_meta=true",
      "send_dummy_byte=true",
    ]);

    this.shellProcess.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      process.stderr.write(`[scrcpy-server:out] ${text}`);
    });
    this.shellProcess.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      process.stderr.write(`[scrcpy-server] ${text}`);
      this.emit("log", text);
    });

    this.shellProcess.on("exit", (code, signal) => {
      this.shellExitMessage = `code=${code} signal=${signal}`;
      if (this._running) {
        this._running = false;
        this.emit("exit", code, signal);
      }
    });

    // 6. Connect and complete handshake (with retry while server boots)
    // Give the JVM a moment to start before the first connection attempt.
    await sleep(800);
    await this.connectAndHandshake(socketName);

    this._running = true;

    // 7. Start streaming packets in the background
    void this.streamPackets();
    if (this.controlEnabled) {
      void this.readDeviceMessages();
    }
  }

  private async connectAndHandshake(socketName: string): Promise<void> {
    // Video socket — retry until server is ready.
    // tcpConnect resolves only when the connection stays open (not immediately closed).
    this.videoSocket = await tcpConnectWithRetry(FORWARD_PORT);
    this.videoReader = new SocketReader(this.videoSocket);

    // 1. Discard the 1-byte dummy (0x00) sent by the server (sendDummyByte=true default).
    await this.readOrThrowShellError(1);

    // 2. Read 64-byte device name (null-padded UTF-8)
    const deviceNameBuf = await this.readOrThrowShellError(64);
    const deviceName = deviceNameBuf.toString("utf8").replace(/\0/g, "");

    // 3. Read video codec id (4 bytes only — v4.0 Streamer.writeVideoHeader).
    const codecIdBuf = await this.readOrThrowShellError(4);
    const videoCodecId = codecIdBuf.readUInt32BE(0);

    // 4. Read session header (12 bytes): flags + width + height.
    //    For video, the first 12-byte header after codec_id is always a session packet.
    const sessionHeader = await this.readOrThrowShellError(12);
    const sessionFlags = sessionHeader.readUInt32BE(0);
    const videoWidth = sessionHeader.readUInt32BE(4);
    const videoHeight = sessionHeader.readUInt32BE(8);
    const isSession = (sessionFlags & 0x80000000) !== 0;
    if (!isSession) {
      throw new Error(`[ScrcpyServer] Expected session header but got flags=0x${sessionFlags.toString(16)}`);
    }

    if (videoCodecId === 0x00000000) {
      throw new Error("[ScrcpyServer] Device disabled the video stream (codec_id=0)");
    }
    if (videoCodecId === 0x00000001) {
      throw new Error("[ScrcpyServer] Device reported video codec configuration error (codec_id=1)");
    }

    console.log(
      `[ScrcpyServer] Connected (${socketName}) — device: "${deviceName}", video codec: "${codecIdToText(
        videoCodecId,
      )}" ${videoWidth}x${videoHeight}`,
    );

    if (this.audioEnabled) {
      const audioSocket = await tcpConnectWithRetry(FORWARD_PORT);
      const audioReader = new SocketReader(audioSocket);
      const audioCodecMeta = await audioReader.read(4);
      const audioCodecId = audioCodecMeta.readUInt32BE(0);
      if (audioCodecId === 0x00000000) {
        console.warn("[ScrcpyServer] Device disabled audio stream (codec_id=0)");
      } else if (audioCodecId === 0x00000001) {
        console.warn("[ScrcpyServer] Device reported audio codec configuration error (codec_id=1)");
      } else {
        console.log(`[ScrcpyServer] Audio codec: "${codecIdToText(audioCodecId)}"`);
      }
      audioSocket.destroy();
    }

    if (this.controlEnabled) {
      this.controlSocket = await tcpConnectWithRetry(FORWARD_PORT);
      this.controlReader = new SocketReader(this.controlSocket);
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
      const msg = this.shellExitMessage ?? (err instanceof Error ? err.message : String(err));
      throw new Error(
        `[ScrcpyServer] Video socket closed during handshake (reading ${n}B). ` +
          `Shell exit: ${msg}. Check server logs above.`,
      );
    }
  }

  private async streamPackets(): Promise<void> {
    let streamOffset = 0;
    let pktNum = 0;
    try {
      while (this._running) {
        const headerOffset = streamOffset;
        const header = await this.videoReader.read(12);
        streamOffset += 12;
        pktNum++;

        const firstByte = header[0];
        const isSession = (firstByte & 0x80) !== 0;

        // Session packet: 4-byte flags + 4-byte width + 4-byte height (no payload).
        if (isSession) {
          const flags = header.readUInt32BE(0);
          const width = header.readUInt32BE(4);
          const height = header.readUInt32BE(8);
          this.stats.sessionMeta += 1;
          this.stats.lastHeader = `session ${width}x${height}`;
          console.log(`[ScrcpyServer] [DBG] pkt#${pktNum}: SESSION ${width}×${height} (flags=0x${flags.toString(16)}) → skip`);
          continue;
        }

        // Media packet: 8-byte pts_flags + 4-byte size, then payload.
        const ptsAndFlags = header.readBigUInt64BE(0);
        const size = header.readUInt32BE(8);
        const isConfig = (ptsAndFlags & PKT_FLAG_CONFIG) !== 0n;
        const isKey = (ptsAndFlags & PKT_FLAG_KEY_FRAME) !== 0n;

        console.log(
          `[ScrcpyServer] [DBG] pkt#${pktNum} @offset=${headerOffset}: ` +
          `hdr=${header.toString("hex")} pts=0x${ptsAndFlags.toString(16)} ` +
          `size=${size} CONFIG=${isConfig} KEY=${isKey}`,
        );

        if (size > 16 * 1024 * 1024) {
          console.error(
            `[ScrcpyServer] [DBG] INVALID SIZE at offset=${headerOffset}: size=${size} (0x${size.toString(16)}), ` +
            `hdr bytes: ${header.toString("hex")}`,
          );
          throw new Error(`[ScrcpyServer] Invalid video packet size ${size}`);
        }

        const data = size > 0 ? await this.videoReader.read(size) : Buffer.alloc(0);
        streamOffset += size;
        const firstBytes = data.subarray(0, Math.min(24, data.length)).toString("hex");
        console.log(
          `[ScrcpyServer] [DBG] pkt#${pktNum}: data read OK, ${size} bytes, first24=${firstBytes}, ` +
          `nextOffset=${streamOffset}`,
        );

        const isKeyFrame = isKey || hasIdrNal(data);

        this.stats.packets += 1;
        this.stats.lastHeader = `pts=0x${ptsAndFlags.toString(16)} size=${size}`;
        this.stats.lastNalType = findFirstNalType(data);

        // Build WS frame: [type: 0x01][pts_flags: 8B][data]
        const frame = Buffer.allocUnsafe(1 + 8 + data.length);
        frame[0] = VIDEO_MSG_TYPE;
        frame.writeBigUInt64BE(ptsAndFlags, 1);
        data.copy(frame, 9);

        if (isConfig) {
          this.stats.configs += 1;
          this.latestCodecConfigFrame = frame;
          console.log(`[ScrcpyServer] [DBG] pkt#${pktNum}: CONFIG stored (total configs=${this.stats.configs})`);
        } else if (isKeyFrame) {
          this.stats.keyframes += 1;
          this.latestKeyFrame = frame;
          console.log(`[ScrcpyServer] [DBG] pkt#${pktNum}: KEYFRAME stored (total keyframes=${this.stats.keyframes})`);
        } else {
          console.log(`[ScrcpyServer] [DBG] pkt#${pktNum}: delta frame`);
        }

        this.emit("data", frame);
      }
    } catch (err) {
      if (this._running) {
        this._running = false;
        const error =
          err instanceof Error
            ? new Error(`[ScrcpyServer] Stream failed after ${this.stats.packets} packet(s): ${err.message}`)
            : new Error(`[ScrcpyServer] Stream failed after ${this.stats.packets} packet(s): ${String(err)}`);
        this.emit("error", error);
        this.emit("exit", 1, null);
      }
    }
  }

  private async readDeviceMessages(): Promise<void> {
    if (!this.controlReader) {
      return;
    }

    try {
      while (this._running && this.controlReader) {
        const msg = await this.readOneDeviceMessage(this.controlReader);
        this.stats.deviceMessages += 1;
        this.emit("device-message", msg);
      }
    } catch (err) {
      if (!this._running) {
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.emit("log", `[ScrcpyServer] Control reader stopped: ${message}`);
    }
  }

  private async readOneDeviceMessage(reader: SocketReader): Promise<DeviceMessage> {
    const type = (await reader.read(1)).readUInt8(0);

    if (type === DEVICE_MSG_TYPE_CLIPBOARD) {
      const len = (await reader.read(4)).readUInt32BE(0);
      const textBuf = len > 0 ? await reader.read(len) : Buffer.alloc(0);
      return {
        type: "clipboard",
        text: textBuf.toString("utf8"),
      };
    }

    if (type === DEVICE_MSG_TYPE_ACK_CLIPBOARD) {
      const sequence = (await reader.read(8)).readBigUInt64BE(0);
      return {
        type: "ack_clipboard",
        sequence: sequence.toString(),
      };
    }

    if (type === DEVICE_MSG_TYPE_UHID_OUTPUT) {
      const header = await reader.read(4);
      const id = header.readUInt16BE(0);
      const size = header.readUInt16BE(2);
      const data = size > 0 ? await reader.read(size) : Buffer.alloc(0);
      return {
        type: "uhid_output",
        id,
        data,
      };
    }

    throw new Error(`Unknown device message type: ${type}`);
  }

  sendControl(data: Buffer | Uint8Array): void {
    if (!this.controlEnabled || !this.controlSocket || this.controlSocket.destroyed) {
      return;
    }

    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.controlSocket.write(payload);
  }

  stop(): void {
    if (!this._running) return;
    this._running = false;
    this.videoSocket?.destroy();
    this.controlSocket?.destroy();
    this.shellProcess?.kill("SIGTERM");
    adbForwardRemove(this.deviceSerial, FORWARD_PORT).catch(() => {});
    this.emit("exit", 0, null);
  }
}
