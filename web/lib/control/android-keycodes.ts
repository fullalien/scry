export const AndroidKeyCode = {
  BACK: 4,
  HOME: 3,
  APP_SWITCH: 187,
  DPAD_UP: 19,
  DPAD_DOWN: 20,
  DPAD_LEFT: 21,
  DPAD_RIGHT: 22,
  DPAD_CENTER: 23,
  ENTER: 66,
  ESCAPE: 111,
  TAB: 61,
  SPACE: 62,
  DELETE: 67,
  FORWARD_DEL: 112,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  VOLUME_MUTE: 164,
  POWER: 26,
} as const;

export const KEY_TO_ANDROID_KEYCODE = new Map<string, number>([
  ['Enter', AndroidKeyCode.ENTER],
  ['Escape', AndroidKeyCode.ESCAPE],
  ['Tab', AndroidKeyCode.TAB],
  [' ', AndroidKeyCode.SPACE],
  ['Backspace', AndroidKeyCode.DELETE],
  ['Delete', AndroidKeyCode.FORWARD_DEL],
  ['ArrowUp', AndroidKeyCode.DPAD_UP],
  ['ArrowDown', AndroidKeyCode.DPAD_DOWN],
  ['ArrowLeft', AndroidKeyCode.DPAD_LEFT],
  ['ArrowRight', AndroidKeyCode.DPAD_RIGHT],
]);

export function keyboardEventToAndroidKeycode(
  event: KeyboardEvent
): number | undefined {
  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
    return undefined;
  }
  return KEY_TO_ANDROID_KEYCODE.get(event.key);
}
