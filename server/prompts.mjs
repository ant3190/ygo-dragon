import { OcgMessageType as M, OcgResponseType as R, cardMatchesOpcode } from 'ocgcore-wasm';
import { coreCard } from './catalog.mjs';

export function fieldPlaces(mask, player) {
  const out = [];
  for (let relative = 0; relative < 2; relative++)
    for (const [location, base] of [
      [4, 0],
      [8, 8],
    ])
      for (let sequence = 0; sequence < (location === 4 ? 7 : 8); sequence++) {
        if (!((mask >>> (relative * 16 + base + sequence)) & 1))
          out.push({
            player: player ^ relative,
            controller: player ^ relative,
            location,
            sequence,
          });
      }
  return out;
}
export function sumValid(cards, target, greater = false) {
  let sums = new Set([0]);
  for (const card of cards) {
    const low = card.amount & 0xffff,
      high = card.amount >>> 16;
    sums = new Set(
      [...sums].flatMap((x) => (high && high !== low ? [x + low, x + high] : [x + low])),
    );
    if (sums.size > 20000) return false;
  }
  return [...sums].some((n) => (greater ? n >= target : n === target));
}

export function makePrompt(message, catalog, id) {
  const m = message,
    responses = new Map();
  const prompt = {
    id,
    player: m.player,
    kind: 'choice',
    title: '请选择',
    options: [],
    min: 1,
    max: 1,
    canCancel: false,
  };
  const add = (label, response, card = {}, extra = {}) => {
    const key = String(prompt.options.length);
    prompt.options.push({ id: key, label, ...card, ...extra });
    responses.set(key, response);
  };
  const cardLabel = (c) => catalog.get(c.code)?.name || `卡片 ${c.code}`;
  switch (m.type) {
    case M.SELECT_IDLECMD:
      prompt.kind = 'actions';
      prompt.title = '主要阶段 · 选择行动';
      for (const [field, label, action] of [
        ['summons', '通常召唤', 0],
        ['special_summons', '特殊召唤', 1],
        ['pos_changes', '改变表示', 2],
        ['monster_sets', '盖放怪兽', 3],
        ['spell_sets', '盖放', 4],
        ['activates', '发动效果', 5],
      ]) {
        m[field].forEach((c, index) =>
          add(label, { type: R.SELECT_IDLECMD, action, index }, c, {
            description: c.description ? catalog.description(c.description) : '',
            action,
          }),
        );
      }
      if (m.to_bp)
        add(
          '进入战斗阶段',
          { type: R.SELECT_IDLECMD, action: 6, index: null },
          {},
          { phase: 'battle' },
        );
      if (m.to_ep)
        add('结束回合', { type: R.SELECT_IDLECMD, action: 7, index: null }, {}, { phase: 'end' });
      break;
    case M.SELECT_BATTLECMD:
      prompt.kind = 'actions';
      prompt.title = '战斗阶段 · 选择行动';
      m.chains.forEach((c, index) =>
        add('发动效果', { type: R.SELECT_BATTLECMD, action: 0, index }, c, {
          description: catalog.description(c.description),
          action: 5,
        }),
      );
      m.attacks.forEach((c, index) =>
        add('攻击', { type: R.SELECT_BATTLECMD, action: 1, index }, c, { action: 10 }),
      );
      if (m.to_m2)
        add(
          '进入主要阶段 2',
          { type: R.SELECT_BATTLECMD, action: 2, index: null },
          {},
          { phase: 'main2' },
        );
      if (m.to_ep)
        add('结束回合', { type: R.SELECT_BATTLECMD, action: 3, index: null }, {}, { phase: 'end' });
      break;
    case M.SELECT_EFFECTYN:
    case M.SELECT_YESNO:
      prompt.kind = 'yesno';
      prompt.title = m.code ? `是否发动「${cardLabel(m)}」？` : catalog.description(m.description);
      add(
        '发动 / 是',
        { type: m.type === M.SELECT_EFFECTYN ? R.SELECT_EFFECTYN : R.SELECT_YESNO, yes: true },
        m.code ? { code: m.code } : {},
      );
      add('跳过 / 否', {
        type: m.type === M.SELECT_EFFECTYN ? R.SELECT_EFFECTYN : R.SELECT_YESNO,
        yes: false,
      });
      break;
    case M.SELECT_OPTION:
      prompt.title = '选择一个效果';
      m.options.forEach((value, index) =>
        add(catalog.description(value), { type: R.SELECT_OPTION, index }),
      );
      break;
    case M.SELECT_CHAIN:
      prompt.kind = 'chain';
      prompt.title = '是否连锁发动效果？';
      prompt.canCancel = !m.forced;
      prompt.specialCount = m.spe_count;
      m.selects.forEach((c, index) =>
        add('连锁发动', { type: R.SELECT_CHAIN, index }, c, {
          description: catalog.description(c.description),
        }),
      );
      break;
    case M.SELECT_CARD:
    case M.SELECT_TRIBUTE:
    case M.SELECT_SUM:
      Object.assign(prompt, {
        kind: m.type === M.SELECT_SUM ? 'sum' : 'cards',
        title:
          m.type === M.SELECT_TRIBUTE
            ? '选择解放的怪兽'
            : m.type === M.SELECT_SUM
              ? '选择满足条件的素材'
              : '选择卡片',
        min: m.min,
        max: m.max,
        canCancel: !!m.can_cancel,
      });
      prompt.amount = m.amount;
      prompt.greater = !!m.select_max;
      prompt.mandatory = m.selects_must || [];
      if (m.type === M.SELECT_SUM) {
        prompt.min = Math.max(0, m.min);
        prompt.max = m.max || m.selects.length;
      }
      if (m.type === M.SELECT_TRIBUTE) {
        prompt.tribute = true;
        prompt.min = 1;
        prompt.tributeMin = m.min;
      }
      m.selects.forEach((c, index) => add(cardLabel(c), index, c));
      break;
    case M.SELECT_UNSELECT_CARD:
      Object.assign(prompt, {
        kind: 'unselect',
        title: '选择召唤素材',
        canCancel: m.can_cancel,
        canFinish: m.can_finish,
        min: m.min,
        max: m.max,
      });
      m.select_cards.forEach((c, index) =>
        add(cardLabel(c), { type: R.SELECT_UNSELECT_CARD, index }, c, { selected: false }),
      );
      m.unselect_cards.forEach((c, index) =>
        add(
          cardLabel(c),
          { type: R.SELECT_UNSELECT_CARD, index: m.select_cards.length + index },
          c,
          { selected: true },
        ),
      );
      break;
    case M.SELECT_PLACE:
    case M.SELECT_DISFIELD:
      Object.assign(prompt, {
        kind: 'zones',
        title: m.type === M.SELECT_PLACE ? '选择放置区域' : '选择禁用区域',
        min: m.count,
        max: m.count,
      });
      fieldPlaces(m.field_mask, m.player).forEach((c) =>
        add(
          `${c.controller === m.player ? '我方' : '对方'}${c.location === 4 ? '怪兽' : '魔陷'}区 ${c.sequence + 1}`,
          c,
          c,
        ),
      );
      break;
    case M.SELECT_POSITION:
      prompt.title = '选择表示形式';
      for (const [position, label] of [
        [1, '表侧攻击表示'],
        [4, '表侧守备表示'],
        [8, '里侧守备表示'],
        [2, '里侧攻击表示'],
      ])
        if (m.positions & position)
          add(label, { type: R.SELECT_POSITION, position }, { code: m.code }, { position });
      break;
    case M.SORT_CARD:
    case M.SORT_CHAIN:
      prompt.kind = 'sort';
      prompt.title = '按顺序选择卡片';
      prompt.min = m.cards.length;
      prompt.max = m.cards.length;
      m.cards.forEach((c, index) => add(cardLabel(c), index, c));
      break;
    case M.SELECT_COUNTER:
      prompt.kind = 'counter';
      prompt.title = `移除 ${m.count} 个指示物`;
      prompt.amount = m.count;
      m.cards.forEach((c, index) => add(cardLabel(c), index, c, { capacity: c.count }));
      break;
    case M.ANNOUNCE_NUMBER:
      prompt.title = '宣言一个数值';
      m.options.forEach((v, index) => add(String(v), { type: R.ANNOUNCE_NUMBER, value: index }));
      break;
    case M.ROCK_PAPER_SCISSORS:
      prompt.title = '猜拳';
      ['石头', '剪刀', '布'].forEach((label, i) =>
        add(label, { type: R.ROCK_PAPER_SCISSORS, value: i + 1 }),
      );
      break;
    case M.ANNOUNCE_ATTRIB:
    case M.ANNOUNCE_RACE: {
      prompt.kind = 'attributes';
      prompt.title = m.type === M.ANNOUNCE_RACE ? '宣言种族' : '宣言属性';
      prompt.min = m.count;
      prompt.max = m.count;
      const available = BigInt(m.available);
      const labels =
        m.type === M.ANNOUNCE_ATTRIB
          ? ['地', '水', '炎', '风', '光', '暗', '神']
          : [
              '战士',
              '魔法师',
              '天使',
              '恶魔',
              '不死',
              '机械',
              '水',
              '炎',
              '岩石',
              '鸟兽',
              '植物',
              '昆虫',
              '雷',
              '龙',
              '兽',
              '兽战士',
              '恐龙',
              '鱼',
              '海龙',
              '爬虫类',
              '念动力',
              '幻神兽',
              '创造神',
              '幻龙',
              '电子界',
              '幻想魔',
            ];
      for (let bit = 0; bit < 64; bit++)
        if (available & (1n << BigInt(bit)))
          add(labels[bit] || `种族 ${bit + 1}`, 1n << BigInt(bit));
      break;
    }
    case M.ANNOUNCE_CARD:
      prompt.kind = 'announce';
      prompt.title = '宣言卡名';
      for (const card of catalog.cards.values())
        if (cardMatchesOpcode(coreCard(card), m.opcodes))
          add(card.name, { type: R.ANNOUNCE_CARD, card: card.id }, { code: card.id });
      break;
    default:
      return null;
  }
  const resolve = (input) => {
    if (!input || input.promptId !== id) throw new Error('操作已过期，请按当前提示操作');
    if (input.finish) {
      if (prompt.kind !== 'unselect' || !prompt.canFinish) throw new Error('当前素材尚未满足条件');
      return { type: R.SELECT_UNSELECT_CARD, index: null };
    }
    if (input.cancel) {
      if (!prompt.canCancel) throw new Error('当前操作不能取消');
      if (m.type === M.SELECT_CHAIN) return { type: R.SELECT_CHAIN, index: null };
      if (m.type === M.SELECT_UNSELECT_CARD) return { type: R.SELECT_UNSELECT_CARD, index: null };
      return { type: m.type === M.SELECT_CARD ? R.SELECT_CARD : R.SELECT_TRIBUTE, indicies: null };
    }
    const ids = Array.isArray(input.ids) ? input.ids : [];
    if (new Set(ids).size !== ids.length || !ids.every((key) => responses.has(key)))
      throw new Error('选项无效');
    if (['cards', 'sum', 'sort', 'zones', 'attributes'].includes(prompt.kind)) {
      if (ids.length < prompt.min || ids.length > prompt.max)
        throw new Error(`请选择 ${prompt.min}–${prompt.max} 项`);
      const values = ids.map((key) => responses.get(key));
      if (prompt.kind === 'cards') {
        if (m.type === M.SELECT_TRIBUTE) {
          const released = ids.reduce(
            (n, key) => n + (prompt.options[Number(key)].release_param || 1),
            0,
          );
          if (released < m.min) throw new Error('解放数量不足');
        }
        return {
          type: m.type === M.SELECT_TRIBUTE ? R.SELECT_TRIBUTE : R.SELECT_CARD,
          indicies: values,
        };
      }
      if (prompt.kind === 'sum') {
        if (
          !sumValid(
            [...prompt.mandatory, ...ids.map((key) => prompt.options[Number(key)])],
            m.amount,
            !!m.select_max,
          )
        )
          throw new Error('素材数值不满足条件');
        return {
          type: R.SELECT_SUM,
          indicies: [
            ...prompt.mandatory.map((_, i) => i),
            ...values.map((i) => i + prompt.mandatory.length),
          ],
        };
      }
      if (prompt.kind === 'sort')
        return { type: R.SORT_CARD, order: prompt.options.map((o) => ids.indexOf(o.id)) };
      if (prompt.kind === 'zones')
        return {
          type: m.type === M.SELECT_PLACE ? R.SELECT_PLACE : R.SELECT_DISFIELD,
          places: values.map(({ player, location, sequence }) => ({ player, location, sequence })),
        };
      if (prompt.kind === 'attributes')
        return m.type === M.ANNOUNCE_RACE
          ? { type: R.ANNOUNCE_RACE, races: values }
          : { type: R.ANNOUNCE_ATTRIB, attributes: values.map(Number) };
    }
    if (prompt.kind === 'counter') {
      const counts = input.counts;
      if (
        !Array.isArray(counts) ||
        counts.length !== prompt.options.length ||
        !counts.every((n, i) => Number.isInteger(n) && n >= 0 && n <= prompt.options[i].capacity) ||
        counts.reduce((a, b) => a + b, 0) !== m.count
      )
        throw new Error('指示物数量无效');
      return { type: R.SELECT_COUNTER, counters: counts };
    }
    if (ids.length !== 1) throw new Error('请选择一个选项');
    return responses.get(ids[0]);
  };
  return { prompt, resolve, message: m };
}
