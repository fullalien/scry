import React from 'react';
import { Monitor, Smartphone, Hash, Cpu, Proportions } from 'lucide-react';
import type { AdbDevice, ScrcpySession } from '../types.js';

export function DeviceCard({
  device,
  runningSession,
}: {
  device: AdbDevice;
  runningSession?: ScrcpySession;
}) {
  const isActive = Boolean(runningSession);
  const isOnline = device.state === 'device';

  return (
    <li
      className={`group overflow-hidden rounded-xl border bg-white shadow-sm transition-all duration-200 hover:shadow-md dark:bg-[#1e222a] ${
        isActive
          ? 'border-emerald-400 hover:border-emerald-500 dark:border-emerald-600 dark:hover:border-emerald-500'
          : 'border-gray-200 hover:border-gray-300 dark:border-white/8 dark:hover:border-white/12'
      }`}
    >
      <div className="flex items-start gap-3 p-4">
        <div
          className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${
            isActive
              ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400'
              : isOnline
                ? 'bg-blue-50 text-blue-500 dark:bg-blue-900/30 dark:text-blue-400'
                : 'bg-gray-50 text-gray-400 dark:bg-[#2a2e37] dark:text-gray-500'
          }`}
        >
          <Smartphone size={20} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className="text-sm leading-tight font-semibold text-gray-900 dark:text-[#e8ecf1]">
              {device.brand && device.model
                ? `${device.brand} ${device.model}`
                : device.id}
            </span>
            {isActive && runningSession!.activeChannelCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500 dark:bg-emerald-400" />
                Live
              </span>
            )}
            {isActive && runningSession!.activeChannelCount === 0 && (
              <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-700">
                Running
              </span>
            )}
            {!isOnline && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-700">
                {device.state}
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-gray-50 px-2 py-0.5 font-mono text-xs text-gray-500 ring-1 ring-gray-200 dark:bg-[#262a33] dark:text-[#9ca3af] dark:ring-white/8">
              <Hash size={10} className="shrink-0" />
              {device.id}
            </span>
            {device.androidVersion && (
              <span className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-0.5 text-xs text-green-700 ring-1 ring-green-200 dark:bg-green-900/30 dark:text-green-300 dark:ring-green-700">
                <Cpu size={10} className="shrink-0" />
                Android {device.androidVersion}
                {device.apiLevel ? ` · API ${device.apiLevel}` : ''}
              </span>
            )}
            {(device.screenRes ??
              device.screenDensity ??
              device.screenCornerRadius) && (
              <span className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-0.5 text-xs text-blue-700 ring-1 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-700">
                <Proportions size={10} className="shrink-0" />
                {[
                  device.screenRes,
                  device.screenDensity ? `${device.screenDensity} dpi` : '',
                  device.screenCornerRadius
                    ? `R${device.screenCornerRadius}`
                    : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {isOnline && (
            <a
              href={`/device/${device.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
            >
              <Monitor size={14} />
              Open
            </a>
          )}
        </div>
      </div>
    </li>
  );
}
