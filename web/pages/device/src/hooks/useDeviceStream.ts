import { useRef, useEffect, useState, useCallback } from 'react';
import { ScrcpyH264Decoder } from '@shared/codec';
import { SCRCPY_DEVICE_STREAM_PATH } from '@shared/constants';
import { STREAM_TIMEOUT_MS } from '../constants';

export type Size = { width: number; height: number };
export type PageState = 'loading' | 'streaming' | 'error';
export type DeviceMessage =
  | { type: 'clipboard'; text: string }
  | { type: 'ack_clipboard'; sequence: string }
  | { type: 'uhid_output'; id: number; data?: string };
export type DeviceMessageEvent = { id: number; message: DeviceMessage };

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
    if (!payload || typeof payload !== 'object' || !("type" in payload)) {
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

    if (type === 'uhid_output' && typeof (payload as { id?: unknown }).id === 'number') {
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

export function useDeviceStream(
  deviceSerial: string | null,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  retryKey: number
): {
  pageState: PageState;
  streamError: string | null;
  frameSize: Size | null;
  fps: number;
  deviceMessageEvent: DeviceMessageEvent | null;
  wsRef: React.MutableRefObject<WebSocket | null>;
  handleRetry: () => void;
} {
  const wsRef = useRef<WebSocket | null>(null);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [streamError, setStreamError] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState<Size | null>(null);
  const [fps, setFps] = useState(0);
  const [deviceMessageEvent, setDeviceMessageEvent] =
    useState<DeviceMessageEvent | null>(null);
  const deviceMessageSeqRef = useRef(0);

  const handleRetry = useCallback(() => {
    setStreamError(null);
    setFrameSize(null);
    setFps(0);
    setDeviceMessageEvent(null);
    setPageState('loading');
  }, []);

  useEffect(() => {
    const serial = deviceSerial;
    if (!serial) {
      setStreamError('No device serial provided in URL');
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!('VideoDecoder' in window)) {
      setStreamError(
        'WebCodecs VideoDecoder not supported (Chrome 94+ / Firefox 130+ / Safari 16.4+ required)'
      );
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const frameCounter = { count: 0 };
    const fpsInterval = setInterval(() => {
      setFps(frameCounter.count);
      frameCounter.count = 0;
    }, 1000);

    const decoder = new ScrcpyH264Decoder(
      frame => {
        frameCounter.count++;
        if (
          canvas.width !== frame.displayWidth ||
          canvas.height !== frame.displayHeight
        ) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
          setFrameSize({
            width: frame.displayWidth,
            height: frame.displayHeight,
          });
        }
        ctx.drawImage(frame, 0, 0);
        frame.close();
      },
      err => {
        console.error('[Mirror] Decoder error:', err.message);
        setStreamError(err.message);
      }
    );

    const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPath = SCRCPY_DEVICE_STREAM_PATH.replace(':deviceSerial', serial);
    const ws = new WebSocket(`${wsProto}//${location.host}${wsPath}`);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    console.log('Connecting to stream WebSocket...', { url: ws.url });

    ws.onopen = () => {
      console.log('WebSocket connected');
    };

    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setStreamError('Stream connection timed out');
        setPageState('error');
      }
    }, STREAM_TIMEOUT_MS);

    let firstFrame = true;
    ws.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
      console.info('Received WebSocket message', {
        data: e.data instanceof ArrayBuffer ? '[binary data]' : e.data,
      });
      if (typeof e.data === 'string') {
        const msg = parseDeviceMessageFromEnvelope(e.data);
        if (msg) {
          deviceMessageSeqRef.current += 1;
          setDeviceMessageEvent({
            id: deviceMessageSeqRef.current,
            message: msg,
          });
        }
        return;
      }
      if (firstFrame) {
        firstFrame = false;
        clearTimeout(timeout);
        setPageState('streaming');
      }
      decoder.push(e.data);
    };

    ws.onerror = () => {
      if (cancelled) return;
      console.error('WebSocket connection error');
      setStreamError('WebSocket connection error');
      setPageState('error');
    };

    ws.onclose = e => {
      if (cancelled) return;
      clearTimeout(timeout);
      const errorMsg = `Stream closed: ${e.reason || `code ${e.code}`}`;
      console.error(errorMsg);
      setStreamError(errorMsg);
      setPageState('error');
    };

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      clearInterval(fpsInterval);
      ws.close();
      wsRef.current = null;
      decoder.close();
    };
  }, [retryKey]);

  return {
    pageState,
    streamError,
    frameSize,
    fps,
    deviceMessageEvent,
    wsRef,
    handleRetry,
  };
}
