import React from 'react';
import { formatStreamError } from '../utils/error-formatter';

type DeviceErrorOverlayProps = {
  streamError: string;
  onRetry: () => void;
};

export function DeviceErrorOverlay({ streamError, onRetry }: DeviceErrorOverlayProps) {
  const error = formatStreamError(streamError);

  return (
    <div className="device-error-float" role="alert" aria-live="assertive">
      <span>{error.message}</span>
      <button
        type="button"
        className="device-error-retry"
        aria-label="Retry"
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}
