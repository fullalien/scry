/**
 * Video stream packet parsing (scrcpy v4.0).
 *
 * Media packet header: 8-byte pts_flags + 4-byte payload size (12 bytes).
 * pts_flags bits 62/61 indicate config data and key frame respectively.
 */

import {
  PKT_FLAG_CONFIG,
  PKT_FLAG_KEY_FRAME,
  NAL_UNIT_TYPE_IDR,
  VIDEO_MSG_TYPE,
  MAX_VIDEO_PAYLOAD_SIZE,
} from '../scrcpy.constants.js';

// ─── Header parsing ──────────────────────────────────────────────────────────

export interface ParsedMediaHeader {
  ptsAndFlags: bigint;
  size: number;
  isConfig: boolean;
  isKeyFrame: boolean;
}

/** Parse a media header (12 bytes) → pts_flags, size, config/key flags. */
export function parseMediaHeader(buf: Buffer): ParsedMediaHeader {
  const ptsAndFlags = buf.readBigUInt64BE(0);
  const size = buf.readUInt32BE(8);
  return {
    ptsAndFlags,
    size,
    isConfig: (ptsAndFlags & PKT_FLAG_CONFIG) !== 0n,
    isKeyFrame: (ptsAndFlags & PKT_FLAG_KEY_FRAME) !== 0n,
  };
}

// ─── NAL unit scanning ───────────────────────────────────────────────────────

/**
 * Scan a H.264 Annex-B buffer for NAL unit types.
 * Returns the first matching `wantedType`, or the first NAL type found if
 * `wantedType` is omitted. Returns `undefined` when no start code is present.
 */
export function findNalUnitType(data: Buffer, wantedType?: number): number | undefined {
  for (let i = 0; i <= data.length - 4; i++) {
    if (data[i] !== 0 || data[i + 1] !== 0) continue;

    let headerOff = -1;
    if (data[i + 2] === 1) {
      headerOff = i + 3;
    } else if (data[i + 2] === 0 && data[i + 3] === 1) {
      headerOff = i + 4;
    }

    if (headerOff !== -1 && headerOff < data.length) {
      const nalType = data[headerOff]! & 0x1f;
      if (wantedType === undefined || nalType === wantedType) {
        return nalType;
      }
    }
  }
  return undefined;
}

/** Check if the buffer contains an IDR NAL unit (type 5). */
export function hasIdrNal(data: Buffer): boolean {
  return findNalUnitType(data, NAL_UNIT_TYPE_IDR) !== undefined;
}

// ─── Frame construction ──────────────────────────────────────────────────────

/** WS frame emitted on the "data" event: [type:1B][pts_flags:8B][payload]. */
export type VideoFrame = Buffer;

/** Build a WS frame from pts_flags and payload: [VIDEO_MSG_TYPE][pts_flags:8B][data]. */
export function buildVideoFrame(ptsAndFlags: bigint, payload: Buffer): VideoFrame {
  const frame = Buffer.allocUnsafe(1 + 8 + payload.length);
  frame[0] = VIDEO_MSG_TYPE;
  frame.writeBigUInt64BE(ptsAndFlags, 1);
  payload.copy(frame, 9);
  return frame;
}

// ─── Constants re-exported for callers ───────────────────────────────────────

export { MAX_VIDEO_PAYLOAD_SIZE };
