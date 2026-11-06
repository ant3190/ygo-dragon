export function parseYdk(text) {
  const deck = { main: [], extra: [], side: [] };
  let section = 'main';
  for (const line of String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())) {
    if (line === '#main') section = 'main';
    else if (line === '#extra') section = 'extra';
    else if (line === '!side') section = 'side';
    else if (/^\d{1,10}$/.test(line)) {
      const id = Number(line);
      if (id > 0 && id <= 0xffffffff) deck[section].push(id);
      else throw new Error('卡号超出范围');
    } else if (line && !line.startsWith('#') && !line.startsWith('!'))
      throw new Error(`无法识别的 YDK 行：${line.slice(0, 50)}`);
  }
  if (deck.main.length + deck.extra.length + deck.side.length > 90) throw new Error('卡组超过容量');
  return deck;
}
export function encodeYdk(deck) {
  return `#created by YGO Dragon\n#main\n${deck.main.join('\n')}\n#extra\n${deck.extra.join('\n')}\n!side\n${deck.side.join('\n')}\n`;
}
export function validateDeck(deck, getCard) {
  const errors = [];
  if (
    !deck ||
    !['main', 'extra', 'side'].every(
      (k) =>
        Array.isArray(deck[k]) &&
        deck[k].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 0xffffffff),
    )
  )
    return ['卡组格式无效'];
  if (deck.main.length < 40 || deck.main.length > 60) errors.push('主卡组需要 40–60 张');
  if (deck.extra.length > 15) errors.push('额外卡组最多 15 张');
  if (deck.side.length > 15) errors.push('副卡组最多 15 张');
  const counts = new Map();
  for (const section of ['main', 'extra', 'side'])
    for (const id of deck[section]) {
      const card = getCard?.(id);
      if (getCard && !card) {
        errors.push(`卡片 ${id} 不在本地卡库中`);
        continue;
      }
      const key = card?.alias || id;
      counts.set(key, (counts.get(key) || 0) + 1);
      const extra = !!(card?.type & 0x4802040);
      if (card && ((section === 'main' && extra) || (section === 'extra' && !extra)))
        errors.push(`${card.name}不属于${section === 'main' ? '主' : '额外'}卡组`);
      if (card?.type & 0x4000) errors.push('衍生物不能加入卡组');
    }
  for (const [id, count] of counts)
    if (count > 3) errors.push(`同名卡 ${getCard?.(id)?.name || id} 合计不能超过 3 张`);
  return [...new Set(errors)];
}
