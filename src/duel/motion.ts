import { useLayoutEffect, useRef } from 'react';
import type { DuelState, Motion, Settings } from '../types';
import { planCardFlights, motionSpot, type MotionBox } from './motion-plan';
import { presentationDuration } from '../../shared/motion.mjs';
type Box = MotionBox & { node: HTMLElement };

export function useCardMotion(
  root: React.RefObject<HTMLElement | null>,
  state: DuelState,
  motion: Motion | null,
  speed: Settings['motion'],
) {
  const previous = useRef(new Map<string, Box>()),
    running = useRef<(() => void)[]>([]);
  useLayoutEffect(() => {
    const area = root.current;
    if (!area) return;
    for (const cleanup of running.current) cleanup();
    running.current = [];
    const next = new Map<string, Box>(),
      zones = new Map<string, MotionBox>();
    for (const node of area.querySelectorAll<HTMLElement>('[data-motion-key]')) {
      const rect = node.getBoundingClientRect();
      next.set(node.dataset.motionKey!, {
        node,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        handPlayer:
          node.dataset.handPlayer === undefined ? undefined : Number(node.dataset.handPlayer),
      });
    }
    for (const zone of area.querySelectorAll<HTMLElement>('[data-zone-key]')) {
      const rect = (zone.querySelector('.md-pile-card') || zone).getBoundingClientRect();
      zones.set(zone.dataset.zoneKey!, {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
    }
    const reduce = speed === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && motion) {
      const factor = speed === 'quick' ? 0.5 : 1;
      const register = (animation: Animation, cleanup: () => void) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          cleanup();
        };
        animation.onfinish = finish;
        animation.oncancel = finish;
        running.current.push(() => {
          animation.cancel();
          finish();
        });
      };
      for (const flight of planCardFlights(previous.current, next, zones, motion)) {
        const destination = flight.arriving ? next.get(flight.uid)?.node : undefined;
        const original = destination || previous.current.get(flight.uid)?.node;
        if (!original) continue;
        const ghost = original.cloneNode(true) as HTMLElement;
        ghost.removeAttribute('data-motion-key');
        ghost.removeAttribute('data-hand-player');
        ghost.classList.add('md-card-flight');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.querySelectorAll('.md-action-frame').forEach((node) => node.remove());
        Object.assign(ghost.style, {
          position: 'fixed',
          left: `${flight.to.left}px`,
          top: `${flight.to.top}px`,
          width: `${flight.to.width}px`,
          height: `${flight.to.height}px`,
          margin: '0',
          zIndex: '85',
          pointerEvents: 'none',
          transformOrigin: 'top left',
        });
        document.body.appendChild(ghost);
        destination?.classList.add('md-in-flight');
        const dx = flight.from.left - flight.to.left,
          dy = flight.from.top - flight.to.top;
        const animation = ghost.animate(
          [
            {
              transform: `translate(${dx}px,${dy}px) scale(${flight.from.width / flight.to.width},${flight.from.height / flight.to.height})`,
              opacity: 1,
            },
            { transform: 'translate(0,0) scale(1,1)', opacity: flight.arriving ? 1 : 0 },
          ],
          {
            duration: 360 * factor,
            delay: flight.delay * factor,
            easing: 'cubic-bezier(.22,.7,.28,1)',
            fill: 'both',
          },
        );
        register(animation, () => {
          ghost.remove();
          destination?.classList.remove('md-in-flight');
        });
      }
      const visible = (selector: string) =>
        Array.from(area.querySelectorAll<HTMLElement>(selector)).find(
          (node) => node.getBoundingClientRect().width > 0,
        );
      const card = motion.uid
        ? next.get(motion.uid)?.node
        : motion.from?.location
          ? area.querySelector<HTMLElement>(
              `[data-zone-key="${motionSpot(motion.from)}"] .md-motion-card`,
            )
          : undefined;
      const flash = (target: HTMLElement | null | undefined, kind: string) => {
        if (!target) return;
        const effect = document.createElement('span');
        effect.className = `md-event-effect ${kind}`;
        effect.setAttribute('aria-hidden', 'true');
        target.appendChild(effect);
        const animation = effect.animate(
          [
            { opacity: 0, transform: 'scale(.96)' },
            { opacity: 0.95, transform: 'scale(1.04)', offset: 0.22 },
            { opacity: 0, transform: 'scale(1.28)' },
          ],
          {
            duration: Math.max(240, presentationDuration(motion)) * factor,
            easing: 'ease-out',
            fill: 'both',
          },
        );
        register(animation, () => effect.remove());
      };
      if (motion.type === 'summon') flash(card, 'summon');
      if (motion.type === 'chain') flash(card, 'activation');
      if (motion.type === 'resolve') {
        const link = state.chain.find((item) => item.index === motion.index);
        if (link)
          for (const zone of [4, 8])
            for (const field of state.players[link.controller].zones[zone] || [])
              if (field?.code === link.code) flash(next.get(field.uid || '')?.node, 'resolve');
      }
      if (motion.type === 'attack' && motion.to?.location)
        flash(
          area.querySelector<HTMLElement>(
            `[data-zone-key="${motionSpot(motion.to)}"] .md-motion-card`,
          ),
          'hit',
        );
      if (['damage', 'recover'].includes(motion.type)) {
        const own = motion.player === Number(area.dataset.seat);
        const life = visible(`.md-player-life.${own ? 'own' : 'opponent'}`);
        flash(life, motion.type);
        if (life && motion.amount) {
          const rect = life.getBoundingClientRect(),
            number = document.createElement('span');
          number.className = `md-life-float ${motion.type}`;
          number.textContent = `${motion.type === 'recover' ? '+' : '−'}${motion.amount.toLocaleString()}`;
          Object.assign(number.style, {
            position: 'fixed',
            left: `${rect.left + rect.width / 2}px`,
            top: `${rect.top - 10}px`,
          });
          document.body.appendChild(number);
          register(
            number.animate(
              [
                { opacity: 0, transform: 'translate(-50%,5px)' },
                { opacity: 1, transform: 'translate(-50%,-10px)', offset: 0.25 },
                { opacity: 0, transform: 'translate(-50%,-32px)' },
              ],
              { duration: 420 * factor, fill: 'both' },
            ),
            () => number.remove(),
          );
        }
      }
    }
    previous.current = next;
  }, [state, motion, speed]);
  useLayoutEffect(
    () => () => {
      for (const cleanup of running.current) cleanup();
    },
    [],
  );
}
