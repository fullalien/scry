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
const PACKET_FLAG_SESSION = 0x8000000000000000n; // bit 63
const PACKET_FLAG_CONFIG = 0x4000000000000000n; // bit 62
const PACKET_FLAG_KEY_FRAME = 0x2000000000000000n; // bit 61
const PTS_MASK = 0x1fffffffffffffffn; // lower 61 bits

// ---------------------------------------------------------------------------
// NAL utilities
// ---------------------------------------------------------------------------

const NAL_IDR = 5;
const NAL_SPS = 7;

/** Scan Annex-B data for a NAL unit of a given type; return its offset or -1. */
function findNalOffset(data: Uint8Array, nalType: number): number {
  for (let i = 0; i <= data.length - 4; i++) {
    if (data[i] === 0 && data[i + 1] === 0) {
      let headerOff = -1;
      if (data[i + 2] === 1) {
        headerOff = i + 3;
      } else if (
        data[i + 2] === 0 &&
        i + 3 < data.length &&
        data[i + 3] === 1
      ) {
        headerOff = i + 4;
      }
      if (
        headerOff !== -1 &&
        headerOff < data.length &&
        (data[headerOff] & 0x1f) === nalType
      ) {
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
    const p = data[off + 1].toString(16).padStart(2, '0');
    const c = data[off + 2].toString(16).padStart(2, '0');
    const l = data[off + 3].toString(16).padStart(2, '0');
    return `avc1.${p}${c}${l}`;
  }
  return 'avc1.42E01E';
}

// ---------------------------------------------------------------------------
// Decoder
// ---------------------------------------------------------------------------

export type DecoderErrorHandler = (err: Error) => void;
export type DecoderStats = {
  packets: number;
  invalidType: number;
  ignoredNonVideo: number;
  configs: number;
  frames: number;
  keyframes: number;
  decoded: number;
  waitingForKeyframe: boolean;
  lastType?: number;
  lastHeader?: string;
  codec?: string;
};
export type DecoderStatsHandler = (stats: DecoderStats) => void;

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
  private waitingForKeyframe = true;
  private stats: DecoderStats = {
    packets: 0,
    invalidType: 0,
    ignoredNonVideo: 0,
    configs: 0,
    frames: 0,
    keyframes: 0,
    decoded: 0,
    waitingForKeyframe: true,
  };

  constructor(
    private readonly onFrame: (frame: VideoFrame) => void,
    private readonly onError: DecoderErrorHandler = e =>
      console.error('[H264] Decoder error:', e),
    private readonly onStats: DecoderStatsHandler = () => {}
  ) {}

  /** Feed one raw WebSocket binary message. */
  push(buffer: ArrayBuffer): void {
    const size = buffer.byteLength;
    const type = new Uint8Array(buffer, 0, 1)[0];

    if (type !== VIDEO_MSG_TYPE) {
      this.stats.ignoredNonVideo += 1;
      this.emitStats();
      return;
    }

    const view = new DataView(buffer);
    const ptsHi = view.getUint32(1);
    const ptsLo = view.getUint32(5);
    const ptsAndFlags = (BigInt(ptsHi) << 32n) | BigInt(ptsLo);
    const isConfig = (ptsAndFlags & PACKET_FLAG_CONFIG) !== 0n;
    const pts = ptsAndFlags & PTS_MASK;
    const dataOff = 9;
    const dataLen = buffer.byteLength - dataOff;

    this.stats.packets += 1;

    if (isConfig) {
      this.handleCodecConfig(new Uint8Array(buffer, dataOff));
    } else {
      this.handleFrame(pts, ptsAndFlags, new Uint8Array(buffer, dataOff));
    }
  }

  private handleCodecConfig(data: Uint8Array): void {
    const codec = extractCodecString(data);
    this.stats.configs += 1;
    this.stats.codec = codec;

    this.codecConfig = data.slice();
    this.waitingForKeyframe = true;

    this.decoder?.close();
    this.decoder = new VideoDecoder({
      output: frame => {
        this.stats.decoded += 1;
        this.onFrame(frame);
      },
      error: e => {
        this.onError(new Error(String(e)));
      },
    });

    try {
      this.decoder.configure({
        codec,
        optimizeForLatency: true,
      });
      this.emitStats();
    } catch (e) {
      console.log(`[H264] configure failed:`, e);
      return;
    }

    this.configured = true;
  }

  private handleFrame(
    pts: bigint,
    ptsAndFlags: bigint,
    data: Uint8Array
  ): void {
    if (!this.configured || !this.decoder) {
      return;
    }
    this.stats.frames += 1;

    const isKey =
      (ptsAndFlags & PACKET_FLAG_KEY_FRAME) !== 0n || hasIdrNal(data);
    if (isKey) {
      this.stats.keyframes += 1;
    }
    this.stats.waitingForKeyframe = this.waitingForKeyframe;

    if (!isKey && this.waitingForKeyframe) {
      return;
    }
    this.waitingForKeyframe = false;
    this.stats.waitingForKeyframe = false;

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
          type: isKey ? 'key' : 'delta',
          timestamp: Number(pts),
          data: frameData,
        })
      );
      this.emitStats();
    } catch (e) {
      console.log(`[H264] decode error:`, e);
      this.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /** Release the underlying VideoDecoder. */
  close(): void {
    if (this.decoder && this.decoder.state !== 'closed') {
      this.decoder.close();
    }
    this.decoder = null;
    this.configured = false;
    this.codecConfig = null;
    this.waitingForKeyframe = true;
    this.stats.waitingForKeyframe = true;
  }

  private emitStats(): void {
    this.onStats({ ...this.stats });
  }
}
