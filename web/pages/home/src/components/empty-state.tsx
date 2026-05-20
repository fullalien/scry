import React from 'react';
import { Smartphone } from 'lucide-react';

export function EmptyState({ devicesOk }: { devicesOk: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-white py-16 shadow-sm">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-50">
        <Smartphone className="text-gray-300" size={32} />
      </div>
      <p className="mb-1 text-sm font-medium text-gray-700">
        {devicesOk ? 'No devices connected' : 'Unable to query devices'}
      </p>
      <p className="text-xs text-gray-500">
        {devicesOk
          ? 'Connect an ADB device to get started'
          : 'Check your ADB server and try again'}
      </p>
    </div>
  );
}
