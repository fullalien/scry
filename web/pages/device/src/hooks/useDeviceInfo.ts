import { useState, useEffect } from 'react';
import { DEVICES_PATH } from '@shared/constants';

export type AdbDevice = {
  id: string;
  state: string;
  model?: string;
  brand?: string;
  androidVersion?: string;
  screenRes?: string;
  screenDensity?: string;
  screenXDpi?: number;
  screenYDpi?: number;
  screenCornerRadius?: number;
};

export function useDeviceInfo(deviceSerial: string | null): AdbDevice | null {
  const [deviceInfo, setDeviceInfo] = useState<AdbDevice | null>(null);

  useEffect(() => {
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

  return deviceInfo;
}
