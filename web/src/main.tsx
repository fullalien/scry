import React from "react";
import { createRoot } from "react-dom/client";
import { ScrcpyH264Decoder, type DecoderStats } from "./codec/h264.js";

type HealthResponse = {
  ok: boolean;
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


function VideoCanvas({ sessionId }: { sessionId: string }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [streamError, setStreamError] = React.useState<string | null>(null);
  const [stats, setStats] = React.useState<DecoderStats>({
    packets: 0,
    invalidType: 0,
    ignoredNonVideo: 0,
    configs: 0,
    frames: 0,
    keyframes: 0,
    decoded: 0,
    waitingForKeyframe: true,
  });

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!("VideoDecoder" in window)) {
      setStreamError(
        "WebCodecs VideoDecoder not supported (Chrome 94+ / Firefox 130+ / Safari 16.4+ required)",
      );
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const decoder = new ScrcpyH264Decoder(
      (frame) => {
        // Resize canvas to match the decoded resolution
        if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
          canvas.width = frame.displayWidth;
          canvas.height = frame.displayHeight;
        }
        ctx.drawImage(frame, 0, 0);
        frame.close();
      },
      (err) => setStreamError(err.message),
      setStats,
    );

    const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${wsProto}//${location.host}/ws/stream/${sessionId}`);
    ws.binaryType = "arraybuffer";

    ws.onmessage = (e: MessageEvent<ArrayBuffer | string>) => {
      if (typeof e.data === "string") {
        return;
      }
      decoder.push(e.data);
    };

    ws.onerror = () => {
      console.log("[WS Client] Error");
      setStreamError("WebSocket connection error");
    };

    ws.onclose = (e) => {
      if (e.code !== 1000 && e.code !== 1005) {
        setStreamError(`Stream closed: ${e.reason || `code ${e.code}`}`);
      }
    };

    return () => {
      ws.close();
      decoder.close();
    };
  }, [sessionId]);

  return (
    <div style={{ marginTop: 8 }}>
      {streamError && (
        <p style={{ color: "#b91c1c", fontSize: "0.85rem", margin: "4px 0" }}>
          Stream error: {streamError}
        </p>
      )}
      <canvas
        ref={canvasRef}
        style={{ width: "100%", maxWidth: 640, display: "block", background: "#000" }}
      />
      <p style={{ color: "#475569", fontSize: "0.8rem", margin: "4px 0" }}>
        packets {stats.packets} · config {stats.configs} · frames {stats.frames} · keyframes{" "}
        {stats.keyframes} · decoded {stats.decoded} · waiting keyframe{" "}
        {stats.waitingForKeyframe ? "yes" : "no"}
        {stats.codec ? ` · ${stats.codec}` : ""}
      </p>
      <p style={{ color: "#64748b", fontSize: "0.75rem", margin: "4px 0" }}>
        invalid type {stats.invalidType} · last type{" "}
        {stats.lastType === undefined ? "-" : `0x${stats.lastType.toString(16).padStart(2, "0")}`} ·{" "}
        ignored non-video {stats.ignoredNonVideo} ·{" "}
        {stats.lastHeader ?? "-"}
      </p>
    </div>
  );
}

async function fetchAppData(): Promise<AppData> {
  const [healthRes, sessionsRes, devicesRes, scrcpyRes] = await Promise.all([
    fetch("/api/health"),
    fetch("/api/sessions"),
    fetch("/api/devices"),
    fetch("/api/scrcpy"),
  ]);

  if (!healthRes.ok || !sessionsRes.ok) {
    throw new Error("Failed to load server state");
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

// Cached outside the component so React StrictMode remounts don't cause a null flash.
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
      const message = loadError instanceof Error ? loadError.message : "Unknown error";
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
    setStarting((prev) => ({ ...prev, [deviceSerial]: true }));
    try {
      const res = await fetch("/api/scrcpy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceSerial }),
      });
      const result = (await res.json()) as { ok: boolean; error?: string };
      if (!result.ok) {
        setError(result.error ?? "Failed to start scrcpy");
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
      const result = (await res.json()) as { ok: boolean; error?: string };
      if (!result.ok) {
        setError(result.error ?? "Failed to stop scrcpy");
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

  function latestSessionForDevice(serial: string): ScrcpySession | undefined {
    return scrcpySessions.find((s) => s.deviceSerial === serial);
  }

  return (
    <main style={{ fontFamily: "ui-sans-serif, system-ui", padding: 24 }}>
      <h1>scrcpy-web</h1>
      <p>Fastify + @fastify/vite is running.</p>
      {data ? <p>Server is running.</p> : <p>Loading…</p>}
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
          <p>{devicesOk ? "No ADB devices connected." : "Failed to query ADB devices."}</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {devices.map((device) => {
              const runningSession = runningSessionForDevice(device.id);
              const latestSession = latestSessionForDevice(device.id);
              return (
                <li key={device.id} style={{ marginBottom: 16 }}>
                  <div>
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
                  </div>
                  {runningSession && (
                    <VideoCanvas sessionId={runningSession.id} />
                  )}
                  {latestSession && (
                    <p style={{ color: "#64748b", fontSize: "0.75rem", margin: "4px 0" }}>
                      session {latestSession.status} · server packets{" "}
                      {latestSession.stats?.packets ?? 0} · meta{" "}
                      {latestSession.stats?.sessionMeta ?? 0} · config{" "}
                      {latestSession.stats?.configs ?? 0} · keyframes{" "}
                      {latestSession.stats?.keyframes ?? 0} · nal{" "}
                      {latestSession.stats?.lastNalType ?? "-"} ·{" "}
                      {latestSession.stats?.lastHeader ?? "-"}
                    </p>
                  )}
                  {scrcpySessions
                    .filter((s) => s.deviceSerial === device.id && s.status === "error")
                    .map((s) => (
                      <p
                        key={s.id}
                        style={{ color: "#b91c1c", fontSize: "0.85rem", margin: "4px 0" }}
                      >
                        scrcpy error: {s.error ?? "unknown error"}
                      </p>
                    ))}
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
