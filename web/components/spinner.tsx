import React from 'react';
import spinners from 'unicode-animations';

export function Spinner({ name = 'waverows' }: { name?: keyof typeof spinners }) {
  const [frame, setFrame] = React.useState(0);
  const s = spinners[name];

  React.useEffect(() => {
    const timer = setInterval(
      () => setFrame(f => (f + 1) % s.frames.length),
      s.interval
    );
    return () => clearInterval(timer);
  }, [s.frames.length, s.interval]);

  return <>{s.frames[frame]}</>;
}
