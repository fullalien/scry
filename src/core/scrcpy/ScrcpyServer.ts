/**
 * ScrcpyServer: directly implements the scrcpy-server TCP protocol (v4.0).
 *
 * scrcpy-server v4.0 byte stream after TCP connect (tunnel_forward mode):
 *
 *  Connection sequence:
 *   1. Server accepts video socket, immediately writes 1 byte 0x00 (dummy byte,
 *      for connection-error detection — sendDummyByte=true by default)
 *   2. sendDeviceMeta: 64 bytes device name (null-padded UTF-8)
 *   3. Encoder starts, writeVideoHeader: 4 bytes codec_id
 *      (e.g. 0x68323634 = "h264")
 *   4. Then a stream of "packets":
 *
 *  Packet disambiguation (read 4 bytes hi-word first):
 *   - If hi-word == 0x80000000 (PACKET_FLAG_SESSION >> 32):
 *       → session/resize meta: [hi:4B already read][width:4B][height:4B] = 12B total, no data
 *   - Otherwise: regular data packet
 *       → read 4 bytes lo-word → ptsAndFlags = (hi<<32)|lo (8B)
 *       → read 4 bytes size
 *       → read size bytes data
 *       → if ptsAndFlags & PACKET_FLAG_CONFIG (0x4000…): codec config (SPS+PPS)
 *       → else: video frame (may have PACKET_FLAG_KEY_FRAME bit)
 *
 *  WS frame format emitted on the "data" event (our protocol, browser side):
 *   byte 0     : 0x01  (message type = video)
 *   bytes 1–8  : PTS big-endian uint64
 *                  0x8000_0000_0000_0000  → codec config (SPS + PPS)
 *                  anything else          → video frame PTS in microseconds
 *   bytes 9+   : raw NAL data (Annex-B)
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

const REMOTE_JAR = "/data/local/tmp/scrcpy-server.jar";
const FORWARD_PORT = 27183;

// scrcpy-server v4.0 Streamer.java packet flags
const PKT_FLAG_SESSION_HI = 0x80000000; // high 32 bits of PACKET_FLAG_SESSION (1L<<63)
const PKT_FLAG_CONFIG     = 0x4000000000000000n; // PACKET_FLAG_CONFIG (1L<<62)
const PKT_FLAG_KEY_FRAME  = 0x2000000000000000n; // PACKET_FLAG_KEY_FRAME (1L<<61)

// Our WS protocol constant for codec config (SPS+PPS) packets
const WS_CODEC_CONFIG_PTS = 0x8000000000000000n;

export type ScrcpyServerOptions = {
  deviceSerial: string;
  maxSize?: number;
  maxFps?: number;
  /** Bit rate in bps, or a suffixed string: "8M" = 8_000_000, "4000K" = 4_000_000. */
  videoBitRate?: number | string;
};

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
      const err = new Error("Socket closed");
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
    while (this.pending.length > 0 && this.buf.length >= this.pending[0].n) {
      const { n, resolve } = this.pending.shift()!;
      resolve(this.buf.subarray(0, n));
      this.buf = this.buf.subarray(n);
    }
  }
}

function tcpConnect(port: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" }, () =>
      resolve(socket),
    );
    socket.once("error", reject);
  });
}

async function tcpConnectWithRetry(
  port: number,
  maxAttempts = 15,
  delayMs = 200,
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

export class ScrcpyServer extends EventEmitter {
  private videoSocket!: net.Socket;
  private videoReader!: SocketReader;
  private controlSocket!: net.Socket;
  private shellProcess!: ChildProcess;
  private _running = false;
  private deviceSerial = "";
  private shellExitMessage: string | undefined;

  /** Always 0 — we don't have a single process PID like ScrcpyProcess did. */
  readonly pid = 0;

  get running(): boolean {
    return this._running;
  }

  async start(options: ScrcpyServerOptions): Promise<void> {
    this.deviceSerial = options.deviceSerial;

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

    // 3. Set up port forward (remove any stale forward first)
    await adbForwardRemove(options.deviceSerial, FORWARD_PORT);
    await adbForward(options.deviceSerial, FORWARD_PORT, "scrcpy");

    // 4. Launch the scrcpy Java server (runs indefinitely — do NOT await)
    this.shellProcess = adbShellSpawn(options.deviceSerial, [
      `CLASSPATH=${REMOTE_JAR}`,
      "app_process",
      "/",
      "com.genymobile.scrcpy.Server",
      SERVER_VERSION,
      "tunnel_forward=true",
      "video_codec=h264",
      `max_size=${options.maxSize ?? 1080}`,
      `max_fps=${options.maxFps ?? 60}`,
      `video_bit_rate=${parseBitRate(options.videoBitRate)}`,
      "audio=false",
      "control=true",
    ]);

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

    // 5. Connect and complete handshake (with retry while server boots)
    await this.connectAndHandshake();

    this._running = true;

    // 6. Start streaming packets in the background
    void this.streamPackets();
  }

  private async connectAndHandshake(): Promise<void> {
    // Video socket — retry until server is ready
    this.videoSocket = await tcpConnectWithRetry(FORWARD_PORT);
    this.videoReader = new SocketReader(this.videoSocket);

    // 1. Discard the 1-byte dummy (0x00) sent by the server (sendDummyByte=true default).
    await this.readOrThrowShellError(1);

    // 2. Connect control socket NOW — the server calls accept() for control immediately
    //    after sending the dummy byte. Device meta is sent only AFTER all sockets are
    //    accepted, so we must connect control before reading any more from video socket.
    this.controlSocket = await tcpConnect(FORWARD_PORT);

    // 3. Read 64-byte device name (null-padded UTF-8)
    const deviceNameBuf = await this.readOrThrowShellError(64);
    const deviceName = deviceNameBuf.toString("utf8").replace(/\0/g, "");

    // 4. Read 4-byte codec_id (e.g. 0x68323634 = "h264"), sent as sendStreamMeta header
    const codecBuf = await this.readOrThrowShellError(4);
    const codecId = codecBuf.toString("ascii").replace(/\0/g, "");

    console.log(
      `[ScrcpyServer] Connected — device: "${deviceName}", codec: "${codecId}"`,
    );
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
    try {
      while (this._running) {
        // Read high 4 bytes to determine packet type.
        const hiWord = (await this.videoReader.read(4)).readUInt32BE(0);

        if (hiWord === PKT_FLAG_SESSION_HI) {
          // Session/resize meta: [hi:4B already read][width:4B][height:4B] — 12B total, no data
          const rest = await this.videoReader.read(8);
          const w = rest.readUInt32BE(0);
          const h = rest.readUInt32BE(4);
          console.log(`[ScrcpyServer] Resolution: ${w}×${h}`);
          continue;
        }

        // Regular data packet: read remaining 4B of pts + 4B size
        const loAndSize = await this.videoReader.read(8);
        const ptsAndFlags =
          (BigInt(hiWord) << 32n) | BigInt(loAndSize.readUInt32BE(0));
        const size = loAndSize.readUInt32BE(4);
        const data = await this.videoReader.read(size);

        const isConfig = (ptsAndFlags & PKT_FLAG_CONFIG) !== 0n;
        const pts = isConfig
          ? WS_CODEC_CONFIG_PTS
          : ptsAndFlags & ~(PKT_FLAG_CONFIG | PKT_FLAG_KEY_FRAME);

        // Build WS frame: [type: 0x01][PTS: 8B][data]
        const frame = Buffer.allocUnsafe(1 + 8 + data.length);
        frame[0] = 0x01;
        frame.writeBigUInt64BE(pts, 1);
        data.copy(frame, 9);

        this.emit("data", frame);
      }
    } catch {
      if (this._running) {
        this._running = false;
        this.emit("exit", 1, null);
      }
    }
  }

  /** Send raw control bytes to the device. */
  sendControl(data: Buffer | Uint8Array): void {
    if (this._running && this.controlSocket) {
      this.controlSocket.write(data);
    }
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
