import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Engine } from './Engine';

export function useEngineState(engine: Engine) {
  return useSyncExternalStore(engine.subscribe, engine.getState);
}

/** Current playback position, refreshed every animation frame while playing. */
export function usePosition(engine: Engine, playing: boolean): number {
  const [pos, setPos] = useState(engine.position);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setPos(engine.position);
      if (playing) raf = requestAnimationFrame(loop);
    };
    loop();
    const off = engine.subscribe(() => setPos(engine.position));
    return () => {
      cancelAnimationFrame(raf);
      off();
    };
  }, [engine, playing]);
  return pos;
}
