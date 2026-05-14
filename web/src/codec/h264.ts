/**
 * H.264 Annex-B stream parser and WebCodecs VideoDecoder wrapper.
 *
 * The server forwards a raw H.264 Annex-B byte stream over WebSocket.
 * This module:
 *  1. Scans incoming chunks for start codes (00 00 01 / 00 00 00 01) to
 *     delineate NAL units.
 *  2. Extracts the codec string from the SPS NAL unit.
 *  3. Feeds EncodedVideoChunk objects to a VideoDecoder configured with
 *     optimizeForLatency:true for minimal display lag.
 */

// ---------------------------------------------------------------------------
// NAL unit parsing
// ---------------------------------------------------------------------------

/** NAL unit types relevant to stream setup and framing. */
export const NAL_TYPE = {
  NON_IDR_SLICE: 1,
  IDR_SLICE: 5,
  SPS: 7,
  PPS: 8,
} as const;

/**
 * Scan `buf` for all H.264 Annex-B start code positions.
 * Start codes are either `00 00 01` or `00 00 00 01`.
 */
function findStartCodes(buf: Uint8Array): number[] {
  const positions: number[] = [];
  for (let i = 0; i < buf.length - 2; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0) {
      if (buf[i + 2] === 1) {
        positions.push(i);
        i += 2;
      } else if (buf[i + 2] === 0 && i + 3 < buf.length && buf[i + 3] === 1) {
        positions.push(i);
        i += 3;
      }
    }
  }
  return positions;
}

/** Length of the start code at `buf[offset]`. */
function startCodeLen(buf: Uint8Array, offset: number): number {
  return buf[offset + 2] === 1 ? 3 : 4;
}

/**
 * Build the codec string `avc1.PPCCLL` from the first three content bytes
 * of an SPS NAL unit (profile_idc, constraint_flags, level_idc).
 */
export function codecStringFromSps(spsNal: Uint8Array): string {
  const scLen = startCodeLen(spsNal, 0);
  // spsNal[scLen] is the NAL header; payload starts at scLen+1
  const profileIdc = spsNal[scLen + 1];
  const constraintFlags = spsNal[scLen + 2];
  const levelIdc = spsNal[scLen + 3];
  return (
    "avc1." +
    profileIdc.toString(16).padStart(2, "0") +
    constraintFlags.toString(16).padStart(2, "0") +
    levelIdc.toString(16).padStart(2, "0")
  );
}

// ---------------------------------------------------------------------------
// Parsed frame type
// ---------------------------------------------------------------------------

export type H264Frame = {
  /** True for IDR (keyframe), false for P/B frames. */
  isKey: boolean;
  /**
   * Raw Annex-B bytes.  For keyframes, SPS+PPS are prepended so the decoder
   * can (re)configure itself from the bitstream.
   */
  data: Uint8Array;
  /** Monotonically increasing, in microseconds. */
  timestamp: number;
};

// ---------------------------------------------------------------------------
// Annex-B stream parser
// ---------------------------------------------------------------------------

/**
 * Incrementally parses an H.264 Annex-B byte stream arriving in arbitrary
 * chunks.  Call `push(chunk)` with each incoming WebSocket binary message;
 * it returns an array of complete `H264Frame` objects ready to decode.
 */
export class H264AnnexBParser {
  private buf = new Uint8Array(0);
  private sps: Uint8Array | null = null;
  private pps: Uint8Array | null = null;
  private frameIndex = 0;

  /**
   * Append `chunk` and return any newly complete H264Frames.
   * Incomplete trailing NAL data is retained for the next call.
   */
  push(chunk: Uint8Array): H264Frame[] {
    // Append chunk to the internal buffer
    const merged = new Uint8Array(this.buf.length + chunk.length);
    merged.set(this.buf);
    merged.set(chunk, this.buf.length);
    this.buf = merged;

    const positions = findStartCodes(this.buf);
    if (positions.length < 2) return [];

    const frames: H264Frame[] = [];

    for (let i = 0; i < positions.length - 1; i++) {
      const nal = this.buf.slice(positions[i], positions[i + 1]);
      const scLen = startCodeLen(nal, 0);
      const type = nal[scLen] & 0x1f;

      if (type === NAL_TYPE.SPS) {
        this.sps = nal.slice();
      } else if (type === NAL_TYPE.PPS) {
        this.pps = nal.slice();
      } else if (type === NAL_TYPE.IDR_SLICE && this.sps && this.pps) {
        // Prepend SPS + PPS before the IDR so the decoder sees them together
        const keyData = new Uint8Array(
          this.sps.length + this.pps.length + nal.length,
        );
        keyData.set(this.sps, 0);
        keyData.set(this.pps, this.sps.length);
        keyData.set(nal, this.sps.length + this.pps.length);
        frames.push({
          isKey: true,
          data: keyData,
          timestamp: this.nextTimestamp(),
        });
      } else if (type === NAL_TYPE.NON_IDR_SLICE) {
        frames.push({
          isKey: false,
          data: nal,
          timestamp: this.nextTimestamp(),
        });
      }
    }

    // Keep bytes starting from the last start code (may be incomplete)
    this.buf = this.buf.slice(positions[positions.length - 1]);

    return frames;
  }

  /** Codec string derived from the most recently seen SPS, or null. */
  get codec(): string | null {
    return this.sps ? codecStringFromSps(this.sps) : null;
  }

  /** Reset parser state (e.g. on stream restart). */
  reset(): void {
    this.buf = new Uint8Array(0);
    this.sps = null;
    this.pps = null;
    this.frameIndex = 0;
  }

  private nextTimestamp(): number {
    // Use a fixed ~30 fps interval; timestamps must be monotonically increasing.
    return this.frameIndex++ * 33333;
  }
}

// ---------------------------------------------------------------------------
// WebCodecs VideoDecoder wrapper
// ---------------------------------------------------------------------------

export type DecoderErrorHandler = (err: Error) => void;

/**
 * Wraps the browser's `VideoDecoder` API.
 *
 * Usage:
 *   const dec = new H264WebCodecsDecoder(frame => { ctx.drawImage(frame, 0, 0); frame.close(); });
 *   dec.push(new Uint8Array(wsEvent.data));
 *   // on cleanup:
 *   dec.close();
 */
export class H264WebCodecsDecoder {
  private readonly parser = new H264AnnexBParser();
  private decoder: VideoDecoder | null = null;
  private configured = false;
  private readonly onFrame: (frame: VideoFrame) => void;
  private readonly onError: DecoderErrorHandler;

  constructor(
    onFrame: (frame: VideoFrame) => void,
    onError: DecoderErrorHandler = (e) => console.error("[H264Decoder]", e),
  ) {
    this.onFrame = onFrame;
    this.onError = onError;
  }

  /** Feed a raw chunk from the WebSocket binary message. */
  push(chunk: Uint8Array): void {
    const frames = this.parser.push(chunk);

    for (const frame of frames) {
      // Configure decoder on the first keyframe (once we have the codec string)
      if (!this.configured && frame.isKey) {
        const codec = this.parser.codec;
        if (!codec) continue;

        this.decoder = new VideoDecoder({
          output: (vf) => this.onFrame(vf),
          error: (e) => this.onError(new Error(String(e))),
        });

        this.decoder.configure({
          codec,
          optimizeForLatency: true,
        });

        this.configured = true;
      }

      if (!this.configured || !this.decoder) continue;

      try {
        this.decoder.decode(
          new EncodedVideoChunk({
            type: frame.isKey ? "key" : "delta",
            timestamp: frame.timestamp,
            data: frame.data,
          }),
        );
      } catch (e) {
        this.onError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  /** Release the underlying VideoDecoder. */
  close(): void {
    if (this.decoder && this.decoder.state !== "closed") {
      this.decoder.close();
    }
    this.decoder = null;
    this.configured = false;
    this.parser.reset();
  }
}
