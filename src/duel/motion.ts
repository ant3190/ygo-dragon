import { useLayoutEffect, useRef } from 'react';
import type { DuelState, Motion, Settings } from '../types';
type Box = { rect: DOMRect; node: HTMLElement };
export function useCardMotion(
  root: React.RefObject<HTMLElement | null>,
  state: DuelState,
  motion: Motion | null,
  speed: Settings['motion'],
) {
  const previous = useRef(new Map<string, Box>()),
    running = useRef<Animation[]>([]);
  useLayoutEffect(() => {
    const area = root.current;
    if (!area) return;
    const next = new Map<string, Box>();
    for (const node of area.querySelectorAll<HTMLElement>('[data-motion-key]'))
      next.set(node.dataset.motionKey!, { rect: node.getBoundingClientRect(), node });
    const reduce = speed === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const ms = (n: number) => (speed === 'quick' ? n * 0.5 : n);
    const animations: Animation[] = [];
    const source =
      motion?.type === 'draw'
        ? area.querySelector<HTMLElement>(`[data-zone-key="${motion.player}-1"]`)
        : motion?.from?.location
          ? area.querySelector<HTMLElement>(
              `[data-zone-key="${motion.from.controller}-${motion.from.location}-${motion.from.sequence}"]`,
            )
          : null;
    if (!reduce && motion && motion.type !== 'position') {
      for (const [key, box] of next) {
        const old = previous.current.get(key);
        let origin = old?.rect;
        if (
          !origin &&
          source &&
          ((motion.type === 'draw' && box.node.dataset.handPlayer === String(motion.player)) ||
            motion.uid === key)
        )
          origin = source.getBoundingClientRect();
        if (!origin || !box.rect.width || !origin.width) continue;
        const dx = origin.left - box.rect.left,
          dy = origin.top - box.rect.top,
          sx = origin.width / box.rect.width,
          sy = origin.height / box.rect.height;
        if (Math.abs(dx) + Math.abs(dy) < 2 && Math.abs(sx - 1) < 0.02) continue;
        animations.push(
          box.node.animate(
            [
              { transform: `translate(${dx}px,${dy}px) scale(${sx},${sy})` },
              { transform: 'translate(0,0) scale(1,1)' },
            ],
            {
              duration: ms(motion.type === 'draw' ? 230 : 240),
              easing: 'cubic-bezier(.2,.65,.25,1)',
              fill: 'none',
            },
          ),
        );
      }
      if (motion.type === 'move' && motion.uid && !next.has(motion.uid)) {
        const old = previous.current.get(motion.uid),
          to = motion.to;
        const target =
          to &&
          area.querySelector<HTMLElement>(`[data-zone-key="${to.controller}-${to.location}"]`);
        if (old && target) {
          const ghost = old.node.cloneNode(true) as HTMLElement,
            rect = target.getBoundingClientRect();
          ghost.removeAttribute('data-motion-key');
          Object.assign(ghost.style, {
            position: 'fixed',
            left: `${old.rect.left}px`,
            top: `${old.rect.top}px`,
            width: `${old.rect.width}px`,
            height: `${old.rect.height}px`,
            margin: '0',
            zIndex: '55',
            pointerEvents: 'none',
          });
          document.body.appendChild(ghost);
          const animation = ghost.animate(
            [
              { transform: 'translate(0,0)', opacity: 1 },
              {
                transform: `translate(${rect.left - old.rect.left}px,${rect.top - old.rect.top}px) scale(.8)`,
                opacity: 0,
              },
            ],
            { duration: ms(240), easing: 'ease-in', fill: 'forwards' },
          );
          animation.onfinish = () => ghost.remove();
          animation.oncancel = () => ghost.remove();
          animations.push(animation);
        }
      }
    }
    previous.current = next;
    running.current = animations;
  }, [state, motion, speed]);
  useLayoutEffect(
    () => () => {
      for (const a of running.current) a.cancel();
    },
    [],
  );
}
