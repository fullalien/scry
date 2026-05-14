import React from "react";
import { createRoot } from "react-dom/client";

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
};

type AppData = {
  health: HealthResponse;
  sessions: Session[];
  devices: AdbDevice[];
  scrcpySessions: ScrcpySession[];
};

// H.264 MIME types in preference order (High → Main → Baseline profile)
const H264_MIME_TYPES = [
  'video/mp4; codecs="avc1.64001F"',
  'video/mp4; codecs="avc1.4D401F"',
  'video/mp4; codecs="avc1.42E01E"',
];

function VideoStream({ sessionId }: { sessionId: string }) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [streamError, setStreamError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (!("MediaSource" in window)) {
      setStreamError("MediaSource API not supported in this browser");
      return;
    }

    const mimeType = H264_MIME_TYPES.find((t) => MediaSource.isTypeSupported(t));
    if (!mimeType) {
      setStreamError("No supported H.264/fMP4 MIME type found");
      return;
    }

    const ms = new MediaSource();
    const objectUrl = URL.createObjectURL(ms);
    video.src = objectUrl;

    let ws: WebSocket | null = null;
    let sourceBuffer: SourceBuffer | null = null;
    const queue: ArrayBuffer[] = [];
    let streamEnded = false;
    let destroyed = false;

    function flushQueue() {
      if (sourceBuffer && !sourceBuffer.updating && queue.length > 0) {
        try {
          sourceBuffer.appendBuffer(queue.shift()!);
        } catch (err) {
          if (!destroyed) {
            setStreamError(err instanceof Error ? err.message : "Buffer append error");
          }
        }
      }
    }

    function maybeEndStream() {
      if (streamEnded && queue.length === 0 && ms.readyState === "open" && sourceBuffer && !sourceBuffer.updating) {
        ms.endOfStream();
      }
    }

    ms.addEventListener("sourceopen", () => {
      if (destroyed) return;
      try {
        sourceBuffer = ms.addSourceBuffer(mimeType);
        sourceBuffer.mode = "sequence";
      } catch (err) {
        setStreamError(err instanceof Error ? err.message : "Failed to open source buffer");
        return;
      }

      sourceBuffer.addEventListener("updateend", () => {
        maybeEndStream();
        flushQueue();
        if (video.paused && video.readyState >= 2) {
          void video.play().catch(() => {});
        }
      });

      const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${wsProto}//${location.host}/ws/stream/${sessionId}`);
      ws.binaryType = "arraybuffer";

      ws.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        queue.push(e.data);
        flushQueue();
      };

      ws.onerror = () => {
        if (!destroyed) setStreamError("WebSocket connection error");
      };

      ws.onclose = (e) => {
        streamEnded = true;
        maybeEndStream();
        if (!destroyed && e.code !== 1000 && e.code !== 1005) {
          setStreamError(`Stream closed: ${e.reason || `code ${e.code}`}`);
        }
      };
    });

    return () => {
      destroyed = true;
      ws?.close();
      URL.revokeObjectURL(objectUrl);
      video.src = "";
    };
  }, [sessionId]);

  return (
    <div style={{ marginTop: 8 }}>
      {streamError && (
        <p style={{ color: "#b91c1c", fontSize: "0.85rem", margin: "4px 0" }}>
          Stream error: {streamError}
        </p>
      )}
      <video
        ref={videoRef}
        style={{ width: "100%", maxWidth: 640, display: "block", background: "#000" }}
        controls
        muted
        autoPlay
        playsInline
      />
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
  const { devices } = devicesRes.ok
    ? ((await devicesRes.json()) as { devices: AdbDevice[] })
    : { devices: [] };
  const { sessions: scrcpySessions } = scrcpyRes.ok
    ? ((await scrcpyRes.json()) as { sessions: ScrcpySession[] })
    : { sessions: [] };

  return { health, sessions, devices, scrcpySessions };
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

  const { health, sessions, devices, scrcpySessions } = data ?? {
    health: null as HealthResponse | null,
    sessions: [] as Session[],
    devices: [] as AdbDevice[],
    scrcpySessions: [] as ScrcpySession[],
  };

  async function startScrcpy(deviceSerial: string) {
    setStarting((prev) => ({ ...prev, [deviceSerial]: true }));
    try {
      const res = await fetch("/api/scrcpy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceSerial, recordToStdout: true }),
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
          <p>No ADB devices found.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0 }}>
            {devices.map((device) => {
              const runningSession = runningSessionForDevice(device.id);
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
                    <VideoStream sessionId={runningSession.id} />
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

