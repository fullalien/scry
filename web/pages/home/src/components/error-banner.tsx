import React from 'react';
import { AlertCircle, X } from 'lucide-react';
import './error-banner.css';

export function ErrorBanner({
  error,
  onDismiss,
}: {
  error: string | null;
  onDismiss: () => void;
}) {
  if (!error) return null;

  return (
    <div className="mb-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
      <AlertCircle size={16} className="shrink-0" />
      <span className="flex-1">{error}</span>
      <button
        type="button"
        className="text-red-400 transition-colors hover:text-red-600"
        onClick={onDismiss}
        aria-label="Dismiss error"
      >
        <X size={16} />
      </button>
    </div>
  );
}
