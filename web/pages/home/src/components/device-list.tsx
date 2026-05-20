import React from 'react';
import { DeviceCard } from './device-card.js';
import type { AdbDevice, ScrcpySession } from '../types.js';

function runningSessionForDevice(
  serial: string,
  sessions: ScrcpySession[]
): ScrcpySession | undefined {
  return sessions.find(
    s => s.deviceSerial === serial && s.status === 'running'
  );
}

export function DeviceList({
  devices,
  scrcpySessions,
}: {
  devices: AdbDevice[];
  scrcpySessions: ScrcpySession[];
}) {
  const sortedDevices = React.useMemo(() => {
    return [...devices].sort((a, b) => {
      const aOnline = a.state === 'device' ? 0 : 1;
      const bOnline = b.state === 'device' ? 0 : 1;
      if (aOnline !== bOnline) return aOnline - bOnline;

      const aActive = runningSessionForDevice(a.id, scrcpySessions) ? 0 : 1;
      const bActive = runningSessionForDevice(b.id, scrcpySessions) ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;

      return 0;
    });
  }, [devices, scrcpySessions]);

  return (
    <ul className="space-y-3">
      {sortedDevices.map(device => {
        const session = runningSessionForDevice(device.id, scrcpySessions);
        return (
          <DeviceCard
            key={device.id}
            device={device}
            runningSession={session}
          />
        );
      })}
    </ul>
  );
}
