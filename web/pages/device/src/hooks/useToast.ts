import { useCallback, useEffect, useRef, useState } from 'react';

export type ToastTone = 'info' | 'success' | 'error';

export type ToastMessage = {
  text: string;
  tone: ToastTone;
};

export function useToast(defaultDurationMs = 1800): {
  toast: ToastMessage | null;
  showToast: (text: string, tone: ToastTone, durationMs?: number) => void;
  clearToast: () => void;
} {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearToast = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setToast(null);
  }, []);

  const showToast = useCallback(
    (text: string, tone: ToastTone, durationMs = defaultDurationMs) => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setToast({ text, tone });
      timerRef.current = window.setTimeout(() => {
        setToast(null);
        timerRef.current = null;
      }, durationMs);
    },
    [defaultDurationMs]
  );

  useEffect(() => clearToast, [clearToast]);

  return { toast, showToast, clearToast };
}
