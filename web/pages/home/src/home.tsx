import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  HEALTH_PATH,
  SESSIONS_PATH,
  DEVICES_PATH,
  SCRCPY_PATH,
  SCRCPY_STOP_PATH,
} from '../../../lib/shared/path.constants.js';
import './home.css';

type HealthResponse = {
  ok: boolean;
};

type Session = {
  id: string;
  host: string;
  port: number;
  status: 'running' | 'stopped';
  createdAt: number;
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
  sessions: Session[];
  devices: AdbDevice[];
  scrcpySessions: ScrcpySession[];
  devicesOk: boolean;
};

async function fetchAppData(): Promise<AppData> {
  const [healthRes, sessionsRes, devicesRes, scrcpyRes] = await Promise.all([
    fetch(HEALTH_PATH),
    fetch(SESSIONS_PATH),
    fetch(DEVICES_PATH),
    fetch(SCRCPY_PATH),
  ]);

  if (!healthRes.ok || !sessionsRes.ok) {
    throw new Error('Failed to load server state');
  }

  const health = (await healthRes.json()) as HealthResponse;
  const { sessions } = (await sessionsRes.json()) as { sessions: Session[] };
  const devicesOk = devicesRes.ok;
  const { devices } = devicesOk
    ? ((await devicesRes.json()) as { devices: AdbDevice[] })
    : { devices: [] };
  const { sessions: scrcpySessions } = scrcpyRes.ok
    ? ((await scrcpyRes.json()) as { sessions: ScrcpySession[] })
    : { sessions: [] };

  return { health, sessions, devices, scrcpySessions, devicesOk };
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

  const { health, sessions, devices, scrcpySessions, devicesOk } = data ?? {
    health: null as HealthResponse | null,
    sessions: [] as Session[],
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
    <main style={{ fontFamily: 'ui-sans-serif, system-ui', padding: 24 }}>
      <h1>scrcpy-web</h1>
      <p>Fastify + @fastify/vite is running.</p>
      {data ? <p>Server is running.</p> : <p>Loading…</p>}
      {error ? (
        <p style={{ color: '#b91c1c' }}>
          Error: {error} <button onClick={() => setError(null)}>Dismiss</button>
        </p>
      ) : null}

      <section>
        <h2>
          Devices{' '}
          <button onClick={() => void loadAll()} style={{ fontSize: '0.8rem' }}>
            Refresh
          </button>
        </h2>
        {devices.length === 0 ? (
          <p>
            {devicesOk
              ? 'No ADB devices connected.'
              : 'Failed to query ADB devices.'}
          </p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {devices.map(device => {
              const runningSession = runningSessionForDevice(device.id);
              return (
                <li key={device.id} style={{ marginBottom: 16 }}>
                  <div>
                    <strong>{device.id}</strong> ({device.state}){' '}
                    {runningSession ? (
                      <>
                        <button
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
                          style={{ marginLeft: 8 }}
                        >
                          Open Mirror
                        </a>
                      </>
                    ) : (
                      device.state === 'device' && (
                        <button
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
                      s => s.deviceSerial === device.id && s.status === 'error'
                    )
                    .map(s => (
                      <p
                        key={s.id}
                        style={{
                          color: '#b91c1c',
                          fontSize: '0.85rem',
                          margin: '4px 0',
                        }}
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
    </main>
  );
}

const container = document.getElementById('root');
if (!container) {
  throw new Error('Missing #root');
}

createRoot(container).render(<App />);
