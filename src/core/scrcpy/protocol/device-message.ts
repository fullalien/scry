/**
 * Device → server message parsing (scrcpy v4.0).
 *
 * Device sends: clipboard text, clipboard ACK, or UHID (HID) output data.
 */

import { DeviceMessageType } from './device-message-constants.js';

export type DeviceMessage =
  | { type: 'clipboard'; text: string }
  | { type: 'ack_clipboard'; sequence: string }
  | { type: 'uhid_output'; id: number; data: Buffer };

/** Parse one device message from a reader function. */
export async function parseDeviceMessage(
  read: (n: number) => Promise<Buffer>
): Promise<DeviceMessage> {
  const type = (await read(1)).readUInt8(0);

  switch (type) {
    case DeviceMessageType.CLIPBOARD: {
      const len = (await read(4)).readUInt32BE(0);
      const textBuf = len > 0 ? await read(len) : Buffer.alloc(0);
      return { type: 'clipboard', text: textBuf.toString('utf8') };
    }

    case DeviceMessageType.ACK_CLIPBOARD: {
      const sequence = (await read(8)).readBigUInt64BE(0);
      return { type: 'ack_clipboard', sequence: sequence.toString() };
    }

    case DeviceMessageType.UHID_OUTPUT: {
      const header = await read(4);
      const id = header.readUInt16BE(0);
      const size = header.readUInt16BE(2);
      const data = size > 0 ? await read(size) : Buffer.alloc(0);
      return { type: 'uhid_output', id, data };
    }

    default:
      throw new Error(`Unknown device message type: ${type}`);
  }
}
