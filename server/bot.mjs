import { sumValid } from './prompts.mjs';

/** A small deterministic practice opponent; all choices are validated by the OCG core. */
export function chooseBot(prompt, catalog, state) {
  const options = prompt.options,
    input = { promptId: prompt.id, ids: [] };
  if (prompt.kind === 'chain' && prompt.canCancel) return { ...input, cancel: true };
  if (prompt.kind === 'unselect' && prompt.canFinish) return { ...input, finish: true };
  if (prompt.kind === 'unselect' && prompt.canCancel) return { ...input, cancel: true };
  if (prompt.kind === 'actions') {
    const find = (predicate) => options.find(predicate);
    let choice = find((o) => o.action === 0) || find((o) => o.action === 1);
    // Avoid endlessly changing positions or activating the same optional effect.
    choice ||= find((o) => o.action === 10);
    choice ||= find((o) => o.action === 5 && catalog.get(o.code)?.type & 2);
    choice ||= find((o) => o.action === 4);
    choice ||=
      find((o) => o.phase === 'battle') ||
      find((o) => o.phase === 'main2') ||
      find((o) => o.phase === 'end');
    input.ids = [choice?.id || options[0]?.id];
    return input;
  }
  if (prompt.kind === 'yesno') {
    input.ids = [options[0].id];
    return input;
  }
  if (prompt.kind === 'counter') {
    let left = prompt.amount;
    input.counts = options.map((o) => {
      const n = Math.min(left, o.capacity);
      left -= n;
      return n;
    });
    return input;
  }
  if (prompt.tribute) {
    let released = 0;
    for (const option of [...options].sort(
      (a, b) => (b.release_param || 1) - (a.release_param || 1),
    )) {
      if (input.ids.length >= prompt.max) break;
      input.ids.push(option.id);
      released += option.release_param || 1;
      if (released >= (prompt.tributeMin ?? prompt.min) && input.ids.length >= prompt.min) break;
    }
    return input;
  }
  if (prompt.kind === 'sum') {
    // Bound the search for very large scripted selections.
    let visited = 0;
    const search = (i, chosen) => {
      if (++visited > 20000) return null;
      if (
        chosen.length >= prompt.min &&
        sumValid([...(prompt.mandatory || []), ...chosen], prompt.amount, prompt.greater)
      )
        return chosen.map((o) => o.id);
      if (chosen.length >= prompt.max || i === options.length) return null;
      return search(i + 1, [...chosen, options[i]]) || search(i + 1, chosen);
    };
    input.ids = search(0, []) || [];
    return input;
  }
  if (prompt.kind === 'sort') input.ids = options.map((o) => o.id);
  else input.ids = options.slice(0, Math.max(1, prompt.min)).map((o) => o.id);
  return input;
}
