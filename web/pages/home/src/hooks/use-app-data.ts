import React from 'react';
import { fetchAppData } from '../api.js';
import type { AppData } from '../types.js';

const POLL_INTERVAL = 15000;

function deepEqual(a: AppData | null, b: AppData | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  if (a.devicesOk !== b.devicesOk) return false;

  if (a.devices.length !== b.devices.length) return false;
  for (let i = 0; i < a.devices.length; i++) {
    const da = a.devices[i];
    const db = b.devices[i];
    if (
      da.id !== db.id ||
      da.state !== db.state ||
      da.model !== db.model ||
      da.brand !== db.brand ||
      da.manufacturer !== db.manufacturer ||
      da.device !== db.device ||
      da.androidVersion !== db.androidVersion ||
      da.apiLevel !== db.apiLevel ||
      da.screenRes !== db.screenRes ||
      da.screenDensity !== db.screenDensity ||
      da.screenXDpi !== db.screenXDpi ||
      da.screenYDpi !== db.screenYDpi ||
      da.screenCornerRadius !== db.screenCornerRadius
    ) {
      return false;
    }
  }

  if (a.scrcpySessions.length !== b.scrcpySessions.length) return false;
  for (let i = 0; i < a.scrcpySessions.length; i++) {
    const sa = a.scrcpySessions[i];
    const sb = b.scrcpySessions[i];
    if (
      sa.id !== sb.id ||
      sa.deviceSerial !== sb.deviceSerial ||
      sa.pid !== sb.pid ||
      sa.status !== sb.status ||
      sa.createdAt !== sb.createdAt ||
      sa.error !== sb.error ||
      sa.activeChannelCount !== sb.activeChannelCount
    ) {
      return false;
    }
  }

  return true;
}

export function useAppData(pollInterval: number = POLL_INTERVAL) {
  const [data, setData] = React.useState<AppData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [refreshing, setRefreshing] = React.useState(false);
  const initialLoadRef = React.useRef(true);
  const errorRef = React.useRef<string | null>(null);

  const loadData = React.useCallback(async (isRefresh = false) => {
    const isInitialLoad = initialLoadRef.current;
    if (isRefresh) {
      setRefreshing(true);
    } else if (isInitialLoad) {
      setLoading(true);
    }

    try {
      const newData = await fetchAppData();
      setData(prev => {
        if (deepEqual(prev, newData)) {
          return prev;
        }
        return newData;
      });
      if (errorRef.current !== null) {
        errorRef.current = null;
        setError(null);
      }
    } catch (loadError) {
      const message =
        loadError instanceof Error ? loadError.message : 'Unknown error';
      if (errorRef.current !== message) {
        errorRef.current = message;
        setError(message);
      }
    } finally {
      if (isInitialLoad) {
        setLoading(false);
        initialLoadRef.current = false;
      }
      if (isRefresh) {
        setRefreshing(false);
      }
    }
  }, []);

  React.useEffect(() => {
    void loadData(false);
  }, [loadData]);

  React.useEffect(() => {
    const timer = setInterval(() => {
      void loadData(false);
    }, pollInterval);
    return () => clearInterval(timer);
  }, [loadData, pollInterval]);

  const refresh = React.useCallback(() => {
    void loadData(true);
  }, [loadData]);

  const clearError = React.useCallback(() => {
    errorRef.current = null;
    setError(null);
  }, []);

  return { data, loading, error, refreshing, refresh, setError: clearError };
}
