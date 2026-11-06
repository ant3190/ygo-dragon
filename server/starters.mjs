// Original learning decks. No external assets or account is required.
export function makeStarters(catalog) {
  const normals = [...catalog.cards.values()].filter(
    (c) =>
      (c.type & 0x11) === 0x11 &&
      c.level <= 4 &&
      c.level >= 3 &&
      c.atk >= 1600 &&
      c.atk <= 2000 &&
      !c.alias &&
      !(c.type & (0x1000000 | 0x4000 | 0x4802040)),
  );
  const familiar = [
    11091375, 43096270, 20129614, 91152256, 69247929, 25109950, 42035044, 62279055, 15025844,
    11224103, 66788016, 41392891,
  ];
  normals.sort(
    (a, b) =>
      (familiar.includes(b.id) ? 1 : 0) - (familiar.includes(a.id) ? 1 : 0) ||
      b.atk - a.atk ||
      a.id - b.id,
  );
  const build = (id, name, boss, accent) => {
    const main = normals.slice(0, 11).flatMap((c) => [c.id, c.id, c.id]);
    if (catalog.get(boss)) main.push(boss, boss);
    for (const code of [83764718, 53129443, 5318639, 44095762, 97077563])
      if (catalog.get(code) && main.length < 40) main.push(code);
    while (main.length < 40 && normals.length)
      main.push(
        normals[11 + (main.length % Math.max(1, normals.length - 11))]?.id || normals[0].id,
      );
    return {
      id,
      name,
      main,
      extra: [],
      side: [],
      cover: boss,
      accent,
      description: '通常召唤、解放、魔法与战斗的基础练习卡组',
      updatedAt: Date.now(),
    };
  };
  return normals.length >= 12
    ? [
        build('starter-blue', '苍眼的觉醒', 89631139, 'jade'),
        build('starter-dark', '黑魔术的序章', 46986414, 'violet'),
      ]
    : [];
}
