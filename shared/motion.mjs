export function presentationDuration(motion) {
  if (motion?.type === 'draw') return 360 + Math.min(4, Math.max(0, (motion.count || 1) - 1)) * 36;
  return (
    {
      move: 360,
      position: 240,
      attack: 520,
      summon: 360,
      chain: 520,
      resolve: 360,
      damage: 420,
      recover: 420,
      turn: 560,
      win: 450,
      rps: 1000,
    }[motion?.type] || 0
  );
}
