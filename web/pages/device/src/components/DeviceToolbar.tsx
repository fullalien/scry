import React from 'react';
import {
  encodeInjectKeycodeEvent,
  KeyAction,
} from '@shared/scrcpy';
import { AndroidKeyCode } from '@shared/scrcpy';
import backIcon from '../../../../assets/icon/sysbar_back.svg';
import homeIcon from '../../../../assets/icon/sysbar_home.svg';
import recentIcon from '../../../../assets/icon/sysbar_recent.svg';
import screenShotIcon from '../../../../assets/icon/ic_screenshot.svg';
import type { AdbDevice } from '../hooks/useDeviceInfo';
import type { Size } from '../utils/resolution';

type DeviceToolbarProps = {
  deviceInfo: AdbDevice | null;
  deviceSerial: string | null;
  pageState: 'loading' | 'streaming' | 'error';
  frameSize: Size | null;
  wsRef: React.RefObject<WebSocket | null>;
  onScreenshot: () => void;
};

export function DeviceToolbar({
  deviceInfo,
  deviceSerial,
  pageState,
  frameSize,
  wsRef,
  onScreenshot,
}: DeviceToolbarProps) {
  const title =
    pageState === 'loading' && deviceInfo === null
      ? 'Loading...'
      : deviceInfo?.brand && deviceInfo?.model
        ? `${deviceInfo.brand} ${deviceInfo.model}`
        : deviceInfo?.model || deviceSerial || 'Unknown device';

  const meta = [
    deviceInfo?.androidVersion ? `Android ${deviceInfo.androidVersion}` : null,
    frameSize
      ? `${frameSize.width}x${frameSize.height}`
      : deviceInfo?.screenRes || null,
    deviceInfo?.screenDensity ? `${deviceInfo.screenDensity} dpi` : null,
  ]
    .filter(Boolean)
    .join('  •  ');

  const sendNavigationKey = React.useCallback(
    (keycode: number) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      const downMsg = encodeInjectKeycodeEvent({ action: KeyAction.DOWN, keycode });
      const upMsg = encodeInjectKeycodeEvent({ action: KeyAction.UP, keycode });
      ws.send(downMsg.buffer as ArrayBuffer);
      ws.send(upMsg.buffer as ArrayBuffer);
    },
    []
  );

  return (
    <div className="device-toolbar" role="status" aria-live="polite">
      <div className="toolbar-left">
        <span className="toolbar-title">{title}</span>
        {meta && (
          <span className="toolbar-meta">{meta}</span>
        )}
      </div>
      <div className="toolbar-right">
        <button type="button" className="toolbar-btn" aria-label="Screenshot" onClick={onScreenshot}>
          <img src={screenShotIcon} alt="" />
        </button>
        <div className="toolbar-divider" />
        <div className="toolbar-nav">
          <button type="button" className="toolbar-btn" aria-label="Back" onClick={() => sendNavigationKey(AndroidKeyCode.BACK)}>
            <img src={backIcon} alt="" />
          </button>
          <button type="button" className="toolbar-btn" aria-label="Home" onClick={() => sendNavigationKey(AndroidKeyCode.HOME)}>
            <img src={homeIcon} alt="" />
          </button>
          <button
            type="button"
            className="toolbar-btn"
            aria-label="Recent apps"
            onClick={() => sendNavigationKey(AndroidKeyCode.APP_SWITCH)}
          >
            <img src={recentIcon} alt="" />
          </button>
        </div>
      </div>
    </div>
  );
}
