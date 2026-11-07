import { OcgMessageType as M } from 'ocgcore-wasm';
export const locations = [1, 2, 4, 8, 16, 32, 64];
export class DuelModel {
  serial = 0;
  constructor(
    catalog,
    sizes = [
      { deck: 40, extra: 0 },
      { deck: 40, extra: 0 },
    ],
  ) {
    this.catalog = catalog;
    this.state = {
      turn: 0,
      turnPlayer: 0,
      phase: 1,
      chain: [],
      ended: false,
      winner: null,
      players: [0, 1].map((player) => ({
        player,
        lp: 8000,
        zones: Object.fromEntries(
          locations.map((location) => [
            location,
            location === 4 ? Array(7).fill(null) : location === 8 ? Array(8).fill(null) : [],
          ]),
        ),
      })),
    };
    sizes.forEach((size, p) => {
      for (const [loc, n] of [
        [1, size.deck],
        [64, size.extra],
      ])
        this.state.players[p].zones[loc] = Array.from({ length: n }, (_, i) =>
          this.make({ controller: p, location: loc, sequence: i, position: 8 }),
        );
    });
  }
  make(card) {
    const data = this.catalog?.get(card.code);
    return {
      ...card,
      attack: card.attack ?? data?.atk,
      defense: card.defense ?? data?.def,
      level: card.level ?? data?.level,
      uid: card.uid || `c${++this.serial}`,
    };
  }
  at(c) {
    return this.state.players[c.controller]?.zones[c.location]?.[c.sequence];
  }
  zone(p, l) {
    return this.state.players[p].zones[l];
  }
  reindex(p, l) {
    this.zone(p, l).forEach((c, i) => {
      if (c) Object.assign(c, { controller: p, location: l, sequence: i });
    });
  }
  remove(c) {
    const loc = c.location & ~128,
      zone = this.zone(c.controller, loc);
    if (c.location & 128) {
      const parent = zone[c.sequence],
        index = c.position || c.overlay_sequence || 0;
      const code = parent?.overlayCards?.splice(index, 1)[0];
      return this.make({
        code,
        controller: c.controller,
        location: 128,
        sequence: index,
        position: 1,
      });
    }
    const card = zone?.[c.sequence];
    if (!zone) return null;
    if (loc === 4 || loc === 8) zone[c.sequence] = null;
    else {
      zone.splice(c.sequence, 1);
      this.reindex(c.controller, loc);
    }
    return card;
  }
  insert(c, card) {
    if (!c.location) return;
    const loc = c.location & ~128,
      zone = this.zone(c.controller, loc);
    if (c.location & 128) {
      const parent = zone[c.sequence];
      if (parent) (parent.overlayCards ||= []).push(card.code || 0);
      return;
    }
    Object.assign(card, c);
    if (loc === 4 || loc === 8) zone[c.sequence] = card;
    else {
      zone.splice(Math.min(c.sequence, zone.length), 0, card);
      this.reindex(c.controller, loc);
    }
  }
  apply(m) {
    const s = this.state;
    let motion = null;
    switch (m.type) {
      case M.START:
        s.players.forEach((p, i) => {
          p.lp = m.lp[i];
          for (const [l, n] of [
            [1, m.sizes[i].deck],
            [64, m.sizes[i].extra],
          ])
            p.zones[l] = Array.from({ length: n }, (_, j) =>
              this.make({ controller: i, location: l, sequence: j, position: 8 }),
            );
        });
        break;
      case M.UPDATE_DATA:
        m.cards.forEach((card, i) => {
          const zone = this.zone(m.player, m.location);
          if (card) {
            zone[i] = this.make({
              ...zone[i],
              ...card,
              controller: m.player,
              location: m.location,
              sequence: i,
            });
          } else zone[i] = null;
        });
        break;
      case M.UPDATE_CARD: {
        const zone = this.zone(m.player, m.location);
        zone[m.sequence] = m.card
          ? this.make({
              ...zone[m.sequence],
              ...m.card,
              controller: m.player,
              location: m.location,
              sequence: m.sequence,
            })
          : null;
        break;
      }
      case M.MOVE: {
        const old = m.from.location ? this.remove(m.from) : null,
          card = this.make({ ...old, code: m.card & 0x7fffffff, ...m.to });
        this.insert(m.to, card);
        motion = { type: 'move', uid: card.uid, from: m.from, to: m.to };
        break;
      }
      case M.DRAW: {
        for (const draw of m.drawn) {
          const deck = this.zone(m.player, 1);
          const old = deck.pop();
          this.zone(m.player, 2).push(
            this.make({
              uid: old?.uid,
              code: draw.code,
              controller: m.player,
              location: 2,
              sequence: this.zone(m.player, 2).length,
              position: 1,
            }),
          );
        }
        motion = { type: 'draw', player: m.player, count: m.drawn.length };
        break;
      }
      case M.POS_CHANGE: {
        const card = this.at(m);
        if (card) {
          card.position = m.position;
          card.code = m.code || card.code;
          motion = { type: 'position', uid: card.uid };
        }
        break;
      }
      case M.SWAP: {
        const a = this.remove(m.card1),
          b = this.remove(m.card2);
        if (a && b) {
          this.insert(m.card1, b);
          this.insert(m.card2, a);
        }
        motion = { type: 'move' };
        break;
      }
      case M.SUMMONING:
      case M.SPSUMMONING:
      case M.FLIPSUMMONING:
        motion = {
          type: 'summon',
          code: m.code,
          player: m.controller,
          uid: this.at(m)?.uid,
          from: { controller: m.controller, location: m.location, sequence: m.sequence },
        };
        break;
      case M.ATTACK:
        motion = { type: 'attack', from: m.attacker, to: m.defender };
        break;
      case M.NEW_TURN:
        s.turn++;
        s.turnPlayer = m.player;
        motion = { type: 'turn', player: m.player };
        break;
      case M.NEW_PHASE:
        s.phase = m.phase;
        break;
      case M.CHAINING:
        s.chain.push({ code: m.code, controller: m.controller, index: m.chain_size });
        motion = {
          type: 'chain',
          code: m.code,
          index: m.chain_size,
          uid: this.at(m)?.uid,
          from: { controller: m.controller, location: m.location, sequence: m.sequence },
        };
        break;
      case M.CHAIN_SOLVING:
        motion = { type: 'resolve', index: m.chain_size };
        break;
      case M.CHAIN_END:
        s.chain = [];
        break;
      case M.DAMAGE:
      case M.PAY_LPCOST:
        s.players[m.player].lp -= m.amount;
        motion = { type: 'damage', player: m.player, amount: m.amount };
        break;
      case M.RECOVER:
        s.players[m.player].lp += m.amount;
        motion = { type: 'recover', player: m.player, amount: m.amount };
        break;
      case M.LPUPDATE:
        s.players[m.player].lp = m.amount;
        break;
      case M.SHUFFLE_HAND:
      case M.SHUFFLE_EXTRA: {
        const location = m.type === M.SHUFFLE_HAND ? 2 : 64;
        this.state.players[m.player].zones[location] = (m.codes || m.cards || []).map((code, i) =>
          this.make({
            code: code & 0x7fffffff,
            controller: m.player,
            location,
            sequence: i,
            position: location === 64 ? 8 : 1,
          }),
        );
        break;
      }
      case M.SHUFFLE_DECK:
        this.zone(m.player, 1).forEach((c) => {
          if (c) {
            c.code = 0;
            c.uid = `c${++this.serial}`;
          }
        });
        break;
      case M.SWAP_GRAVE_DECK: {
        const deck = this.zone(m.player, 1),
          grave = this.zone(m.player, 16);
        const extraType = 0x40 | 0x2000 | 0x800000 | 0x4000000;
        const extras = grave.filter((c) => c && (this.catalog?.get(c.code)?.type || 0) & extraType);
        s.players[m.player].zones[1] = grave.filter((c) => c && !extras.includes(c));
        s.players[m.player].zones[16] = deck;
        this.zone(m.player, 64).push(...extras);
        for (const l of [1, 16, 64]) this.reindex(m.player, l);
        break;
      }
      case M.SHUFFLE_SET_CARD: {
        const cards = m.cards.map((c) => this.at(c.from));
        m.cards.forEach((c) => this.remove(c.from));
        m.cards.forEach((c, i) => {
          if (cards[i]) {
            cards[i].uid = `c${++this.serial}`;
            cards[i].code = 0;
            this.insert(c.to.location ? c.to : c.from, cards[i]);
          }
        });
        break;
      }
      case M.DECK_TOP: {
        const deck = this.zone(m.player, 1),
          card = deck[deck.length - 1 - m.count];
        if (card) card.code = m.code;
        break;
      }
      case M.ADD_COUNTER:
      case M.REMOVE_COUNTER: {
        const card = this.at(m);
        if (card) {
          card.counters ||= {};
          card.counters[m.counter_type] = Math.max(
            0,
            (card.counters[m.counter_type] || 0) + (m.type === M.ADD_COUNTER ? m.count : -m.count),
          );
        }
        break;
      }
      case M.WIN:
        s.ended = true;
        s.winner = m.player < 2 ? m.player : null;
        motion = { type: 'win' };
        break;
    }
    return motion;
  }
  reconcile(state) {
    for (let p = 0; p < 2; p++)
      for (const l of locations)
        state.players[p].zones[l] = state.players[p].zones[l].map(
          (c, i) => c && this.make({ ...c, uid: this.zone(p, l)[i]?.uid }),
        );
    this.state = state;
  }
}
export { presentationDuration as motionDuration } from '../shared/motion.mjs';
