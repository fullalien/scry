/**
 * ScrcpyServer: directly implements the scrcpy-server TCP protocol.
 *
 * Flow:
 *  1. adb push scrcpy-server.jar → /data/local/tmp/
 *  2. adb forward tcp:27183 localabstract:scrcpy
 *  3. adb shell app_process … (runs the Java server; non-blocking)
 *  4. TCP connect × 2: video socket (+ handshake) + control socket
 *  5. Read [PTS 8B][size 4B][data] packets; emit framed "data" events
 *
 * WS frame format emitted on the "data" event:
 *   byte 0     : 0x01  (message type = video)
 *   bytes 1–8  : PTS big-endian uint64
 *                  0x8000_0000_0000_0000 = codec config (SPS+PPS)
 *                  otherwise = frame PTS in microseconds
 *   bytes 9+   : raw NAL data (Annex-B)
 */

import net from "node:net";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  adbPush,
  adbForward,
  adbForwardRemove,
  adbShellSpawn,
} from "../adb/AdbClient.js";
import { getServerJarPath, SERVER_VERSION } from "./ServerJar.js";

const REMOTE_JAR = "/data/local/tmp/scrcpy-server.jar";
const FORWARD_PORT = 27183;

export type ScrcpyServerOptions = {
  deviceSerial: string;
  maxSize?: number;
  maxFps?: number;
  videoBitRate?: number | string;
};

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

  /** Always 0 — we don't have a single process PID like ScrcpyProcess did. */
  readonly pid = 0;

  get running(): boolean {
    return this._running;
  }

  async start(options: ScrcpyServerOptions): Promise<void> {
    this.deviceSerial = options.deviceSerial;

    // 1. Ensure jar is cached locally
    const localJar = await getServerJarPath();

    // 2. Push jar to device
    await adbPush(options.deviceSerial, localJar, REMOTE_JAR);

    // 3. Set up port forward
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
      `video_bit_rate=${options.videoBitRate ?? 4000000}`,
      "audio=false",
      "control=true",
    ]);

    this.shellProcess.stderr?.on("data", (chunk: Buffer) => {
      this.emit("log", chunk.toString());
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

    // Handshake: send 1 dummy byte → server replies with device metadata
    this.videoSocket.write(Buffer.alloc(1));

    // Read 64-byte device name (null-padded UTF-8)
    const deviceNameBuf = await this.videoReader.read(64);
    const deviceName = deviceNameBuf.toString("utf8").replace(/\0/g, "");

    // Read 12-byte video codec metadata added in scrcpy v2.0:
    //   [codec_id: u32][initial_width: u32][initial_height: u32]
    const metaBuf = await this.videoReader.read(12);
    const initialWidth = metaBuf.readUInt32BE(4);
    const initialHeight = metaBuf.readUInt32BE(8);

    this.emit(
      "log",
      `[ScrcpyServer] Connected — device: "${deviceName}", ${initialWidth}×${initialHeight}`,
    );

    // Control socket (no handshake required)
    this.controlSocket = await tcpConnect(FORWARD_PORT);
  }

  private async streamPackets(): Promise<void> {
    try {
      while (this._running) {
        // Each packet: [PTS: 8B big-endian] [size: 4B big-endian] [data: size B]
        const header = await this.videoReader.read(12);
        const pts = header.readBigUInt64BE(0);
        const size = header.readUInt32BE(8);
        const data = await this.videoReader.read(size);

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
