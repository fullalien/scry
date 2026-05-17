import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  Monitor,
  Smartphone,
  RefreshCw,
  AlertCircle,
  X,
  Square,
  Hash,
  Cpu,
  Proportions,
} from 'lucide-react';
import {
  DEVICES_PATH,
  SCRCPY_PATH,
  SCRCPY_STOP_PATH,
} from '../../../lib/shared/path.constants.js';
import './home.css';

type AdbDevice = {
  id: string;
  state: string;
  model?: string;
  brand?: string;
  manufacturer?: string;
  device?: string;
  androidVersion?: string;
  apiLevel?: string;
  screenRes?: string;
  screenDensity?: string;
  screenCornerRadius?: number;
};

type ScrcpySession = {
  id: string;
  deviceSerial: string;
  pid: number;
  status: 'running' | 'stopped' | 'error';
  createdAt: number;
  error?: string;
  viewerCount: number;
  stats?: {
    packets: number;
    sessionMeta: number;
    configs: number;
    keyframes: number;
    lastHeader?: string;
    lastNalType?: number;
  };
};

type AppData = {
  devices: AdbDevice[];
  scrcpySessions: ScrcpySession[];
  devicesOk: boolean;
};

async function fetchAppData(): Promise<AppData> {
  const [devicesRes, scrcpyRes] = await Promise.all([
    fetch(DEVICES_PATH),
    fetch(SCRCPY_PATH),
  ]);

  const devicesOk = devicesRes.ok;
  const { devices } = devicesOk
    ? ((await devicesRes.json()) as { devices: AdbDevice[] })
    : { devices: [] };
  const { sessions: scrcpySessions } = scrcpyRes.ok
    ? ((await scrcpyRes.json()) as { sessions: ScrcpySession[] })
    : { sessions: [] };

  return { devices, scrcpySessions, devicesOk };
}

let dataCache: AppData | null = null;

function App() {
  const [data, setData] = React.useState<AppData | null>(dataCache);
  const [error, setError] = React.useState<string | null>(null);
  const [stopping, setStopping] = React.useState<Record<string, boolean>>({});

  const loadAll = React.useCallback(async () => {
    try {
      const newData = await fetchAppData();
      dataCache = newData;
      setData(newData);
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : 'Unknown error';
      setError(message);
    }
  }, []);

  React.useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const { devices, scrcpySessions, devicesOk } = data ?? {
    devices: [] as AdbDevice[],
    scrcpySessions: [] as ScrcpySession[],
    devicesOk: false,
  };

  async function stopScrcpy(sessionId: string) {
    setStopping(prev => ({ ...prev, [sessionId]: true }));
    try {
      const stopPath = SCRCPY_STOP_PATH.replace(':id', sessionId);
      const res = await fetch(stopPath, {
        method: 'POST',
      });
      const result = (await res.json()) as { ok: boolean; error?: string };
      if (!result.ok) {
        setError(result.error ?? 'Failed to stop scrcpy');
      } else {
        await loadAll();
      }
    } catch {
      setError('Failed to stop scrcpy');
    } finally {
      setStopping(prev => ({ ...prev, [sessionId]: false }));
    }
  }

  function runningSessionForDevice(serial: string): ScrcpySession | undefined {
    return scrcpySessions.find(
      s => s.deviceSerial === serial && s.status === 'running'
    );
  }

  return (
    <main className="min-h-screen bg-linear-to-br from-gray-50 to-gray-100 p-6 font-sans">
      <div className="mx-auto max-w-2xl">
        {error && (
          <div className="mb-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
            <AlertCircle size={16} className="shrink-0" />
            <span className="flex-1">{error}</span>
            <button
              type="button"
              className="text-red-400 hover:text-red-600 transition-colors"
              onClick={() => setError(null)}
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <section>
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">Devices</h2>
              {devices.length > 0 && (
                <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                  {devices.length}
                </span>
              )}
            </div>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow disabled:opacity-50"
              onClick={() => void loadAll()}
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>

          {devices.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white py-12 shadow-sm">
              <Smartphone className="mb-3 text-gray-300" size={40} />
              <p className="text-sm text-gray-500">
                {devicesOk
                  ? 'No ADB devices connected.'
                  : 'Failed to query ADB devices.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-3">
              {devices.map(device => {
                const runningSession = runningSessionForDevice(device.id);
                const isActive = Boolean(runningSession);
                const isOnline = device.state === 'device';
                return (
                  <li
                    key={device.id}
                    className={`group overflow-hidden rounded-xl border bg-white shadow-sm transition-all hover:shadow-md ${
                      isActive ? 'border-emerald-300' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {/* Active indicator bar */}
                    <div
                      className={`h-0.5 transition-all ${
                        isActive
                          ? 'bg-linear-to-r from-emerald-400 to-emerald-600'
                          : 'bg-transparent'
                      }`}
                    />

                    <div className="flex items-start gap-3 p-4">
                      {/* Device icon */}
                      <div
                        className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
                          isActive
                            ? 'bg-emerald-50 text-emerald-600'
                            : 'bg-gray-50 text-gray-400'
                        }`}
                      >
                        <Smartphone size={20} />
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        {/* Name + badges */}
                        <div className="flex flex-wrap items-center gap-1.5 mb-2">
                          <span className="font-semibold text-gray-900 text-sm leading-tight">
                            {device.brand && device.model
                              ? `${device.brand} ${device.model}`
                              : device.id}
                          </span>
                          {isActive && runningSession!.viewerCount > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                              Live
                            </span>
                          )}
                          {isActive && runningSession!.viewerCount === 0 && (
                            <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                              Running
                            </span>
                          )}
                          {!isOnline && (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200">
                              {device.state}
                            </span>
                          )}
                        </div>

                        {/* Info chips */}
                        <div className="flex flex-wrap gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-0.5 text-xs text-gray-500 ring-1 ring-gray-200 font-mono">
                            <Hash size={10} className="shrink-0" />
                            {device.id}
                          </span>
                          {device.androidVersion && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-0.5 text-xs text-green-700 ring-1 ring-green-200">
                              <Cpu size={10} className="shrink-0" />
                              Android {device.androidVersion}
                              {device.apiLevel ? ` · API ${device.apiLevel}` : ''}
                            </span>
                          )}
                          {((device.screenRes ?? device.screenDensity ?? device.screenCornerRadius)) && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs text-blue-700 ring-1 ring-blue-200">
                              <Proportions size={10} className="shrink-0" />
                              {[device.screenRes, device.screenDensity ? `${device.screenDensity} dpi` : '', device.screenCornerRadius ? `R${device.screenCornerRadius}` : ''].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="flex shrink-0 items-center gap-2">
                        {runningSession && (
                          <button
                            type="button"
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-600 shadow-sm transition-all hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={Boolean(stopping[runningSession.id])}
                            onClick={() => void stopScrcpy(runningSession.id)}
                          >
                            <Square size={14} />
                            {stopping[runningSession.id] ? 'Stopping…' : 'Stop'}
                          </button>
                        )}
                        {isOnline && (
                          <a
                            href={`/device/${device.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700"
                          >
                            <Monitor size={14} />
                            Open
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root');
}

createRoot(container).render(<App />);
