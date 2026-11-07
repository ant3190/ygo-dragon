import type { FieldCard, Prompt } from '../types';

export interface Availability {
  tone: 'blue' | 'gold';
  label: string;
  description: string;
}

// MDPro3 uses gold for effects/special summons and blue for ordinary actions.
// Read the current legal prompt, never infer playability from card text or type.
export function cardAvailability(
  prompt: Prompt | null,
  card: Pick<FieldCard, 'controller' | 'location'> & Partial<FieldCard>,
  pile = false,
): Availability | undefined {
  if (!prompt || !['actions', 'chain'].includes(prompt.kind)) return;
  const actions = prompt.options.filter(
    (option) =>
      !option.phase &&
      option.controller === card.controller &&
      option.location === card.location &&
      (pile || option.sequence === card.sequence),
  );
  if (!actions.length) return;
  const effect = prompt.kind === 'chain' || actions.some((option) => option.action === 5);
  const special = actions.some((option) => option.action === 1);
  return {
    tone: effect || special ? 'gold' : 'blue',
    label: effect
      ? '可发动'
      : special
        ? '可特召'
        : actions.some((o) => o.action === 0)
          ? '可召唤'
          : actions.some((o) => o.action === 3 || o.action === 4)
            ? '可盖放'
            : actions.some((o) => o.action === 10)
              ? '可攻击'
              : '可变更',
    description: `可执行：${[...new Set(actions.map((o) => o.label))].join('、')}`,
  };
}
