import { useCallback, useEffect, useRef, useState } from 'react';
import type { DuelState, Prompt, Motion, Settings } from '../types';
interface Snapshot {
  type: 'view' | 'frame';
  state: DuelState;
  prompt?: Prompt | null;
  viewer: number;
  motion?: Motion;
  duration?: number;
}
export function useDuelPlayback(speed: Settings['motion']) {
  const [visual, setVisual] = useState<{
    game: DuelState | null;
    prompt: Prompt | null;
    seat: number;
    motion: Motion | null;
    busy: boolean;
  }>({ game: null, prompt: null, seat: 0, motion: null, busy: false });
  const queue = useRef<Snapshot[]>([]),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    running = useRef(false),
    mode = useRef(speed);
  mode.current = speed;
  const advance = useCallback(() => {
    const next = queue.current.shift();
    if (!next) {
      running.current = false;
      return;
    }
    running.current = true;
    setVisual({
      game: next.state,
      prompt: next.type === 'view' ? next.prompt || null : null,
      seat: next.viewer,
      motion: next.motion || null,
      busy: next.type === 'frame',
    });
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const factor = mode.current === 'none' || reduce ? 0 : mode.current === 'quick' ? 0.5 : 1;
    const duration = Math.min(next.duration || 0, queue.current.length > 10 ? 70 : 500) * factor;
    timer.current = setTimeout(advance, duration);
  }, []);
  const receive = useCallback(
    (next: Snapshot) => {
      queue.current.push(next);
      if (!running.current) advance();
    },
    [advance],
  );
  const reset = useCallback(() => {
    clearTimeout(timer.current);
    running.current = false;
    queue.current = [];
    setVisual({ game: null, prompt: null, seat: 0, motion: null, busy: false });
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { ...visual, receive, reset };
}
