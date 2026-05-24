import React from 'react';
import { Smartphone, RefreshCw, Sun, Moon, Monitor } from 'lucide-react';

export function Header({
  deviceCount,
  refreshing,
  onRefresh,
  theme,
  onToggleTheme,
}: {
  deviceCount: number;
  refreshing: boolean;
  onRefresh: () => void;
  theme: 'light' | 'dark' | 'system';
  onToggleTheme: () => void;
}) {
  const themeIcon =
    theme === 'system' ? (
      <Monitor size={14} />
    ) : theme === 'dark' ? (
      <Sun size={14} />
    ) : (
      <Moon size={14} />
    );
  const themeLabel =
    theme === 'system' ? 'System' : theme === 'dark' ? 'Dark' : 'Light';

  return (
    <header className="mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/20">
            <Smartphone size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-[#e8ecf1]">
              Scry
            </h1>
            <p className="text-xs text-gray-500 dark:text-[#9ca3af]">
              Web Screen Mirror
              {deviceCount > 0 && (
                <span className="ml-1.5 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-[#262a33] dark:text-[#9ca3af]">
                  {deviceCount} {deviceCount === 1 ? 'device' : 'devices'}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white p-2 text-gray-600 shadow-sm transition-all hover:bg-gray-50 hover:shadow disabled:opacity-50 dark:border-white/[0.08] dark:bg-[#1e222a] dark:text-[#d1d5db] dark:hover:bg-white/[0.08]"
            onClick={onRefresh}
            disabled={refreshing}
            aria-label="Refresh"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          </button>
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white p-2 text-gray-600 shadow-sm transition-all hover:bg-gray-50 hover:shadow disabled:opacity-50 dark:border-white/[0.08] dark:bg-[#1e222a] dark:text-[#d1d5db] dark:hover:bg-white/[0.08]"
            onClick={onToggleTheme}
            aria-label={`Theme: ${themeLabel}`}
          >
            {themeIcon}
          </button>
        </div>
      </div>
    </header>
  );
}
