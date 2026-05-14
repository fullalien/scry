import React from "react";
import { createRoot } from "react-dom/client";

type HealthResponse = {
  ok: boolean;
  mode: "dev" | "prod";
};

type Session = {
  id: string;
  host: string;
  port: number;
  status: "running" | "stopped";
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
  status: "running" | "stopped" | "error";
  createdAt: number;
};

function App() {
  const [health, setHealth] = React.useState<HealthResponse | null>(null);
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [devices, setDevices] = React.useState<AdbDevice[]>([]);
  const [scrcpySessions, setScrcpySessions] = React.useState<ScrcpySession[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState<Record<string, boolean>>({});
  const [stopping, setStopping] = React.useState<Record<string, boolean>>({});

  async function loadAll() {
    try {
      const [healthRes, sessionsRes, devicesRes, scrcpyRes] = await Promise.all([
        fetch("/api/health"),
        fetch("/api/sessions"),
        fetch("/api/devices"),
        fetch("/api/scrcpy"),
      ]);

      if (!healthRes.ok || !sessionsRes.ok) {
        throw new Error("Failed to load server state");
      }

      const healthData = (await healthRes.json()) as HealthResponse;
      const sessionsData = (await sessionsRes.json()) as { sessions: Session[] };
      const devicesData = devicesRes.ok
        ? ((await devicesRes.json()) as { devices: AdbDevice[] })
        : { devices: [] };
      const scrcpyData = scrcpyRes.ok
        ? ((await scrcpyRes.json()) as { sessions: ScrcpySession[] })
        : { sessions: [] };

      setHealth(healthData);
      setSessions(sessionsData.sessions);
      setDevices(devicesData.devices);
      setScrcpySessions(scrcpyData.sessions);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Unknown error";
      setError(message);
    }
  }

  React.useEffect(() => {
    void loadAll();
  }, []);

  async function startScrcpy(deviceSerial: string) {
    setStarting((prev) => ({ ...prev, [deviceSerial]: true }));
    try {
      const res = await fetch("/api/scrcpy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceSerial }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "Failed to start scrcpy");
      } else {
        await loadAll();
      }
    } catch {
      setError("Failed to start scrcpy");
    } finally {
      setStarting((prev) => ({ ...prev, [deviceSerial]: false }));
    }
  }

  async function stopScrcpy(sessionId: string) {
    setStopping((prev) => ({ ...prev, [sessionId]: true }));
    try {
      const res = await fetch(`/api/scrcpy/${sessionId}/stop`, { method: "POST" });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) {
        setError(data.error ?? "Failed to stop scrcpy");
      } else {
        await loadAll();
      }
    } catch {
      setError("Failed to stop scrcpy");
    } finally {
      setStopping((prev) => ({ ...prev, [sessionId]: false }));
    }
  }

  function runningSessionForDevice(serial: string): ScrcpySession | undefined {
    return scrcpySessions.find(
      (s) => s.deviceSerial === serial && s.status === "running",
    );
  }

  return (
    <main style={{ fontFamily: "ui-sans-serif, system-ui", padding: 24 }}>
      <h1>scrcpy-web</h1>
      <p>Fastify + @fastify/vite is running.</p>
      {health ? <p>Server mode: {health.mode}</p> : <p>Loading health...</p>}
      {error ? (
        <p style={{ color: "#b91c1c" }}>
          Error: {error}{" "}
          <button onClick={() => setError(null)}>Dismiss</button>
        </p>
      ) : null}

      <section>
        <h2>
          Devices{" "}
          <button onClick={() => void loadAll()} style={{ fontSize: "0.8rem" }}>
            Refresh
          </button>
        </h2>
        {devices.length === 0 ? (
          <p>No ADB devices found.</p>
        ) : (
          <ul>
            {devices.map((device) => {
              const runningSession = runningSessionForDevice(device.id);
              return (
                <li key={device.id} style={{ marginBottom: 8 }}>
                  <strong>{device.id}</strong> ({device.state}){" "}
                  {runningSession ? (
                    <button
                      disabled={Boolean(stopping[runningSession.id])}
                      onClick={() => void stopScrcpy(runningSession.id)}
                    >
                      {stopping[runningSession.id] ? "Stopping…" : "Stop scrcpy"}
                    </button>
                  ) : (
                    device.state === "device" && (
                      <button
                        disabled={Boolean(starting[device.id])}
                        onClick={() => void startScrcpy(device.id)}
                      >
                        {starting[device.id] ? "Starting…" : "Start scrcpy"}
                      </button>
                    )
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2>scrcpy Sessions</h2>
        {scrcpySessions.length === 0 ? (
          <p>No scrcpy sessions.</p>
        ) : (
          <ul>
            {scrcpySessions.map((s) => (
              <li key={s.id}>
                {s.deviceSerial} — {s.status} (pid={s.pid}, id={s.id})
                {s.status === "running" && (
                  <>
                    {" "}
                    <button
                      disabled={Boolean(stopping[s.id])}
                      onClick={() => void stopScrcpy(s.id)}
                    >
                      {stopping[s.id] ? "Stopping…" : "Stop"}
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2>Server Sessions</h2>
        {sessions.length === 0 ? (
          <p>No active sessions.</p>
        ) : (
          <ul>
            {sessions.map((session) => (
              <li key={session.id}>
                {session.id} ({session.status}) at {session.host}:{session.port}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root");
}

createRoot(container).render(<App />);

