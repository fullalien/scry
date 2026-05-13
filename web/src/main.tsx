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

function App() {
  const [health, setHealth] = React.useState<HealthResponse | null>(null);
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    async function load() {
      try {
        const [healthRes, sessionsRes] = await Promise.all([
          fetch("/api/health"),
          fetch("/api/sessions"),
        ]);

        if (!healthRes.ok || !sessionsRes.ok) {
          throw new Error("Failed to load server state");
        }

        const healthData = (await healthRes.json()) as HealthResponse;
        const sessionsData = (await sessionsRes.json()) as { sessions: Session[] };
        setHealth(healthData);
        setSessions(sessionsData.sessions);
      } catch (loadError) {
        const message =
          loadError instanceof Error ? loadError.message : "Unknown error";
        setError(message);
      }
    }

    void load();
  }, []);

  return (
    <main style={{ fontFamily: "ui-sans-serif, system-ui", padding: 24 }}>
      <h1>scrcpy-web</h1>
      <p>Fastify + @fastify/vite is running.</p>
      {health ? <p>Server mode: {health.mode}</p> : <p>Loading health...</p>}
      {error ? <p style={{ color: "#b91c1c" }}>Error: {error}</p> : null}
      <section>
        <h2>Sessions</h2>
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
