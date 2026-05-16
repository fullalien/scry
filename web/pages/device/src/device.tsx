import React from 'react';
import { createRoot } from 'react-dom/client';
import { ScrcpyH264Decoder } from '../../../lib/codec/h264.js';
import { SCRCPY_DEVICE_STREAM_PATH } from '../../../lib/shared/path.constants.js';
import './device.css';

function getDeviceSerialFromUrl(): string | null {
  const path = window.location.pathname;
  const match = path.match(/^\/device\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function DeviceApp() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [deviceSerial, setDeviceSerial] = React.useState<string | null>(null);
  const [streamError, setStreamError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const serial = getDeviceSerialFromUrl();
    setDeviceSerial(serial);

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

    ws.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
      if (typeof e.data === 'string') {
        return;
      }
      decoder.push(e.data);
    };

    ws.onerror = () => {
      console.error('[Mirror] WebSocket connection error');
      setStreamError('WebSocket connection error');
    };

    ws.onclose = e => {
      if (e.code !== 1000 && e.code !== 1005) {
        const errorMsg = `Stream closed: ${e.reason || `code ${e.code}`}`;
        console.error('[Mirror]', errorMsg);
        setStreamError(errorMsg);
      }
    };

    return () => {
      ws.close();
      decoder.close();
    };
  }, []);

  return (
    <main style={{ fontFamily: 'ui-sans-serif, system-ui', padding: 24 }}>
      <h1>Device: {deviceSerial || 'Unknown'}</h1>
      {streamError && (
        <p style={{ color: '#b91c1c', fontSize: '0.85rem', margin: '4px 0' }}>
          Stream error: {streamError}
        </p>
      )}
      <canvas
        ref={canvasRef}
        style={{
          display: 'block',
          background: '#000',
        }}
      />
    </main>
  );
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root');
}

createRoot(container).render(<DeviceApp />);
