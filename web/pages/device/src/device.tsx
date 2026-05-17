import React from 'react';
import { createRoot } from 'react-dom/client';
import { Squircle } from '@squircle-js/react';
import { ScrcpyH264Decoder } from '../../../lib/codec/h264.js';
import {
  DEVICES_PATH,
  SCRCPY_DEVICE_STREAM_PATH,
} from '../../../lib/shared/path.constants.js';
import { Spinner } from '../../../components/spinner.js';
import './device.css';
import backIcon from '../../../assets/icon/sysbar_back.svg';
import homeIcon from '../../../assets/icon/sysbar_home.svg';
import recentIcon from '../../../assets/icon/sysbar_recent.svg';
import screenShotIcon from '../../../assets/icon/ic_screenshot.svg';

type AdbDevice = {
  id: string;
  state: string;
  model?: string;
  brand?: string;
  androidVersion?: string;
  screenRes?: string;
  screenDensity?: string;
  screenCornerRadius?: number;
};

type Size = { width: number; height: number };

const DEFAULT_FALLBACK_DPI = 420;
const DEFAULT_SCREEN_RADIUS = 0;
const SCREEN_BORDER_WIDTH = 4;

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
  const ctxRef = React.useRef<CanvasRenderingContext2D | null>(null);
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

  const screenScale = React.useMemo(() => {
    const w = displaySize.width + SCREEN_BORDER_WIDTH * 2;
    const h = displaySize.height + SCREEN_BORDER_WIDTH * 2;
    const horizontalPadding = 40;
    const verticalPadding = 40;
    const toolbarHeight = 52;
    const gapHeight = 24;
    const availableWidth = Math.max(120, viewport.width - horizontalPadding);
    const availableHeight = Math.max(
      120,
      viewport.height - verticalPadding - toolbarHeight - gapHeight
    );
    return Math.min(1, availableWidth / w, availableHeight / h);
  }, [displaySize, viewport]);

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

    ctxRef.current = ctx;

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

  const isLoading = deviceInfo === null && !streamError && deviceSerial !== null;

  const toolbarTitle =
    isLoading
      ? 'Loading...'
      : deviceInfo?.brand && deviceInfo?.model
        ? `${deviceInfo.brand} ${deviceInfo.model}`
        : deviceInfo?.model || deviceSerial || 'Unknown device';

  React.useEffect(() => {
    document.title = toolbarTitle;
    return () => {
      document.title = '';
    };
  }, [toolbarTitle]);

  const toolbarMeta = [
    deviceInfo?.androidVersion ? `Android ${deviceInfo.androidVersion}` : null,
    frameSize
      ? `${frameSize.width}x${frameSize.height}`
      : deviceInfo?.screenRes || null,
    deviceInfo?.screenDensity ? `${deviceInfo.screenDensity} dpi` : null,
  ]
    .filter(Boolean)
    .join('  •  ');

  const screenCornerRadius = React.useMemo(() => {
    const density = parseDensity(deviceInfo?.screenDensity);
    if (deviceInfo?.screenCornerRadius && density) {
      return toCssInchPixels(deviceInfo.screenCornerRadius, density);
    }
    return DEFAULT_SCREEN_RADIUS;
  }, [deviceInfo?.screenCornerRadius, deviceInfo?.screenDensity]);

  const handleScreenshot = React.useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const deviceName = deviceInfo?.brand && deviceInfo?.model
        ? `${deviceInfo.brand}_${deviceInfo.model}`
        : deviceInfo?.model || deviceSerial || 'device';
      const safeName = deviceName.replace(/\s+/g, '_');
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, '0');
      const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${pad(now.getMilliseconds()).padStart(3, '0')}Z`;
      a.download = `${safeName}-${ts}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, [deviceInfo?.model, deviceSerial]);

  return (
    <main className="device-page">
      {isLoading && (
        <div className="device-loader" role="status" aria-live="polite">
          <Spinner name="waverows" />
        </div>
      )}
      <div className="device-stage" style={{ opacity: isLoading ? 0 : 1 }}>
        <div className="device-stack">
          <div className="device-toolbar" role="status" aria-live="polite">
            <div className="toolbar-left">
              <span className="toolbar-title">{toolbarTitle}</span>
              {toolbarMeta && (
                <span className="toolbar-meta">{toolbarMeta}</span>
              )}
            </div>
            <div className="toolbar-right">
              <button type="button" className="toolbar-btn" aria-label="Screenshot" onClick={handleScreenshot}>
                <img src={screenShotIcon} alt="" />
              </button>
              <div className="toolbar-divider" />
              <div className="toolbar-nav">
                <button type="button" className="toolbar-btn" aria-label="Back">
                  <img src={backIcon} alt="" />
                </button>
                <button type="button" className="toolbar-btn" aria-label="Home">
                  <img src={homeIcon} alt="" />
                </button>
                <button
                  type="button"
                  className="toolbar-btn"
                  aria-label="Recent apps"
                >
                  <img src={recentIcon} alt="" />
                </button>
              </div>
            </div>
          </div>

          <div
            className="device-screen-wrapper"
            style={{
              width: `${(displaySize.width + SCREEN_BORDER_WIDTH * 2) * screenScale}px`,
              height: `${(displaySize.height + SCREEN_BORDER_WIDTH * 2) * screenScale}px`,
              transform: `scale(${screenScale})`,
              transformOrigin: 'top left',
            }}
          >
            <Squircle
              cornerRadius={
                screenCornerRadius > 0
                  ? screenCornerRadius + SCREEN_BORDER_WIDTH
                  : 0
              }
              cornerSmoothing={0.8}
              style={{
                padding: `${SCREEN_BORDER_WIDTH}px`,
                background: 'black',
              }}
            >
              <Squircle
                cornerRadius={screenCornerRadius}
                cornerSmoothing={0.8}
              >
                <div
                  className="device-screen"
                  style={{
                    width: `${displaySize.width}px`,
                    height: `${displaySize.height}px`,
                  }}
                >
                  <canvas ref={canvasRef} className="device-canvas" />
                  {!frameSize && !streamError && (
                    <div className="device-placeholder">
                      <div className="placeholder-loading">
                        <Spinner name="rain" />
                        <span>Waiting for stream...</span>
                      </div>
                    </div>
                  )}
                </div>
              </Squircle>
            </Squircle>
          </div>
        </div>

        {streamError && (
          <p className="device-error">Stream error: {streamError}</p>
        )}
      </div>
    </main>
  );
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root');
}

createRoot(container).render(<DeviceApp />);
