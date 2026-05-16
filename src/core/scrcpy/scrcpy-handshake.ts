export const DEVICE_NAME_LEN = 64;
export const CODEC_ID_LEN = 4;

export const CODEC_ID_DISABLED = 0x00000000;
export const CODEC_ID_CONFIG_ERROR = 0x00000001;

/** Decode a 4-byte codec id to readable text (e.g. "h264" or "0x00000002"). */
export function codecIdToText(codecId: number): string {
  const b = Buffer.allocUnsafe(4);
  b.writeUInt32BE(codecId, 0);
  const text = b.toString('ascii').replace(/\0/g, '');
  return text.length > 0 ? text : `0x${codecId.toString(16).padStart(8, '0')}`;
}
