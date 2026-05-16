/** Bit 62: this packet contains codec configuration data. */
export const PKT_FLAG_CONFIG = 0x4000000000000000n;

/** Bit 61: this packet is a key frame (IDR). */
export const PKT_FLAG_KEY_FRAME = 0x2000000000000000n;

export const NAL_UNIT_TYPE_IDR = 5;

/** Byte 0 of our internal WS frame — identifies video payload. */
export const VIDEO_MSG_TYPE = 0x01;

export const MAX_VIDEO_PAYLOAD_SIZE = 16 * 1024 * 1024; // 16 MiB
