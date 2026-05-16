/**
 * Scrcpy protocol constants and types (v4.0).
 *
 * Reference: scrcpy-server Streamer.java / DeviceMessageSender.java
 * Protocol parsers live in `protocol/`.
 */

// ─── Connection ──────────────────────────────────────────────────────────────

/** TCP port used for adb forward (must match the scrcpy-server socket). */
export const SCRCPY_FORWARD_PORT = 27183;

/** Default stream connection identifier. */
export const DEFAULT_SCID = 0;

// ─── Video packet flags (Streamer.java, bit positions) ───────────────────────

/** Bit 62: this packet contains codec configuration data. */
export const PKT_FLAG_CONFIG = 0x4000000000000000n;

/** Bit 61: this packet is a key frame (IDR). */
export const PKT_FLAG_KEY_FRAME = 0x2000000000000000n;

// ─── H.264 NAL unit types ───────────────────────────────────────────────────

export const NAL_UNIT_TYPE_IDR = 5;

// ─── Internal WS frame constants ─────────────────────────────────────────────

/** Byte 0 of our internal WS frame — identifies video payload. */
export const VIDEO_MSG_TYPE = 0x01;

// ─── Device → server message types ───────────────────────────────────────────

export const DeviceMessageType = {
  CLIPBOARD: 0x00,
  ACK_CLIPBOARD: 0x01,
  UHID_OUTPUT: 0x02,
} as const;

// ─── Header sizes ────────────────────────────────────────────────────────────

/** Session header: 4-byte flags + 4-byte width + 4-byte height. */
export const SESSION_HEADER_SIZE = 12;

/** Media header: 8-byte pts_flags + 4-byte payload size. */
export const MEDIA_HEADER_SIZE = 12;

// ─── Handshake ───────────────────────────────────────────────────────────────

export const DEVICE_NAME_LEN = 64;
export const CODEC_ID_LEN = 4;

export const CODEC_ID_DISABLED = 0x00000000;
export const CODEC_ID_CONFIG_ERROR = 0x00000001;

// ─── Safety guard ────────────────────────────────────────────────────────────

export const MAX_VIDEO_PAYLOAD_SIZE = 16 * 1024 * 1024; // 16 MiB

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Utility functions ───────────────────────────────────────────────────────

/** Decode a 4-byte codec id to readable text (e.g. "h264" or "0x00000002"). */
export function codecIdToText(codecId: number): string {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(codecId, 0);
  const text = b.toString('ascii').replace(/\0/g, '');
  return text.length > 0 ? text : `0x${codecId.toString(16).padStart(8, '0')}`;
}

/** Convert scid to 8-char hex string, masking sign bit. */
export function toScidHex(scid: number): string {
  const normalized = (scid & 0x7fffffff) >>> 0;
  return normalized.toString(16).padStart(8, '0');
}

/** Parse bit-rate values like "8M", "4000K", or plain numbers → bps integer. */
export function parseBitRate(
  value: number | string | undefined,
  defaultBps = 4_000_000
): number {
  if (value === undefined || value === null) return defaultBps;
  if (typeof value === 'number') return value;
  const match = /^(\d+(?:\.\d+)?)\s*([KkMmGg])?$/.exec(value.trim());
  if (!match) return defaultBps;
  const n = parseFloat(match[1] ?? '');
  const suffix = (match[2] ?? '').toUpperCase();
  if (suffix === 'K') return Math.round(n * 1_000);
  if (suffix === 'M') return Math.round(n * 1_000_000);
  if (suffix === 'G') return Math.round(n * 1_000_000_000);
  return Math.round(n);
}
