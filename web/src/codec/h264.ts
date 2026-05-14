/**
 * WebCodecs decoder for the scrcpy-server binary stream protocol.
 *
 * WebSocket message layout (server → browser):
 *   byte 0     : message type  0x01 = video
 *   bytes 1–8  : PTS (big-endian uint64, microseconds)
 *                  0x8000_0000_0000_0000  → codec config packet (SPS + PPS)
 *                  anything else          → video frame
 *   bytes 9+   : NAL data in Annex-B format (00 00 00 01 start codes)
 *
 * On receiving a codec config packet we:
 *   1. Scan for the SPS NAL unit and extract the codec string (avc1.PPCCLL).
 *   2. Configure a new VideoDecoder.
 *   3. Save the SPS+PPS bytes to prepend to subsequent keyframes.
 *
 * On receiving a video frame we:
 *   1. Detect keyframes by checking for an IDR NAL unit (type 5).
 *   2. Prepend the saved SPS+PPS to keyframes so the decoder always gets
 *      parameter sets before an IDR slice.
 *   3. Feed an EncodedVideoChunk to the VideoDecoder.
 *   4. Drop frames when the decode queue is backlogged (> 2 queued).
 */

export const VIDEO_MSG_TYPE = 0x01;
export const CODEC_CONFIG_PTS = 0x8000000000000000n;

// ---------------------------------------------------------------------------
// NAL utilities
// ---------------------------------------------------------------------------

const NAL_IDR = 5;
const NAL_SPS = 7;

/** Scan Annex-B data for a NAL unit of a given type; return its offset or -1. */
function findNalOffset(data: Uint8Array, nalType: number): number {
  for (let i = 0; i < data.length - 4; i++) {
    if (data[i] === 0 && data[i + 1] === 0) {
      let headerOff = -1;
      if (data[i + 2] === 1) {
        headerOff = i + 3;
      } else if (data[i + 2] === 0 && i + 3 < data.length && data[i + 3] === 1) {
        headerOff = i + 4;
      }
      if (headerOff !== -1 && (data[headerOff] & 0x1f) === nalType) {
        return headerOff;
      }
    }
  }
  return -1;
}

function hasIdrNal(data: Uint8Array): boolean {
  return findNalOffset(data, NAL_IDR) !== -1;
}

/**
 * Extract the avc1.PPCCLL codec string from Annex-B SPS+PPS data.
 * Returns a safe fallback if SPS cannot be found.
 */
export function extractCodecString(data: Uint8Array): string {
  const off = findNalOffset(data, NAL_SPS);
  if (off !== -1 && off + 3 < data.length) {
    const p = data[off + 1].toString(16).padStart(2, "0");
    const c = data[off + 2].toString(16).padStart(2, "0");
    const l = data[off + 3].toString(16).padStart(2, "0");
    return `avc1.${p}${c}${l}`;
  }
  return "avc1.42E01E";
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

export type DecoderErrorHandler = (err: Error) => void;

/**
 * Decodes the scrcpy-server framed binary stream using the WebCodecs API.
 *
 * Usage:
 *   const dec = new ScrcpyH264Decoder(frame => {
 *     ctx.drawImage(frame, 0, 0);
 *     frame.close();
 *   });
 *   ws.onmessage = e => dec.push(e.data as ArrayBuffer);
 *   // on cleanup:
 *   dec.close();
 */
export class ScrcpyH264Decoder {
  private decoder: VideoDecoder | null = null;
  private configured = false;
  private codecConfig: Uint8Array | null = null;

  constructor(
    private readonly onFrame: (frame: VideoFrame) => void,
    private readonly onError: DecoderErrorHandler = (e) =>
      console.error("[H264Decoder]", e),
  ) {}

  /** Feed one raw WebSocket binary message. */
  push(buffer: ArrayBuffer): void {
    const view = new DataView(buffer);
    if (view.getUint8(0) !== VIDEO_MSG_TYPE) return;

    // Read PTS as two 32-bit halves to avoid BigInt parsing issues in older runtimes
    const ptsHi = BigInt(view.getUint32(1));
    const ptsLo = BigInt(view.getUint32(5));
    const pts = (ptsHi << 32n) | ptsLo;

    const data = new Uint8Array(buffer, 9);

    if (pts === CODEC_CONFIG_PTS) {
      this.handleCodecConfig(data);
    } else {
      this.handleFrame(pts, data);
    }
  }

  private handleCodecConfig(data: Uint8Array): void {
    const codec = extractCodecString(data);

    // Save a copy of SPS+PPS to prepend to subsequent keyframes
    this.codecConfig = data.slice();

    this.decoder?.close();
    this.decoder = new VideoDecoder({
      output: (frame) => {
        this.onFrame(frame);
        frame.close();
      },
      error: (e) => this.onError(new Error(String(e))),
    });

    this.decoder.configure({
      codec,
      optimizeForLatency: true,
    });

    this.configured = true;
  }

  private handleFrame(pts: bigint, data: Uint8Array): void {
    if (!this.configured || !this.decoder) return;

    // Drop frames when the decoder is backlogged to avoid unbounded latency
    if (this.decoder.decodeQueueSize > 2) return;

    const isKey = hasIdrNal(data);

    // For keyframes, prepend the saved SPS+PPS so the decoder always gets
    // parameter sets even after a seek or restart.
    let frameData: Uint8Array;
    if (isKey && this.codecConfig) {
      frameData = new Uint8Array(this.codecConfig.length + data.length);
      frameData.set(this.codecConfig, 0);
      frameData.set(data, this.codecConfig.length);
    } else {
      frameData = data;
    }

    try {
      this.decoder.decode(
        new EncodedVideoChunk({
          type: isKey ? "key" : "delta",
          timestamp: Number(pts), // PTS is already in microseconds
          data: frameData,
        }),
      );
    } catch (e) {
      this.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /** Release the underlying VideoDecoder. */
  close(): void {
    if (this.decoder && this.decoder.state !== "closed") {
      this.decoder.close();
    }
    this.decoder = null;
    this.configured = false;
    this.codecConfig = null;
  }
}
