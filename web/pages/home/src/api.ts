import { DEVICES_PATH, SCRCPY_PATH } from '@shared/constants';
import type { AppData } from './types.js';

export async function fetchAppData(): Promise<AppData> {
  const [devicesRes, scrcpyRes] = await Promise.all([
    fetch(DEVICES_PATH),
    fetch(SCRCPY_PATH),
  ]);

  const devicesOk = devicesRes.ok;
  const { devices } = devicesOk
    ? ((await devicesRes.json()) as { devices: AppData['devices'] })
    : { devices: [] };
  const { sessions: scrcpySessions } = scrcpyRes.ok
    ? ((await scrcpyRes.json()) as { sessions: AppData['scrcpySessions'] })
    : { sessions: [] };

  return { devices, scrcpySessions, devicesOk };
}
