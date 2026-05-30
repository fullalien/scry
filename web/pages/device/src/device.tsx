import React from 'react';
import { createRoot } from 'react-dom/client';
import { Sun, Moon, Monitor } from 'lucide-react';
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
import { useHostCssPxPerInch } from './hooks/useHostCssPxPerInch.js';
import { useDeviceInfo } from './hooks/useDeviceInfo.js';
import { useDeviceStream, type PageState } from './hooks/useDeviceStream.js';
import { useDeviceControl } from './hooks/useDeviceControl.js';
import { useTouchInput } from './hooks/useTouchInput.js';
import { useKeyboardInput } from './hooks/useKeyboardInput.js';
import { useClipboardSync } from './hooks/useClipboardSync.js';
import { useToast } from './hooks/useToast.js';
import { useTheme } from '../../../hooks/useTheme.js';
import { DeviceToolbar } from './components/DeviceToolbar.js';
import { DeviceScreen } from './components/DeviceScreen.js';
import { DeviceErrorOverlay } from './components/DeviceErrorOverlay.js';
import { TouchIndicator } from './components/TouchIndicator.js';
import { Spinner } from '../../../components/spinner.js';
import './device.css';
function DeviceApp() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const ctxRef = React.useRef<CanvasRenderingContext2D | null>(null);
  const { theme, toggleTheme } = useTheme();
  const hostCssPxPerInch = useHostCssPxPerInch();

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
  const { pageState, streamError, frameSize, fps, handleRetry } =
    useDeviceStream(deviceSerial, canvasRef, retryKey);

  const { controlWsRef, deviceMessageEvent } = useDeviceControl(
    deviceSerial,
    pageState,
    retryKey
  );

  const { toast, showToast } = useToast();
  useClipboardSync(controlWsRef, pageState, deviceMessageEvent, showToast);

  const {
    touchPos,
    secondaryTouchPos,
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleMouseLeave,
    handleContextMenu,
  } = useTouchInput(controlWsRef, canvasRef, frameSize);
  useKeyboardInput(controlWsRef, pageState);

  const handleRetryWithReset = React.useCallback(() => {
    handleRetry();
    setRetryKey(k => k + 1);
  }, [handleRetry]);

  const displaySize = React.useMemo<Size>(() => {
    const resolution = parseResolution(deviceInfo?.screenRes);
    const fallbackDensity = parseDensity(deviceInfo?.screenDensity);

    if (resolution && fallbackDensity) {
      const widthDensity = deviceInfo?.screenXDpi ?? fallbackDensity;
      const heightDensity = deviceInfo?.screenYDpi ?? fallbackDensity;
      const physical: Size = {
        width: toCssInchPixels(
          resolution.width,
          widthDensity,
          hostCssPxPerInch
        ),
        height: toCssInchPixels(
          resolution.height,
          heightDensity,
          hostCssPxPerInch
        ),
      };
      if (frameSize) {
        return alignOrientation(physical, frameSize);
      }
      return physical;
    }

    if (frameSize) {
      return {
        width: toCssInchPixels(
          frameSize.width,
          DEFAULT_FALLBACK_DPI,
          hostCssPxPerInch
        ),
        height: toCssInchPixels(
          frameSize.height,
          DEFAULT_FALLBACK_DPI,
          hostCssPxPerInch
        ),
      };
    }

    return { width: 360, height: 780 };
  }, [
    deviceInfo?.screenDensity,
    deviceInfo?.screenRes,
    deviceInfo?.screenXDpi,
    deviceInfo?.screenYDpi,
    frameSize,
    hostCssPxPerInch,
  ]);

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
  }, [displaySize.height, displaySize.width, viewport]);

  const screenCornerRadius = React.useMemo(() => {
    const density = parseDensity(deviceInfo?.screenDensity);
    if (deviceInfo?.screenCornerRadius && density) {
      return toCssInchPixels(
        deviceInfo.screenCornerRadius,
        density,
        hostCssPxPerInch
      );
    }
    return DEFAULT_SCREEN_RADIUS;
  }, [
    deviceInfo?.screenCornerRadius,
    deviceInfo?.screenDensity,
    hostCssPxPerInch,
  ]);

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
      <button
        type="button"
        className="theme-toggle-btn"
        aria-label={`Theme: ${theme}`}
        onClick={toggleTheme}
      >
        {theme === 'system' ? (
          <Monitor size={14} strokeWidth={2} />
        ) : theme === 'dark' ? (
          <Sun size={14} strokeWidth={2} />
        ) : (
          <Moon size={14} strokeWidth={2} />
        )}
      </button>
      {pageState === 'loading' && (
        <div className="device-loader" role="status" aria-live="polite">
          <Spinner name="waverows" />
        </div>
      )}
      <div
        className={`device-stage ${pageState === 'loading' ? 'device-stage-loading' : 'device-stage-ready'}`}
      >
        <div className="device-stack">
          {toast && (
            <div
              className={`app-toast app-toast-${toast.tone}`}
              role="status"
              aria-live="polite"
            >
              {toast.text}
            </div>
          )}
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
            fps={fps}
            wsRef={controlWsRef}
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
            onContextMenu={handleContextMenu}
          />
          {touchPos && (
            <TouchIndicator
              x={touchPos.x}
              y={touchPos.y}
              pressed={touchPos.pressed}
            />
          )}
          {secondaryTouchPos && (
            <TouchIndicator
              x={secondaryTouchPos.x}
              y={secondaryTouchPos.y}
              pressed={secondaryTouchPos.pressed}
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
