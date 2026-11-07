// YGOPro/OCG protocol values: scissors=1, rock=2, paper=3.
export const rpsChoices = [
  { label: '石头', value: 2 },
  { label: '剪刀', value: 1 },
  { label: '布', value: 3 },
];
export function rpsOutcome(mine, opponent) {
  if (![1, 2, 3].includes(mine) || ![1, 2, 3].includes(opponent)) return null;
  if (mine === opponent) return 'draw';
  return (mine === 2 && opponent === 1) ||
    (mine === 1 && opponent === 3) ||
    (mine === 3 && opponent === 2)
    ? 'win'
    : 'lose';
}
