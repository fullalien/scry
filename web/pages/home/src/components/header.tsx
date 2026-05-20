import React from 'react';
import { Smartphone, RefreshCw } from 'lucide-react';

export function Header({
  deviceCount,
  refreshing,
  onRefresh,
}: {
  deviceCount: number;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <header className="mb-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-lg shadow-blue-500/20">
            <Smartphone size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Scry</h1>
            <p className="text-xs text-gray-500">
              Web Screen Mirror
              {deviceCount > 0 && (
                <span className="ml-1.5 inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                  {deviceCount} {deviceCount === 1 ? 'device' : 'devices'}
                </span>
              )}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 hover:shadow disabled:opacity-50"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <RefreshCw
            size={14}
            className={refreshing ? 'animate-spin' : ''}
          />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    </header>
  );
}
