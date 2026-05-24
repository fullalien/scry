import React from 'react';
import { createRoot } from 'react-dom/client';
import { useAppData } from './hooks/use-app-data.js';
import { useTheme } from '../../../hooks/useTheme.js';
import { ErrorBanner } from './components/error-banner.js';
import { Header } from './components/header.js';
import { DeviceList } from './components/device-list.js';
import { EmptyState } from './components/empty-state.js';
import { LoadingState } from './components/loading-state.js';
import './home.css';

function App() {
  const { data, loading, error, refreshing, refresh, setError } = useAppData();
  const { theme, toggleTheme } = useTheme();

  const { devices, scrcpySessions, devicesOk } = data ?? {
    devices: [] as import('./types.js').AdbDevice[],
    scrcpySessions: [] as import('./types.js').ScrcpySession[],
    devicesOk: false,
  };

  return (
    <main className="min-h-screen bg-linear-to-br from-gray-50 to-gray-100 dark:from-[#1a1d23] dark:to-[#111419] p-6 font-sans">
      <div className="mx-auto max-w-2xl">
        <ErrorBanner error={error} onDismiss={() => setError(null)} />

        <Header
          deviceCount={devices.length}
          refreshing={refreshing}
          onRefresh={refresh}
          theme={theme}
          onToggleTheme={toggleTheme}
        />

        <section>
          {loading ? (
            <LoadingState />
          ) : devices.length === 0 ? (
            <EmptyState devicesOk={devicesOk} />
          ) : (
            <DeviceList
              devices={devices}
              scrcpySessions={scrcpySessions}
            />
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
