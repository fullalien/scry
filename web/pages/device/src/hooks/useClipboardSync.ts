import { useEffect, useRef, type RefObject } from 'react';
import {
  ClipboardCopyKey,
  encodeGetClipboard,
  encodeSetClipboard,
} from '@shared/scrcpy';
import type { DeviceMessageEvent, PageState } from './useDeviceStream';
import type { ToastTone } from './useToast';

function sendControlPacket(
  wsRef: RefObject<WebSocket | null>,
  packet: Uint8Array
): boolean {
  const ws = wsRef.current;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    return false;
  }
  ws.send(
    packet.buffer.slice(
      packet.byteOffset,
      packet.byteOffset + packet.byteLength
    ) as ArrayBuffer
  );
  return true;
}

function isClipboardShortcutEvent(e: KeyboardEvent): boolean {
  if (!e.metaKey && !e.ctrlKey) {
    return false;
  }
  if (e.altKey) {
    return false;
  }
  const key = e.key.toLowerCase();
  return key === 'c' || key === 'v' || key === 'x';
}

export function useClipboardSync(
  wsRef: RefObject<WebSocket | null>,
  pageState: PageState,
  deviceMessageEvent: DeviceMessageEvent | null,
  notify: (text: string, tone: ToastTone, durationMs?: number) => void
): void {


  useEffect(() => {
    if (pageState !== 'streaming') {
      return;
    }

    if (!deviceMessageEvent || deviceMessageEvent.message.type !== 'clipboard') {
      return;
    }

    const text = deviceMessageEvent.message.text;
    if (typeof navigator.clipboard?.writeText !== 'function') {
      notify('Browser clipboard write unavailable', 'error');
      return;
    }

    void navigator.clipboard.writeText(text).then(
      () => {},
      err => {
        console.warn('[ClipboardSync] Failed to write browser clipboard', err);
        notify('Clipboard write blocked by browser', 'error');
      }
    );
  }, [deviceMessageEvent, notify, pageState]);

  useEffect(() => {
    if (pageState !== 'streaming') {
      return;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isClipboardShortcutEvent(e)) {
        return;
      }
      if (e.repeat) {
        return;
      }
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      e.preventDefault();
      e.stopPropagation();

      if (key === 'v') {
        if (typeof navigator.clipboard?.readText !== 'function') {
          notify('Browser clipboard read unavailable', 'error');
          return;
        }

        void navigator.clipboard.readText().then(
          text => {
            const sent = sendControlPacket(
              wsRef,
              encodeSetClipboard({ text, paste: true })
            );
            if (!sent) {
              notify('Device connection is not ready', 'error');
              return;
            }
            notify('Pasted to device', 'success');
          },
          err => {
            console.warn('[ClipboardSync] Failed to read browser clipboard', err);
            notify('Clipboard read blocked by browser', 'error');
          }
        );
        return;
      }

      const copyKey =
        key === 'x' ? ClipboardCopyKey.CUT : ClipboardCopyKey.COPY;

      const sent = sendControlPacket(wsRef, encodeGetClipboard(copyKey));
      if (!sent) {
        notify('Device connection is not ready', 'error');
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [notify, pageState, wsRef]);
}
