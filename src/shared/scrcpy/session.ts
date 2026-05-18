/**
 * Session packet parsing (scrcpy v4.0).
 *
 * Session header: 4-byte flags + 4-byte width + 4-byte height (12 bytes).
 * The MSB of flags (bit 31) indicates this is a session packet.
 */

export function parseSessionHeader(buf: Buffer): {
  flags: number;
  width: number;
  height: number;
  isSession: boolean;
} {
  const flags = buf.readUInt32BE(0);
  return {
    flags,
    width: buf.readUInt32BE(4),
    height: buf.readUInt32BE(8),
    isSession: (flags & 0x80000000) !== 0,
  };
}

/** Check whether a packet header indicates a session packet. */
export function isSessionPacket(header: Buffer): boolean {
  return (header[0]! & 0x80) !== 0;
}
