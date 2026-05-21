import './TouchIndicator.css';

type TouchIndicatorProps = {
  x: number;
  y: number;
  pressed: boolean;
};

export function TouchIndicator({ x, y, pressed }: TouchIndicatorProps) {
  return (
    <div
      className="touch-indicator"
      data-pressed={pressed || undefined}
      style={{
        left: x,
        top: y,
      }}
    />
  );
}
