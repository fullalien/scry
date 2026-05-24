import React from 'react';
import { Squircle } from '@squircle-js/react';
import { SCREEN_BORDER_WIDTH, DEFAULT_SCREEN_RADIUS } from '../constants';
import { toCssInchPixels, parseDensity, type Size } from '../utils/resolution';
import type { AdbDevice } from '../hooks/useDeviceInfo';
import type { PageState } from '../hooks/useDeviceStream';
import { Spinner } from '../../../../components/spinner';
import './DeviceScreen.css';

type DeviceScreenProps = {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  displaySize: Size;
  screenScale: number;
  screenCornerRadius: number;
  pageState: PageState;
  deviceInfo: AdbDevice | null;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseUp: (e: React.MouseEvent) => void;
  onMouseLeave: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
};

export function DeviceScreen({
  canvasRef,
  displaySize,
  screenScale,
  screenCornerRadius,
  pageState,
  onMouseMove,
  onMouseDown,
  onMouseUp,
  onMouseLeave,
  onContextMenu,
}: DeviceScreenProps) {
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const screenRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper) {
      wrapper.style.width = `${displaySize.width + SCREEN_BORDER_WIDTH * 2}px`;
      wrapper.style.height = `${(displaySize.height + SCREEN_BORDER_WIDTH * 2) * screenScale}px`;
      wrapper.style.transform = `scale(${screenScale})`;
    }

    const screen = screenRef.current;
    if (screen) {
      screen.style.width = `${displaySize.width}px`;
      screen.style.height = `${displaySize.height}px`;
    }
  }, [displaySize.height, displaySize.width, screenScale]);

  return (
    <div
      ref={wrapperRef}
      className="device-screen-wrapper"
      onMouseMove={onMouseMove}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseLeave}
      onContextMenu={onContextMenu}
    >
      <Squircle
        cornerRadius={
          screenCornerRadius > 0 ? screenCornerRadius + SCREEN_BORDER_WIDTH : 0
        }
        cornerSmoothing={0.8}
        style={{
          padding: `${SCREEN_BORDER_WIDTH}px`,
          background: 'var(--screen-border-color, black)',
        }}
      >
        <Squircle cornerRadius={screenCornerRadius} cornerSmoothing={0.8}>
          <div
            ref={screenRef}
            className="device-screen"
          >
            <canvas ref={canvasRef} className="device-canvas" />
            {pageState === 'loading' && (
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
  );
}
