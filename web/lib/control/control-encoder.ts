export const ControlMessageType = {
  INJECT_KEYCODE: 0x00,
  INJECT_TEXT: 0x01,
  INJECT_TOUCH_EVENT: 0x02,
  INJECT_SCROLL_EVENT: 0x03,
  BACK_OR_SCREEN_ON: 0x04,
  EXPAND_NOTIFICATION_PANEL: 0x05,
  EXPAND_SETTINGS_PANEL: 0x06,
  COLLAPSE_PANELS: 0x07,
  GET_CLIPBOARD: 0x08,
  SET_CLIPBOARD: 0x09,
  SET_DISPLAY_POWER: 0x0a,
  ROTATE_DEVICE: 0x0b,
  UHID_CREATE: 0x0c,
  UHID_INPUT: 0x0d,
  UHID_DESTROY: 0x0e,
  OPEN_HARD_KEYBOARD_SETTINGS: 0x0f,
  START_APP: 0x10,
  RESET_VIDEO: 0x11,
} as const;

export const TouchAction = {
  DOWN: 0,
  UP: 1,
  MOVE: 2,
} as const;

export const KeyAction = {
  DOWN: 0,
  UP: 1,
} as const;

/**
 * INJECT_KEYCODE — 14 bytes
 * type(1) + action(1) + keycode(4) + repeat(4) + metastate(4)
 */
export function encodeInjectKeycodeEvent(params: {
  action: number;
  keycode: number;
  repeat?: number;
  metaState?: number;
}): Uint8Array {
  const buf = new ArrayBuffer(14);
  const view = new DataView(buf);
  view.setUint8(0, ControlMessageType.INJECT_KEYCODE);
  view.setUint8(1, params.action);
  view.setUint32(2, params.keycode, false);
  view.setUint32(6, params.repeat ?? 0, false);
  view.setUint32(10, params.metaState ?? 0, false);
  return new Uint8Array(buf);
}

/**
 * INJECT_TEXT — 5 + text.length bytes (max 300 bytes UTF-8)
 */
export function encodeInjectTextEvent(text: string): Uint8Array {
  const encoded = new TextEncoder().encode(text);
  const buf = new Uint8Array(5 + encoded.length);
  buf[0] = ControlMessageType.INJECT_TEXT;
  const view = new DataView(buf.buffer);
  view.setUint32(1, encoded.length, false);
  buf.set(encoded, 5);
  return buf;
}

/**
 * INJECT_TOUCH_EVENT — 32 bytes
 * type(1) + action(1) + pointerId(8) + x(4) + y(4) + width(2) + height(2) + pressure(2) + action_button(4) + buttons(4)
 */
export function encodeInjectTouchEvent(params: {
  action: number;
  pointerId?: number;
  x: number;
  y: number;
  screenWidth?: number;
  screenHeight?: number;
  pressure?: number;
}): Uint8Array {
  const buf = new ArrayBuffer(32);
  const view = new DataView(buf);
  view.setUint8(0, ControlMessageType.INJECT_TOUCH_EVENT);
  view.setUint8(1, params.action);
  // pointerId: 0xFFFFFFFFFFFFFFFF for mouse (8 bytes of 0xFF)
  buf[2] = 0xff; buf[3] = 0xff; buf[4] = 0xff; buf[5] = 0xff;
  buf[6] = 0xff; buf[7] = 0xff; buf[8] = 0xff; buf[9] = 0xff;
  view.setUint32(10, Math.round(params.x), false);
  view.setUint32(14, Math.round(params.y), false);
  view.setUint16(18, params.screenWidth ?? 0, false);
  view.setUint16(20, params.screenHeight ?? 0, false);
  // pressure: uint16, 0xFFFF = 1.0
  const pressure = params.pressure ?? 1.0;
  view.setUint16(22, Math.round(pressure * 0xffff), false);
  view.setUint32(24, 0, false); // action_button
  view.setUint32(28, 0, false); // buttons
  return new Uint8Array(buf);
}

/**
 * BACK_OR_SCREEN_ON — 2 bytes
 * type(1) + action(1)
 */
export function encodeBackOrScreenOn(action: number = 0): Uint8Array {
  const buf = new Uint8Array(2);
  buf[0] = ControlMessageType.BACK_OR_SCREEN_ON;
  buf[1] = action;
  return buf;
}
