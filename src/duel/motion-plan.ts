import type { Motion } from '../types';
export interface MotionBox {
  left: number;
  top: number;
  width: number;
  height: number;
  handPlayer?: number;
}
export interface CardFlight {
  uid: string;
  from: MotionBox;
  to: MotionBox;
  delay: number;
  arriving: boolean;
}
export const motionSpot = (card?: Motion['from']) =>
  card?.location
    ? `${card.controller}-${card.location}${[4, 8].includes(card.location) ? `-${card.sequence}` : ''}`
    : '';
// Only the event's cards move. Existing hand cards never shuffle as decoration.
export function planCardFlights(
  before: Map<string, MotionBox>,
  after: Map<string, MotionBox>,
  zones: Map<string, MotionBox>,
  motion: Motion | null,
): CardFlight[] {
  if (!motion || !['move', 'draw'].includes(motion.type)) return [];
  if (motion.type === 'draw') {
    const deck = zones.get(`${motion.player}-1`);
    if (!deck) return [];
    const result: CardFlight[] = [];
    for (const [uid, target] of after)
      if (target.handPlayer === motion.player && before.get(uid)?.handPlayer !== motion.player)
        result.push({
          uid,
          from: deck,
          to: target,
          delay: Math.min(4, result.length) * 36,
          arriving: true,
        });
    return result;
  }
  if (!motion.uid) return [];
  const source = before.get(motion.uid) || zones.get(motionSpot(motion.from));
  const target = after.get(motion.uid) || zones.get(motionSpot(motion.to));
  if (!source || !target || !source.width || !target.width) return [];
  if (
    Math.abs(source.left - target.left) + Math.abs(source.top - target.top) < 2 &&
    Math.abs(source.width - target.width) < 2
  )
    return [];
  return [{ uid: motion.uid, from: source, to: target, delay: 0, arriving: after.has(motion.uid) }];
}
