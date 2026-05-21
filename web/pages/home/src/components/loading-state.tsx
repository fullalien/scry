import React from 'react';
import { Spinner } from '../../../../components/spinner.js';

export function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 dark:border-white/[0.08] bg-white dark:bg-[#1e222a] py-16 shadow-sm">
      <div className="mb-3 text-2xl">
        <Spinner name="waverows" />
      </div>
      <p className="text-sm text-gray-500 dark:text-[#9ca3af]">Loading devices...</p>
    </div>
  );
}
