import { useCallback, useState, useRef, RefObject, useEffect } from 'react';
import { encodeInjectTouchEvent, TouchAction } from '@shared/scrcpy';
import type { Size } from '../utils/resolution';

const POINTER_ID_PRIMARY = 0xffffffffffffffff;
const POINTER_ID_SECONDARY = 1;

type TouchPoint = {
  x: number;
  y: number;
  pressed: boolean;
};

export function useTouchInput(
  wsRef: RefObject<WebSocket | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  frameSize: Size | null
): {
  touchPos: { x: number; y: number; pressed: boolean } | null;
  secondaryTouchPos: { x: number; y: number; pressed: boolean } | null;
  handleMouseMove: (e: React.MouseEvent) => void;
  handleMouseDown: (e: React.MouseEvent) => void;
  handleMouseUp: (e: React.MouseEvent) => void;
  handleMouseLeave: () => void;
  handleContextMenu: (e: React.MouseEvent) => void;
} {
  const [touchPos, setTouchPos] = useState<TouchPoint | null>(null);
  const touchPosRef = useRef(touchPos);
  touchPosRef.current = touchPos;

  const [secondaryTouchPos, setSecondaryTouchPos] = useState<TouchPoint | null>(
    null
  );
  const secondaryTouchRef = useRef<TouchPoint | null>(null);

  const isMultiTouchRef = useRef(false);
  const isDraggingRef = useRef(false);
  const multiTouchCenterRef = useRef<{ x: number; y: number } | null>(null);

  const toDeviceCoords = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas || !frameSize) return null;

      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;

      const x = Math.round(
        ((clientX - rect.left) / rect.width) * frameSize.width
      );
      const y = Math.round(
        ((clientY - rect.top) / rect.height) * frameSize.height
      );

      return {
        x: Math.max(0, Math.min(x, frameSize.width - 1)),
        y: Math.max(0, Math.min(y, frameSize.height - 1)),
      };
    },
    [frameSize]
  );

  const sendTouchAction = useCallback(
    (
      action: number,
      clientX: number,
      clientY: number,
      pointerId: number = POINTER_ID_PRIMARY
    ) => {
      const ws = wsRef.current;
      const device = toDeviceCoords(clientX, clientY);
      if (!ws || !device || ws.readyState !== WebSocket.OPEN) return;

      const msg = encodeInjectTouchEvent({
        action,
        pointerId,
        x: device.x,
        y: device.y,
        screenWidth: frameSize!.width,
        screenHeight: frameSize!.height,
      });
      ws.send(
        msg.buffer.slice(
          msg.byteOffset,
          msg.byteOffset + msg.byteLength
        ) as ArrayBuffer
      );
    },
    [frameSize, toDeviceCoords]
  );

  const updateMultiTouchDisplay = useCallback(
    (mouseX: number, mouseY: number) => {
      const center = multiTouchCenterRef.current;
      if (!center) return;

      const offsetX = mouseX - center.x;
      const offsetY = mouseY - center.y;

      const primaryX = center.x - offsetX;
      const primaryY = center.y - offsetY;
      const secondaryX = center.x + offsetX;
      const secondaryY = center.y + offsetY;

      const isPressed = isDraggingRef.current;

      const primaryPoint = { x: primaryX, y: primaryY, pressed: isPressed };
      const secondaryPoint = {
        x: secondaryX,
        y: secondaryY,
        pressed: isPressed,
      };

      setTouchPos(primaryPoint);
      touchPosRef.current = primaryPoint;
      setSecondaryTouchPos(secondaryPoint);
      secondaryTouchRef.current = secondaryPoint;
    },
    []
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Meta' && !isMultiTouchRef.current) {
        isMultiTouchRef.current = true;
        const currentPos = touchPosRef.current;
        if (currentPos) {
          multiTouchCenterRef.current = { x: currentPos.x, y: currentPos.y };
          updateMultiTouchDisplay(currentPos.x, currentPos.y);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Meta' && isMultiTouchRef.current) {
        isMultiTouchRef.current = false;
        multiTouchCenterRef.current = null;
        if (!isDraggingRef.current) {
          setTouchPos(null);
          setSecondaryTouchPos(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [updateMultiTouchDisplay]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const mouseX = e.clientX;
      const mouseY = e.clientY;

      if (isMultiTouchRef.current) {
        updateMultiTouchDisplay(mouseX, mouseY);

        if (isDraggingRef.current) {
          const primary = touchPosRef.current;
          const secondary = secondaryTouchRef.current;
          if (primary) {
            sendTouchAction(TouchAction.MOVE, primary.x, primary.y);
          }
          if (secondary) {
            sendTouchAction(
              TouchAction.MOVE,
              secondary.x,
              secondary.y,
              POINTER_ID_SECONDARY
            );
          }
        }
        return;
      }

      setTouchPos(prev =>
        prev
          ? { ...prev, x: mouseX, y: mouseY }
          : { x: mouseX, y: mouseY, pressed: false }
      );

      if (touchPosRef.current?.pressed) {
        sendTouchAction(TouchAction.MOVE, mouseX, mouseY);
      }
    },
    [sendTouchAction, updateMultiTouchDisplay]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;

      if (isMultiTouchRef.current) {
        isDraggingRef.current = true;
        const primary = touchPosRef.current;
        const secondary = secondaryTouchRef.current;
        if (primary) {
          sendTouchAction(TouchAction.DOWN, primary.x, primary.y);
        }
        if (secondary) {
          sendTouchAction(
            TouchAction.DOWN,
            secondary.x,
            secondary.y,
            POINTER_ID_SECONDARY
          );
        }
        setTouchPos(prev => (prev ? { ...prev, pressed: true } : null));
        setSecondaryTouchPos(prev =>
          prev ? { ...prev, pressed: true } : null
        );
        return;
      }

      setTouchPos({ x: e.clientX, y: e.clientY, pressed: true });
      sendTouchAction(TouchAction.DOWN, e.clientX, e.clientY);
    },
    [sendTouchAction]
  );

  const handleMouseUp = useCallback(
    (_e: React.MouseEvent) => {
      if (isMultiTouchRef.current && isDraggingRef.current) {
        isDraggingRef.current = false;
        const primary = touchPosRef.current;
        const secondary = secondaryTouchRef.current;
        if (primary) {
          sendTouchAction(TouchAction.UP, primary.x, primary.y);
        }
        if (secondary) {
          sendTouchAction(
            TouchAction.UP,
            secondary.x,
            secondary.y,
            POINTER_ID_SECONDARY
          );
        }
        setTouchPos(prev => (prev ? { ...prev, pressed: false } : null));
        setSecondaryTouchPos(prev =>
          prev ? { ...prev, pressed: false } : null
        );
        return;
      }

      const pos = touchPosRef.current;
      setTouchPos(prev => (prev ? { ...prev, pressed: false } : null));
      if (pos) {
        sendTouchAction(TouchAction.UP, pos.x, pos.y);
      }
    },
    [sendTouchAction]
  );

  const handleMouseLeave = useCallback(() => {
    if (isMultiTouchRef.current) {
      if (secondaryTouchRef.current) {
        const sec = secondaryTouchRef.current;
        if (sec.pressed) {
          sendTouchAction(TouchAction.UP, sec.x, sec.y, POINTER_ID_SECONDARY);
        }
        secondaryTouchRef.current = null;
        setSecondaryTouchPos(null);
      }
      if (touchPosRef.current?.pressed) {
        sendTouchAction(TouchAction.UP, touchPosRef.current.x, touchPosRef.current.y);
      }
    } else if (touchPosRef.current?.pressed) {
      sendTouchAction(TouchAction.UP, touchPosRef.current.x, touchPosRef.current.y);
    }
    setTouchPos(null);
    isMultiTouchRef.current = false;
    isDraggingRef.current = false;
    multiTouchCenterRef.current = null;
  }, [sendTouchAction]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  return {
    touchPos,
    secondaryTouchPos,
    handleMouseMove,
    handleMouseDown,
    handleMouseUp,
    handleMouseLeave,
    handleContextMenu,
  };
}
