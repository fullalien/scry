import React from 'react';
import { createRoot } from 'react-dom/client';
import { Squircle } from '@squircle-js/react';
import { ScrcpyH264Decoder } from '../../../lib/codec/h264.js';
import {
  DEVICES_PATH,
  SCRCPY_DEVICE_STREAM_PATH,
} from '../../../lib/shared/path.constants.js';
import './device.css';

type AdbDevice = {
  id: string;
  state: string;
  model?: string;
  brand?: string;
  androidVersion?: string;
  screenRes?: string;
  screenDensity?: string;
};

type Size = {
  width: number;
  height: number;
};

const DEFAULT_FALLBACK_DPI = 420;
const TOP_BAR_HEIGHT = 52;
const STACK_GAP = 12;
const BORDER_RADIUS = 18;
const BORDER_WIDTH = 4;

function parseResolution(value?: string): Size | null {
  if (!value) return null;
  const match = value.match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

function parseDensity(value?: string): number | null {
  if (!value) return null;
  const match = value.match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const density = Number(match[1]);
  if (!Number.isFinite(density) || density <= 0) return null;
  return density;
}

function toCssInchPixels(px: number, density: number): number {
  return (px * 96) / density;
}

function alignOrientation(target: Size, reference: Size): Size {
  const sameOrientation =
    (target.width >= target.height && reference.width >= reference.height) ||
    (target.width < target.height && reference.width < reference.height);
  if (sameOrientation) return target;
  return { width: target.height, height: target.width };
}

function getDeviceSerialFromUrl(): string | null {
  const path = window.location.pathname;
  const match = path.match(/^\/device\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function DeviceApp() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [deviceSerial, setDeviceSerial] = React.useState<string | null>(null);
  const [deviceInfo, setDeviceInfo] = React.useState<AdbDevice | null>(null);
  const [viewport, setViewport] = React.useState<Size>({
    width: window.innerWidth,
    height: window.innerHeight,
  });
  const [frameSize, setFrameSize] = React.useState<Size | null>(null);
  const [streamError, setStreamError] = React.useState<string | null>(null);

  const displaySize = React.useMemo<Size>(() => {
    const resolution = parseResolution(deviceInfo?.screenRes);
    const density = parseDensity(deviceInfo?.screenDensity);

    if (resolution && density) {
      const physical: Size = {
        width: toCssInchPixels(resolution.width, density),
        height: toCssInchPixels(resolution.height, density),
      };
      if (frameSize) {
        const aligned = alignOrientation(physical, frameSize);
        // Use frameSize aspect ratio to avoid black bars when scrcpy
        // outputs a slightly different resolution than the device reports.
        const frameAspect = frameSize.height / frameSize.width;
        return { width: aligned.width, height: aligned.width * frameAspect };
      }
      return physical;
    }

    if (frameSize) {
      return {
        width: toCssInchPixels(frameSize.width, DEFAULT_FALLBACK_DPI),
        height: toCssInchPixels(frameSize.height, DEFAULT_FALLBACK_DPI),
      };
    }

    return { width: 360, height: 780 };
  }, [deviceInfo?.screenDensity, deviceInfo?.screenRes, frameSize]);

  const toolbarWidth = React.useMemo(() => {
    const minWidth = 420;
    const extra = 120;
    return Math.max(minWidth, displaySize.width + extra);
  }, [displaySize.width]);

  const stackSize = React.useMemo<Size>(() => {
    return {
      width: Math.max(displaySize.width, toolbarWidth),
      height: displaySize.height + TOP_BAR_HEIGHT + STACK_GAP,
    };
  }, [displaySize.height, displaySize.width, toolbarWidth]);

  const stackScale = React.useMemo(() => {
    const horizontalPadding = 40;
    const verticalPadding = 40;
    const availableWidth = Math.max(120, viewport.width - horizontalPadding);
    const availableHeight = Math.max(120, viewport.height - verticalPadding);
    return Math.min(1, availableWidth / stackSize.width, availableHeight / stackSize.height);
  }, [stackSize.height, stackSize.width, viewport.height, viewport.width]);

  React.useEffect(() => {
    const onResize = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, []);

  React.useEffect(() => {
    if (!deviceSerial) return;

    let cancelled = false;
    const loadDeviceInfo = async () => {
      try {
        const response = await fetch(DEVICES_PATH);
        if (!response.ok) return;
        const payload = (await response.json()) as { devices?: AdbDevice[] };
        if (cancelled) return;
        const found = payload.devices?.find(d => d.id === deviceSerial) ?? null;
        setDeviceInfo(found);
      } catch {
        // Keep UI usable even when device metadata cannot be loaded.
      }
    };

    void loadDeviceInfo();

    return () => {
      cancelled = true;
    };
  }, [deviceSerial]);

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

  const toolbarTitle =
    deviceInfo?.brand && deviceInfo?.model
      ? `${deviceInfo.brand} ${deviceInfo.model}`
      : deviceInfo?.model || deviceSerial || 'Unknown device';

  const toolbarMeta = [
    deviceInfo?.androidVersion ? `Android ${deviceInfo.androidVersion}` : null,
    frameSize ? `${frameSize.width}x${frameSize.height}` : deviceInfo?.screenRes || null,
    deviceInfo?.screenDensity ? `${deviceInfo.screenDensity} dpi` : null,
  ]
    .filter(Boolean)
    .join('  •  ');

  return (
    <main className="device-page">
      <div className="device-stage">
        <div
          className="device-stack"
          style={{
            width: `${stackSize.width}px`,
            height: `${stackSize.height}px`,
            transform: `scale(${stackScale})`,
          }}
        >
          <header
            className="device-toolbar"
            role="status"
            aria-live="polite"
            style={{ width: `${toolbarWidth}px` }}
          >
            <div className="toolbar-left">
              <span className="toolbar-title">{toolbarTitle}</span>
              {toolbarMeta && <span className="toolbar-meta">{toolbarMeta}</span>}
            </div>
            <div className="toolbar-right" aria-hidden="true">
              <span className="toolbar-pill">H.264</span>
              <span className="toolbar-pill toolbar-pill--active">MJPEG</span>
              <span className="toolbar-icon">⌂</span>
              <span className="toolbar-icon">◍</span>
              <span className="toolbar-icon">⧉</span>
            </div>
          </header>

          <Squircle
            cornerRadius={BORDER_RADIUS}
            cornerSmoothing={0.8}
            style={{
              padding: `${BORDER_WIDTH}px`,
              background: 'black',
            }}
          >
            <Squircle
              cornerRadius={BORDER_RADIUS - BORDER_WIDTH}
              cornerSmoothing={0.8}
            >
              <div
                className="device-screen"
                style={{
                  width: `${displaySize.width}px`,
                  height: `${displaySize.height}px`,
                }}>
                <canvas ref={canvasRef} className="device-canvas" />
                {!frameSize && !streamError && (
                  <div className="device-placeholder">Waiting for stream...</div>
                )}
                <span>${displaySize.width} ${displaySize.height}</span>
              </div>
            </Squircle>
          </Squircle>

          {streamError && <p className="device-error">Stream error: {streamError}</p>}
        </div>
      </div>
    </main>
  );
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root');
}

createRoot(container).render(<DeviceApp />);
