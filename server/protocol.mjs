// YGOPro 0x1332 wire format. Referenced against MDPro3 and SRVPro (see docs/interaction.md).
import { OcgMessageType as M, OcgResponseType as R } from 'ocgcore-wasm';
export class Reader {
  constructor(data) {
    this.data = Buffer.from(data);
    this.offset = 0;
  }
  get remaining() {
    return this.data.length - this.offset;
  }
  u8() {
    this.check(1);
    return this.data[this.offset++];
  }
  u16() {
    this.check(2);
    const n = this.data.readUInt16LE(this.offset);
    this.offset += 2;
    return n;
  }
  u32() {
    this.check(4);
    const n = this.data.readUInt32LE(this.offset);
    this.offset += 4;
    return n;
  }
  i32() {
    return this.u32() | 0;
  }
  check(n) {
    if (n > this.remaining) throw new Error('服务器数据包不完整');
  }
  loc(position = true) {
    const c = { controller: this.u8(), location: this.u8(), sequence: this.u8() };
    if (position) c.position = this.u8();
    return c;
  }
  card(position = true) {
    return { code: (this.u32() & 0x7fffffff) % 1000000000, ...this.loc(position) };
  }
  list(read) {
    const n = this.u8();
    return Array.from({ length: n }, () => read());
  }
}
export function packet(type, data = Buffer.alloc(0)) {
  const out = Buffer.alloc(data.length + 3);
  out.writeUInt16LE(data.length + 1);
  out[2] = type;
  data.copy(out, 3);
  return out;
}
export function utf16(text, length) {
  const b = Buffer.alloc(length || (text.length + 1) * 2);
  b.write(String(text).slice(0, length ? length / 2 - 1 : undefined), 0, 'utf16le');
  return b;
}
export function joinPacket(name, password, version = 4962) {
  const data = Buffer.alloc(48);
  data.writeUInt16LE(version);
  utf16(password, 40).copy(data, 8);
  return [packet(16, utf16(name, 40)), packet(18, data)];
}
export function deckPacket(deck) {
  const cards = [...deck.main, ...deck.extra, ...deck.side],
    data = Buffer.alloc(8 + cards.length * 4);
  data.writeUInt32LE(deck.main.length + deck.extra.length);
  data.writeUInt32LE(deck.side.length, 4);
  cards.forEach((id, i) => data.writeUInt32LE(id, 8 + i * 4));
  return packet(2, data);
}
export class PacketStream {
  buffer = Buffer.alloc(0);
  read(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    if (this.buffer.length > 1024 * 1024) throw new Error('服务器数据超出上限');
    const out = [];
    while (this.buffer.length >= 3) {
      const n = this.buffer.readUInt16LE();
      if (n < 1) throw new Error('服务器帧长度无效');
      if (this.buffer.length < n + 2) break;
      out.push({ type: this.buffer[2], data: this.buffer.subarray(3, n + 2) });
      this.buffer = this.buffer.subarray(n + 2);
    }
    return out;
  }
}
export function readGame(data) {
  const r = new Reader(data),
    type = r.u8(),
    m = { type };
  const player = () => (m.player = r.u8()),
    card = () => r.card(),
    short = () => r.card(false),
    u32 = () => r.u32();
  switch (type) {
    case M.RETRY:
    case M.WAITING:
    case M.SUMMONED:
    case M.SPSUMMONED:
    case M.FLIPSUMMONED:
    case M.CHAIN_END:
      return m;
    case M.START:
      m.playerType = r.u8();
      if (r.remaining > 16) m.rule = r.u8();
      m.lp = [r.u32(), r.u32()];
      m.sizes = [
        { deck: r.u16(), extra: r.u16() },
        { deck: r.u16(), extra: r.u16() },
      ];
      return m;
    case M.HINT:
      m.hint_type = r.u8();
      player();
      m.value = r.u32();
      return m;
    case M.WIN:
      player();
      m.reason = r.u8();
      return m;
    case M.UPDATE_DATA:
      player();
      m.location = r.u8();
      m.cards = [];
      while (r.remaining) {
        const length = r.u32();
        if (length < 4 || length - 4 > r.remaining) throw new Error('卡片更新包长度无效');
        m.cards.push(
          length === 4 ? null : readQuery(r.data.subarray(r.offset, r.offset + length - 4)),
        );
        r.offset += length - 4;
      }
      return m;
    case M.UPDATE_CARD:
      player();
      m.location = r.u8();
      m.sequence = r.u8();
      {
        const length = r.u32();
        m.card = length > 4 ? readQuery(r.data.subarray(r.offset, r.offset + length - 4)) : null;
      }
      return m;
    case M.SELECT_IDLECMD:
      player();
      for (const key of ['summons', 'special_summons', 'pos_changes', 'monster_sets', 'spell_sets'])
        m[key] = r.list(short);
      m.activates = r.list(() => ({ ...short(), description: r.u32() }));
      m.to_bp = !!r.u8();
      m.to_ep = !!r.u8();
      m.shuffle = !!r.u8();
      return m;
    case M.SELECT_BATTLECMD:
      player();
      m.chains = r.list(() => ({ ...short(), description: r.u32() }));
      m.attacks = r.list(() => ({ ...short(), can_direct: !!r.u8() }));
      m.to_m2 = !!r.u8();
      m.to_ep = !!r.u8();
      return m;
    case M.SELECT_EFFECTYN:
      player();
      Object.assign(m, card(), { description: r.u32() });
      return m;
    case M.SELECT_YESNO:
      player();
      m.description = r.u32();
      return m;
    case M.SELECT_OPTION:
    case M.ANNOUNCE_NUMBER:
      player();
      m.options = r.list(u32);
      return m;
    case M.SELECT_CARD:
      player();
      m.can_cancel = !!r.u8();
      m.min = r.u8();
      m.max = r.u8();
      m.selects = r.list(card);
      return m;
    case M.SELECT_TRIBUTE:
      player();
      m.can_cancel = !!r.u8();
      m.min = r.u8();
      m.max = r.u8();
      m.selects = r.list(() => ({ ...short(), release_param: r.u8() }));
      return m;
    case M.SELECT_UNSELECT_CARD:
      player();
      m.can_finish = !!r.u8();
      m.can_cancel = !!r.u8();
      m.min = r.u8();
      m.max = r.u8();
      m.select_cards = r.list(card);
      m.unselect_cards = r.list(card);
      return m;
    case M.SELECT_CHAIN: {
      player();
      const count = r.u8();
      m.spe_count = r.u8();
      m.hint_timing = r.u32();
      m.hint_timing_other = r.u32();
      m.selects = Array.from({ length: count }, () => {
        const client_mode = r.u8(),
          forced = r.u8();
        return { ...card(), client_mode, forced, description: r.u32() };
      });
      m.forced = m.selects.some((c) => c.forced);
      return m;
    }
    case M.SELECT_PLACE:
    case M.SELECT_DISFIELD:
      player();
      m.count = r.u8();
      m.field_mask = r.u32();
      return m;
    case M.SELECT_POSITION:
      player();
      m.code = r.u32();
      m.positions = r.u8();
      return m;
    case M.SELECT_SUM:
      m.select_max = r.u8();
      player();
      m.amount = r.u32();
      m.min = r.u8();
      m.max = r.u8();
      m.selects_must = r.list(() => ({ ...short(), amount: r.u32() }));
      m.selects = r.list(() => ({ ...short(), amount: r.u32() }));
      return m;
    case M.SELECT_COUNTER:
      player();
      m.counter_type = r.u16();
      m.count = r.u16();
      m.cards = r.list(() => ({ ...short(), count: r.u16() }));
      return m;
    case M.SORT_CARD:
    case M.SORT_CHAIN:
      player();
      m.cards = r.list(short);
      return m;
    case M.ANNOUNCE_RACE:
    case M.ANNOUNCE_ATTRIB:
      player();
      m.count = r.u8();
      m.available = r.u32();
      return m;
    case M.ANNOUNCE_CARD:
      player();
      m.opcodes = r.list(u32).map((n) => (n >= 0x40000000 ? BigInt(n) << 32n : BigInt(n)));
      return m;
    case M.NEW_TURN:
      player();
      return m;
    case M.NEW_PHASE:
      m.phase = r.u16();
      return m;
    case M.MOVE:
      m.card = r.u32();
      m.from = r.loc();
      m.to = r.loc();
      m.reason = r.u32();
      return m;
    case M.POS_CHANGE:
      m.code = r.u32();
      Object.assign(m, r.loc(false));
      m.prev_position = r.u8();
      m.position = r.u8();
      return m;
    case M.SET:
    case M.SUMMONING:
    case M.SPSUMMONING:
    case M.FLIPSUMMONING:
      Object.assign(m, card());
      return m;
    case M.SWAP:
      m.card1 = card();
      m.card2 = card();
      return m;
    case M.DRAW:
      player();
      m.drawn = r.list(() => ({ code: r.u32() & 0x7fffffff, position: 1 }));
      return m;
    case M.DAMAGE:
    case M.RECOVER:
    case M.LPUPDATE:
    case M.PAY_LPCOST:
      player();
      m.amount = r.u32();
      return m;
    case M.SHUFFLE_HAND:
    case M.SHUFFLE_EXTRA:
      player();
      m.codes = r.list(u32);
      return m;
    case M.SHUFFLE_DECK:
    case M.REFRESH_DECK:
    case M.SWAP_GRAVE_DECK:
      player();
      return m;
    case M.SHUFFLE_SET_CARD: {
      m.location = r.u8();
      const count = r.u8(),
        from = Array.from({ length: count }, () => r.loc());
      m.cards = from.map((location) => ({ from: location, to: r.loc() }));
      return m;
    }
    case M.DECK_TOP:
      player();
      m.count = r.u8();
      m.code = r.u32() & 0x7fffffff;
      return m;
    case M.CONFIRM_CARDS:
    case M.CONFIRM_DECKTOP:
    case M.CONFIRM_EXTRATOP:
      player();
      m.cards = r.list(short);
      return m;
    case M.CHAINING:
      Object.assign(m, card());
      m.triggering_controller = r.u8();
      m.triggering_location = r.u8();
      m.triggering_sequence = r.u8();
      m.description = r.u32();
      m.chain_size = r.u8();
      return m;
    case M.CHAINED:
    case M.CHAIN_SOLVING:
    case M.CHAIN_SOLVED:
    case M.CHAIN_NEGATED:
    case M.CHAIN_DISABLED:
      m.chain_size = r.u8();
      return m;
    case M.ATTACK:
      m.attacker = r.loc();
      m.defender = r.loc();
      return m;
    case M.ADD_COUNTER:
    case M.REMOVE_COUNTER:
      m.counter_type = r.u16();
      Object.assign(m, r.loc(false));
      m.count = r.u16();
      return m;
    case M.EQUIP:
      m.equip = r.loc();
      m.target = r.loc();
      return m;
    case M.BECOME_TARGET:
      m.cards = r.list(() => r.loc());
      return m;
    default:
      return m;
  }
}
export function readQuery(data) {
  const r = new Reader(data),
    flags = r.u32(),
    card = {};
  if (!flags) return null;
  const fields = [
    [1, 'code'],
    [2, 'position'],
    [4, 'alias'],
    [8, 'type'],
    [16, 'level'],
    [32, 'rank'],
    [64, 'attribute'],
    [128, 'race'],
    [256, 'attack'],
    [512, 'defense'],
    [1024, 'baseAttack'],
    [2048, 'baseDefense'],
    [4096, 'reason'],
    [8192, 'reasonCard'],
    [16384, 'equip'],
    [32768, 'targets'],
    [65536, 'overlayCards'],
    [131072, 'counters'],
    [262144, 'owner'],
    [524288, 'status'],
    [1048576, 'isPublic'],
    [2097152, 'leftScale'],
    [4194304, 'rightScale'],
    [8388608, 'link'],
  ];
  for (const [flag, key] of fields) {
    if (!(flags & flag)) continue;
    if (key === 'position') {
      Object.assign(card, r.loc());
    } else if (key === 'equip') {
      card.equip = r.loc();
    } else if (key === 'targets') {
      card.targets = Array.from({ length: r.u32() }, () => r.loc());
    } else if (key === 'overlayCards') {
      card.overlayCards = Array.from({ length: r.u32() }, () => r.u32());
    } else if (key === 'counters') {
      card.counters = Object.fromEntries(Array.from({ length: r.u32() }, () => [r.u16(), r.u16()]));
    } else if (key === 'link') {
      card.link = { rating: r.u32(), marker: r.remaining >= 4 ? r.u32() : 0 };
    } else {
      card[key] = r.i32();
    }
  }
  return card;
}
const i32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeInt32LE(Number(n) | 0);
  return b;
};
export function legacyResponse(response, human = 0) {
  const r = response;
  switch (r.type) {
    case R.SELECT_IDLECMD:
    case R.SELECT_BATTLECMD:
      return i32(r.action | ((r.index || 0) << 16));
    case R.SELECT_EFFECTYN:
    case R.SELECT_YESNO:
      return i32(r.yes ? 1 : 0);
    case R.SELECT_OPTION:
      return i32(r.index);
    case R.SELECT_CHAIN:
      return i32(r.index === null ? -1 : r.index);
    case R.SELECT_CARD:
    case R.SELECT_TRIBUTE:
    case R.SELECT_SUM:
      return r.indicies === null ? i32(-1) : Buffer.from([r.indicies.length, ...r.indicies]);
    case R.SELECT_UNSELECT_CARD:
      return r.index === null ? i32(-1) : Buffer.from([1, r.index]);
    case R.SORT_CARD:
      return r.order === null ? Buffer.from([255]) : Buffer.from(r.order);
    case R.SELECT_PLACE:
    case R.SELECT_DISFIELD:
      return Buffer.from(r.places.flatMap((p) => [p.player ^ human, p.location, p.sequence]));
    case R.SELECT_POSITION:
      return i32(r.position);
    case R.SELECT_COUNTER: {
      const b = Buffer.alloc(r.counters.length * 2);
      r.counters.forEach((n, i) => b.writeUInt16LE(n, i * 2));
      return b;
    }
    case R.ANNOUNCE_CARD:
      return i32(r.card);
    case R.ANNOUNCE_NUMBER:
    case R.ROCK_PAPER_SCISSORS:
      return i32(r.value);
    case R.ANNOUNCE_ATTRIB:
      return i32(r.attributes.reduce((a, b) => a | b, 0));
    case R.ANNOUNCE_RACE:
      return i32(Number(r.races.reduce((a, b) => a | BigInt(b), 0n)));
    default:
      throw new Error('不支持的服务器响应类型');
  }
}
