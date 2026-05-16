import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  HEALTH_PATH,
  DEVICES_PATH,
  SCRCPY_PATH,
  SCRCPY_STOP_PATH,
} from '../../../lib/shared/path.constants.js';
import './home.css';

type HealthResponse = {
  ok: boolean;
};

type AdbDevice = {
  id: string;
  state: string;
};

type ScrcpySession = {
  id: string;
  deviceSerial: string;
  pid: number;
  status: 'running' | 'stopped' | 'error';
  createdAt: number;
  error?: string;
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
  health: HealthResponse;
  devices: AdbDevice[];
  scrcpySessions: ScrcpySession[];
  devicesOk: boolean;
};

async function fetchAppData(): Promise<AppData> {
  const [healthRes, devicesRes, scrcpyRes] = await Promise.all([
    fetch(HEALTH_PATH),
    fetch(DEVICES_PATH),
    fetch(SCRCPY_PATH),
  ]);

  if (!healthRes.ok) {
    throw new Error('Failed to load server state');
  }

  const health = (await healthRes.json()) as HealthResponse;
  const devicesOk = devicesRes.ok;
  const { devices } = devicesOk
    ? ((await devicesRes.json()) as { devices: AdbDevice[] })
    : { devices: [] };
  const { sessions: scrcpySessions } = scrcpyRes.ok
    ? ((await scrcpyRes.json()) as { sessions: ScrcpySession[] })
    : { sessions: [] };

  return { health, devices, scrcpySessions, devicesOk };
}

let dataCache: AppData | null = null;

function App() {
  const [data, setData] = React.useState<AppData | null>(dataCache);
  const [error, setError] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState<Record<string, boolean>>({});
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

  const { health, devices, scrcpySessions, devicesOk } = data ?? {
    health: null as HealthResponse | null,
    devices: [] as AdbDevice[],
    scrcpySessions: [] as ScrcpySession[],
    devicesOk: false,
  };

  async function startScrcpy(deviceSerial: string) {
    setStarting(prev => ({ ...prev, [deviceSerial]: true }));
    try {
      const res = await fetch(SCRCPY_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceSerial }),
      });
      const result = (await res.json()) as { ok: boolean; error?: string };
      if (!result.ok) {
        setError(result.error ?? 'Failed to start scrcpy');
      } else {
        await loadAll();
      }
    } catch {
      setError('Failed to start scrcpy');
    } finally {
      setStarting(prev => ({ ...prev, [deviceSerial]: false }));
    }
  }

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
    <main className="min-h-screen bg-gray-50 p-6 font-sans">
      <div className="mx-auto max-w-2xl">
        <header className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">scrcpy-web</h1>
          <p className="mt-1 text-sm text-gray-500">
            Fastify + @fastify/vite is running.
          </p>
          {data ? (
            <p className="mt-1 text-sm text-green-600">Server is running.</p>
          ) : (
            <p className="mt-1 text-sm text-gray-400">Loading…</p>
          )}
          {error ? (
            <div className="mt-3 flex items-center gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              <span>Error: {error}</span>
              <button
                type="button"
                className="ml-auto text-red-500 hover:text-red-700"
                onClick={() => setError(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}
        </header>

        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Devices</h2>
            <button
              type="button"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              onClick={() => void loadAll()}
            >
              Refresh
            </button>
          </div>

          {devices.length === 0 ? (
            <p className="text-sm text-gray-500">
              {devicesOk
                ? 'No ADB devices connected.'
                : 'Failed to query ADB devices.'}
            </p>
          ) : (
            <ul className="space-y-3">
              {devices.map(device => {
                const runningSession = runningSessionForDevice(device.id);
                return (
                  <li
                    key={device.id}
                    className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900">
                          {device.id}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                            device.state === 'device'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-yellow-100 text-yellow-700'
                          }`}
                        >
                          {device.state}
                        </span>
                      </div>

                      {runningSession ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={Boolean(stopping[runningSession.id])}
                            onClick={() => void stopScrcpy(runningSession.id)}
                          >
                            {stopping[runningSession.id]
                              ? 'Stopping…'
                              : 'Stop scrcpy'}
                          </button>
                          <a
                            href={`/mirror/${device.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
                          >
                            Open Mirror
                          </a>
                        </div>
                      ) : (
                        device.state === 'device' && (
                          <button
                            type="button"
                            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={Boolean(starting[device.id])}
                            onClick={() => void startScrcpy(device.id)}
                          >
                            {starting[device.id] ? 'Starting…' : 'Start scrcpy'}
                          </button>
                        )
                      )}
                    </div>

                    {scrcpySessions
                      .filter(
                        s =>
                          s.deviceSerial === device.id && s.status === 'error'
                      )
                      .map(s => (
                        <p
                          key={s.id}
                          className="mt-2 text-sm text-red-600"
                        >
                          scrcpy error: {s.error ?? 'unknown error'}
                        </p>
                      ))}
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
