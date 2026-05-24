import { useRef, useEffect, useState } from 'react';
import { SCRCPY_DEVICE_CONTROL_PATH } from '@shared/constants';
import type { PageState } from './useDeviceStream';

export type DeviceMessage =
  | { type: 'clipboard'; text: string }
  | { type: 'ack_clipboard'; sequence: string }
  | { type: 'uhid_output'; id: number; data?: string };

export type DeviceMessageEvent = {
  id: number;
  message: DeviceMessage;
};

function parseDeviceMessageFromEnvelope(raw: string): DeviceMessage | null {
  try {
    const parsed = JSON.parse(raw) as {
      type?: unknown;
      payload?: unknown;
    };

    if (parsed.type !== 'device-message') {
      return null;
    }

    const payload = parsed.payload;
    if (!payload || typeof payload !== 'object' || !('type' in payload)) {
      return null;
    }

    const type = (payload as { type?: unknown }).type;

    if (
      type === 'clipboard' &&
      typeof (payload as { text?: unknown }).text === 'string'
    ) {
      return {
        type: 'clipboard',
        text: (payload as { text: string }).text,
      };
    }

    if (
      type === 'ack_clipboard' &&
      typeof (payload as { sequence?: unknown }).sequence === 'string'
    ) {
      return {
        type: 'ack_clipboard',
        sequence: (payload as { sequence: string }).sequence,
      };
    }

    if (
      type === 'uhid_output' &&
      typeof (payload as { id?: unknown }).id === 'number'
    ) {
      const maybeData = (payload as { data?: unknown }).data;
      return {
        type: 'uhid_output',
        id: (payload as { id: number }).id,
        ...(typeof maybeData === 'string' ? { data: maybeData } : {}),
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function useDeviceControl(
  deviceSerial: string | null,
  pageState: PageState,
  retryKey: number
): {
  controlWsRef: React.MutableRefObject<WebSocket | null>;
  deviceMessageEvent: DeviceMessageEvent | null;
} {
  const controlWsRef = useRef<WebSocket | null>(null);
  const [deviceMessageEvent, setDeviceMessageEvent] =
    useState<DeviceMessageEvent | null>(null);
  const messageSeqRef = useRef(0);

  useEffect(() => {
    if (pageState !== 'streaming') {
      controlWsRef.current?.close();
      controlWsRef.current = null;
      setDeviceMessageEvent(null);
      return;
    }

    const serial = deviceSerial;
    if (!serial) {
      return;
    }

    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPath = SCRCPY_DEVICE_CONTROL_PATH.replace(':deviceSerial', serial);
    setDeviceMessageEvent(null);
    const ws = new WebSocket(`${wsProto}//${location.host}${wsPath}`);
    ws.binaryType = 'arraybuffer';
    controlWsRef.current = ws;

    ws.onmessage = e => {
      if (typeof e.data !== 'string') {
        return;
      }
      const msg = parseDeviceMessageFromEnvelope(e.data);
      if (!msg) {
        return;
      }
      messageSeqRef.current += 1;
      setDeviceMessageEvent({
        id: messageSeqRef.current,
        message: msg,
      });
    };

    ws.onerror = () => {
      // Keep this channel best-effort. Video connection state is authoritative.
      console.warn('[Control] WebSocket error');
    };

    ws.onclose = e => {
      console.warn('[Control] WebSocket closed', {
        code: e.code,
        reason: e.reason,
      });
    };

    return () => {
      ws.close();
      if (controlWsRef.current === ws) {
        controlWsRef.current = null;
      }
    };
  }, [deviceSerial, pageState, retryKey]);

  return {
    controlWsRef,
    deviceMessageEvent,
  };
}
