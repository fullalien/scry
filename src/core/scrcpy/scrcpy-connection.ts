/** TCP port used for adb forward (must match the scrcpy-server socket). */
export const SCRCPY_FORWARD_PORT = 27183;

/** Default stream connection identifier. */
export const DEFAULT_SCID = 0;

/** Convert scid to 8-char hex string, masking sign bit. */
export function toScidHex(scid: number): string {
  const normalized = (scid & 0x7fffffff) >>> 0;
  return normalized.toString(16).padStart(8, '0');
}
