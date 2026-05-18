import { useRef, useEffect, useState, useCallback } from 'react';
import { ScrcpyH264Decoder } from '@shared/codec';
import {
  SCRCPY_DEVICE_STREAM_PATH,
} from '@shared/constants';
import { STREAM_TIMEOUT_MS } from '../constants';

export type Size = { width: number; height: number };
export type PageState = 'loading' | 'streaming' | 'error';

export function useDeviceStream(
  deviceSerial: string | null,
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
  retryKey: number
): {
  pageState: PageState;
  streamError: string | null;
  frameSize: Size | null;
  wsRef: React.MutableRefObject<WebSocket | null>;
  handleRetry: () => void;
} {
  const wsRef = useRef<WebSocket | null>(null);
  const [pageState, setPageState] = useState<PageState>('loading');
  const [streamError, setStreamError] = useState<string | null>(null);
  const [frameSize, setFrameSize] = useState<Size | null>(null);

  const handleRetry = useCallback(() => {
    setStreamError(null);
    setFrameSize(null);
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

    const decoder = new ScrcpyH264Decoder(
      frame => {
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
      console.info('Received WebSocket message', { data: e.data instanceof ArrayBuffer ? '[binary data]' : e.data });
      if (typeof e.data === 'string') {
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
      ws.close();
      wsRef.current = null;
      decoder.close();
    };
  }, [retryKey]);

  return { pageState, streamError, frameSize, wsRef, handleRetry };
}
