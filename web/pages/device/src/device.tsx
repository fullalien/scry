import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  parseResolution,
  parseDensity,
  toCssInchPixels,
  alignOrientation,
  type Size,
} from './utils/resolution.js';
import { getDeviceSerialFromUrl } from './utils/url.js';
import {
  DEFAULT_FALLBACK_DPI,
  DEFAULT_SCREEN_RADIUS,
  SCREEN_BORDER_WIDTH,
} from './constants.js';
import { useViewport } from './hooks/useViewport.js';
import { useDeviceInfo } from './hooks/useDeviceInfo.js';
import { useDeviceStream, type PageState } from './hooks/useDeviceStream.js';
import { useTouchInput } from './hooks/useTouchInput.js';
import { useKeyboardInput } from './hooks/useKeyboardInput.js';
import { DeviceToolbar } from './components/DeviceToolbar.js';
import { DeviceScreen } from './components/DeviceScreen.js';
import { DeviceErrorOverlay } from './components/DeviceErrorOverlay.js';
import { TouchIndicator } from './components/TouchIndicator.js';
import { Spinner } from '../../../components/spinner.js';
import './device.css';

function DeviceApp() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const ctxRef = React.useRef<CanvasRenderingContext2D | null>(null);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      ctxRef.current = canvas.getContext('2d');
    }
  }, []);
  const viewport = useViewport();
  const deviceSerial = getDeviceSerialFromUrl();
  const deviceInfo = useDeviceInfo(deviceSerial);
  const [retryKey, setRetryKey] = React.useState(0);
  const { pageState, streamError, frameSize, wsRef, handleRetry } =
    useDeviceStream(deviceSerial, canvasRef, retryKey);
  const {
    touchPos,
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleMouseLeave,
  } = useTouchInput(wsRef, canvasRef, frameSize);
  useKeyboardInput(wsRef, pageState);

  const handleRetryWithReset = React.useCallback(() => {
    handleRetry();
    setRetryKey(k => k + 1);
  }, [handleRetry]);

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
      const deviceName =
        deviceInfo?.brand && deviceInfo?.model
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

  React.useEffect(() => {
    const toolbarTitle =
      pageState === 'loading' && deviceInfo === null
        ? 'Loading...'
        : deviceInfo?.brand && deviceInfo?.model
          ? `${deviceInfo.brand} ${deviceInfo.model}`
          : deviceInfo?.model || deviceSerial || 'Unknown device';
    document.title = toolbarTitle;
    return () => {
      document.title = '';
    };
  }, [pageState, deviceInfo, deviceSerial]);

  return (
    <main className="device-page">
      {pageState === 'loading' && (
        <div className="device-loader" role="status" aria-live="polite">
          <Spinner name="waverows" />
        </div>
      )}
      <div
        className="device-stage"
        style={{ opacity: pageState === 'loading' ? 0 : 1 }}
      >
        <div className="device-stack">
          {pageState === 'error' && streamError && (
            <DeviceErrorOverlay
              streamError={streamError}
              onRetry={handleRetryWithReset}
            />
          )}
          <DeviceToolbar
            deviceInfo={deviceInfo}
            deviceSerial={deviceSerial}
            pageState={pageState as PageState}
            frameSize={frameSize}
            wsRef={wsRef}
            onScreenshot={handleScreenshot}
          />
          <DeviceScreen
            canvasRef={canvasRef}
            displaySize={displaySize}
            screenScale={screenScale}
            screenCornerRadius={screenCornerRadius}
            pageState={pageState as PageState}
            deviceInfo={deviceInfo}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseLeave}
          />
          {touchPos && (
            <TouchIndicator
              x={touchPos.x}
              y={touchPos.y}
              pressed={touchPos.pressed}
            />
          )}
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
