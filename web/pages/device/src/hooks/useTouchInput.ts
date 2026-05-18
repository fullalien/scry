import { useCallback, useState, useRef, RefObject } from 'react';
import { encodeInjectTouchEvent, TouchAction } from '@shared/scrcpy';
import type { Size } from '../utils/resolution';

export function useTouchInput(
  wsRef: RefObject<WebSocket | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  frameSize: Size | null
): {
  touchPos: { x: number; y: number; pressed: boolean } | null;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseUp: () => void;
  handleMouseLeave: () => void;
} {
  const [touchPos, setTouchPos] = useState<{ x: number; y: number; pressed: boolean } | null>(null);
  const touchPosRef = useRef(touchPos);
  touchPosRef.current = touchPos;

  const sendTouchAction = useCallback(
    (action: number, clientX: number, clientY: number) => {
      const ws = wsRef.current;
      const canvas = canvasRef.current;
      if (!ws || !canvas || !frameSize || ws.readyState !== WebSocket.OPEN) return;

      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const x = Math.round(((clientX - rect.left) / rect.width) * frameSize.width);
      const y = Math.round(((clientY - rect.top) / rect.height) * frameSize.height);

      const clampedX = Math.max(0, Math.min(x, frameSize.width - 1));
      const clampedY = Math.max(0, Math.min(y, frameSize.height - 1));

      const msg = encodeInjectTouchEvent({
        action,
        x: clampedX,
        y: clampedY,
      });
      ws.send(msg.buffer.slice(msg.byteOffset, msg.byteOffset + msg.byteLength) as ArrayBuffer);
    },
    [frameSize]
  );

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    setTouchPos(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : { x: e.clientX, y: e.clientY, pressed: false });
    if (touchPosRef.current?.pressed) {
      sendTouchAction(TouchAction.MOVE, e.clientX, e.clientY);
    }
  }, [sendTouchAction]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setTouchPos({ x: e.clientX, y: e.clientY, pressed: true });
    sendTouchAction(TouchAction.DOWN, e.clientX, e.clientY);
  }, [sendTouchAction]);

  const handleMouseUp = useCallback(() => {
    const pos = touchPosRef.current;
    setTouchPos(prev => prev ? { ...prev, pressed: false } : null);
    if (pos) {
      sendTouchAction(TouchAction.UP, pos.x, pos.y);
    }
  }, [sendTouchAction]);

  const handleMouseLeave = useCallback(() => {
    setTouchPos(null);
  }, []);

  return { touchPos, handleMouseMove, handleMouseDown, handleMouseUp, handleMouseLeave };
}
