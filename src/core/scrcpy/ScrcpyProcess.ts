import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";

export type ScrcpyStartOptions = {
  scrcpyPath?: string;
  ffmpegPath?: string;
  deviceSerial: string;
  maxSize?: number;
  videoBitRate?: string;
  maxFps?: number;
  noDisplay?: boolean;
  recordToStdout?: boolean;
  /** Pipe scrcpy stdout through ffmpeg to produce a fragmented MP4 stream suitable for browser MSE playback. */
  transcodeToFMP4?: boolean;
};

export class ScrcpyProcess extends EventEmitter {
  readonly pid: number;
  private _running = true;
  private readonly child: ReturnType<typeof spawn>;
  private ffmpegProcess?: ReturnType<typeof spawn>;

  constructor(options: ScrcpyStartOptions) {
    super();

    const scrcpyPath = options.scrcpyPath ?? "scrcpy";
    const args: string[] = ["--serial", options.deviceSerial];

    if (options.noDisplay) {
      args.push("--no-display");
    }

    if (options.recordToStdout) {
      args.push("--record", "-", "--record-format", "mkv");
    }

    if (options.maxSize !== undefined) {
      args.push("--max-size", String(options.maxSize));
    }

    if (options.videoBitRate !== undefined) {
      args.push("--video-bit-rate", options.videoBitRate);
    }

    if (options.maxFps !== undefined) {
      args.push("--max-fps", String(options.maxFps));
    }

    const stdioMode = options.recordToStdout ? "pipe" : "ignore";
    const child = spawn(scrcpyPath, args, {
      stdio: ["ignore", stdioMode, "pipe"],
    });

    this.child = child;

    if (!child.pid) {
      throw new Error(`Failed to spawn scrcpy process (path: ${scrcpyPath})`);
    }

    this.pid = child.pid;

    if (options.recordToStdout && child.stdout) {
      if (options.transcodeToFMP4) {
        const ffmpegPath = options.ffmpegPath ?? "ffmpeg";
        const ffmpegProc = spawn(
          ffmpegPath,
          [
            "-loglevel", "quiet",
            "-i", "pipe:0",
            "-c:v", "copy",
            "-an",
            "-f", "mp4",
            "-movflags", "frag_keyframe+empty_moov+default_base_moof",
            "pipe:1",
          ],
          { stdio: ["pipe", "pipe", "ignore"] },
        );
        this.ffmpegProcess = ffmpegProc;

        child.stdout.pipe(ffmpegProc.stdin!);

        ffmpegProc.stdout!.on("data", (chunk: Buffer) => {
          this.emit("data", chunk);
        });

        ffmpegProc.on("error", (err: Error) => {
          this.emit("error", new Error(`ffmpeg: ${err.message}`));
        });
      } else {
        child.stdout.on("data", (chunk: Buffer) => {
          this.emit("data", chunk);
        });
      }
    }

    child.stderr?.on("data", (chunk: Buffer) => {
      this.emit("log", chunk.toString());
    });

    child.on("exit", (code, signal) => {
      this._running = false;
      this.emit("exit", code, signal);
    });

    child.on("error", (err: Error) => {
      this._running = false;
      this.emit("error", err);
    });
  }

  get running(): boolean {
    return this._running;
  }

  stop(): void {
    if (this._running) {
      this.child.kill("SIGTERM");
      this.ffmpegProcess?.kill("SIGTERM");
    }
  }
}
