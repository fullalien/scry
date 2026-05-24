import { useEffect, RefObject } from 'react';
import {
  encodeInjectKeycodeEvent,
  encodeInjectTextEvent,
  KeyAction,
  keyboardEventToAndroidKeycode,
} from '@shared/scrcpy';
import type { PageState } from './useDeviceStream';

export function useKeyboardInput(
  wsRef: RefObject<WebSocket | null>,
  pageState: PageState
): void {
  useEffect(() => {
    if (pageState !== 'streaming') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      const key = e.key.toLowerCase();
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        (key === 'c' || key === 'v' || key === 'x')
      ) {
        return;
      }

      const keycode = keyboardEventToAndroidKeycode(e);
      if (keycode !== undefined) {
        const msg = encodeInjectKeycodeEvent({
          action: KeyAction.DOWN,
          keycode,
        });
        ws.send(msg.buffer as ArrayBuffer);
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        const msg = encodeInjectTextEvent(e.key);
        ws.send(
          msg.buffer.slice(
            msg.byteOffset,
            msg.byteOffset + msg.byteLength
          ) as ArrayBuffer
        );
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      const key = e.key.toLowerCase();
      if (
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        (key === 'c' || key === 'v' || key === 'x')
      ) {
        return;
      }

      const keycode = keyboardEventToAndroidKeycode(e);
      if (keycode !== undefined) {
        const msg = encodeInjectKeycodeEvent({ action: KeyAction.UP, keycode });
        ws.send(msg.buffer as ArrayBuffer);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [pageState]);
}
