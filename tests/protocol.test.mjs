import test from 'node:test';
import assert from 'node:assert/strict';
import { OcgMessageType as M, OcgResponseType as R, OcgOpCode } from 'ocgcore-wasm';
import { packet, PacketStream, readGame, readQuery, legacyResponse } from '../server/protocol.mjs';
import { makePrompt } from '../server/prompts.mjs';
import { SelectionReset } from '../server/selection-reset.mjs';
import { MaterialCommit } from '../server/material-commit.mjs';
import { DuelModel } from '../server/duel-model.mjs';
import { visibleState } from '../server/visibility.mjs';
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const bytes = (...parts) =>
  Buffer.concat(parts.map((p) => (Array.isArray(p) ? Buffer.from(p) : p)));
const catalog = {
  get: (code) => ({ id: code, name: `test ${code}`, atk: 1800, def: 1200 }),
  description: () => 'test',
};

test('wire stream accepts split headers and coalesced frames without losing payload', () => {
  const wire = bytes(packet(18, Buffer.from([1, 2, 3])), packet(19, Buffer.from([0x10])));
  const stream = new PacketStream();
  assert.deepEqual(stream.read(wire.subarray(0, 1)), []);
  assert.deepEqual(stream.read(wire.subarray(1, 4)), []);
  const frames = stream.read(wire.subarray(4));
  assert.deepEqual(
    frames.map((f) => [f.type, ...f.data]),
    [
      [18, 1, 2, 3],
      [19, 16],
    ],
  );
  assert.throws(() => new PacketStream().read(Buffer.from([0, 0, 1])), /长度无效/);
  assert.throws(() => readGame(Buffer.from([M.SELECT_CARD, 0, 0, 1])), /不完整/);
});

test('legacy forced chains and 32-bit announce opcodes adapt to current prompts', () => {
  const message = readGame(
    bytes(
      [M.SELECT_CHAIN, 1, 1, 0],
      u32(0),
      u32(0),
      [0, 1],
      u32(1000000123),
      [1, 4, 2, 1],
      u32(100),
    ),
  );
  assert.equal(message.forced, true);
  assert.equal(message.selects[0].code, 123);
  const pending = makePrompt(message, catalog, 3);
  assert.equal(pending.prompt.canCancel, false);
  assert.throws(() => pending.resolve({ promptId: 3, cancel: true }), /不能取消/);
  const announce = readGame(bytes([M.ANNOUNCE_CARD, 0, 2], u32(123), u32(0x40000100)));
  assert.deepEqual(announce.opcodes, [123n, OcgOpCode.ISCODE]);
});

test('legacy query retains positions, materials, counters and current stats', () => {
  const flags = 1 | 2 | 256 | 512 | 65536 | 131072 | 8388608;
  const card = readQuery(
    bytes(
      u32(flags),
      u32(123),
      [1, 4, 2, 4],
      u32(2200),
      u32(1600),
      u32(2),
      u32(10),
      u32(20),
      u32(1),
      [1, 0, 3, 0],
      u32(2),
    ),
  );
  assert.equal(card.position, 4);
  assert.equal(card.attack, 2200);
  assert.deepEqual(card.overlayCards, [10, 20]);
  assert.deepEqual(card.counters, { 1: 3 });
  assert.equal(card.link.rating, 2);
});

test('legacy responses preserve selection order, cancellation and relative player placement', () => {
  assert.deepEqual([...legacyResponse({ type: R.SELECT_CARD, indicies: [2, 0] })], [2, 2, 0]);
  assert.equal(legacyResponse({ type: R.SELECT_UNSELECT_CARD, index: null }).readInt32LE(), -1);
  assert.deepEqual(
    [
      ...legacyResponse(
        { type: R.SELECT_PLACE, places: [{ player: 0, location: 4, sequence: 2 }] },
        1,
      ),
    ],
    [1, 4, 2],
  );
  assert.deepEqual([...legacyResponse({ type: R.SORT_CARD, order: [2, 0, 1] })], [2, 0, 1]);
});

test('cancel-all follows changing material indices and only cancels when the core permits', () => {
  const reset = new SelectionReset();
  const p = (id, options, canCancel = false) => ({ id, kind: 'unselect', options, canCancel });
  assert.deepEqual(
    reset.begin(
      p(3, [
        { id: '1', selected: true },
        { id: '3', selected: true },
      ]),
      { promptId: 3, clear: true, cancelAll: true },
    ),
    { promptId: 3, ids: ['1'] },
  );
  assert.deepEqual(reset.next(p(4, [{ id: '2', selected: true }])), { promptId: 4, ids: ['2'] });
  assert.deepEqual(reset.next(p(5, [], true)), { promptId: 5, cancel: true });
  assert.equal(reset.next(p(6, [{ id: '0', selected: true }])), null);
  assert.throws(() => reset.begin(p(8, []), { promptId: 7, clear: true }), /过期/);
  assert.equal(reset.begin(p(9, []), { promptId: 9, clear: true, cancelAll: true }), null);
  reset.begin(p(10, [{ id: '0', selected: true }]), { promptId: 10, clear: true });
  assert.equal(reset.next(p(11, [{ id: '1', selected: true }])), null);
  assert.match(reset.takeNotice(), /规则指定/);
  assert.equal(reset.active, false);
});

test('animated state keeps card identity from draw to field, without leaking hidden cards', () => {
  const model = new DuelModel(catalog, [
    { deck: 3, extra: 0 },
    { deck: 3, extra: 0 },
  ]);
  model.apply({ type: M.DRAW, player: 0, drawn: [{ code: 123 }] });
  const uid = model.zone(0, 2)[0].uid;
  const move = model.apply({
    type: M.MOVE,
    card: 123,
    from: { controller: 0, location: 2, sequence: 0 },
    to: { controller: 0, location: 4, sequence: 2, position: 1 },
  });
  assert.equal(move.uid, uid);
  assert.equal(model.zone(0, 4)[2].uid, uid);
  model.apply({ type: M.DRAW, player: 1, drawn: [{ code: 456 }] });
  assert.equal(visibleState(model.state, 0).players[1].zones[2][0].code, undefined);
  assert.equal(visibleState(model.state, 0).players[1].zones[2][0].uid, model.zone(1, 2)[0].uid);
  model.apply({ type: M.POS_CHANGE, controller: 0, location: 4, sequence: 2, position: 4 });
  assert.equal(model.zone(0, 4)[2].position, 4);
  const old = model.zone(1, 2)[0].uid;
  model.apply({ type: M.SHUFFLE_HAND, player: 1, cards: [456] });
  assert.notEqual(model.zone(1, 2)[0].uid, old);
});

test('fixed-count material drafts are committed once using each new prompt index', () => {
  const commit = new MaterialCommit();
  const a = { id: '0', code: 1, controller: 0, location: 4, sequence: 0, selected: false };
  const b = { id: '1', code: 2, controller: 0, location: 4, sequence: 1, selected: false };
  const p = (id, options, canFinish = false) => ({ id, kind: 'unselect', options, canFinish });
  assert.equal(commit.next(p(1, [a, b])), null, 'selection alone must not write to the core');
  assert.deepEqual(commit.begin(p(1, [a, b]), { promptId: 1, materialIds: ['0', '1'] }), {
    promptId: 1,
    ids: ['0'],
  });
  assert.deepEqual(
    commit.next(
      p(2, [
        { ...b, id: '0' },
        { ...a, id: '1', selected: true },
      ]),
    ),
    { promptId: 2, ids: ['0'] },
  );
  assert.deepEqual(
    commit.next(
      p(
        3,
        [
          { ...a, selected: true },
          { ...b, selected: true },
        ],
        true,
      ),
    ),
    { promptId: 3, finish: true },
  );
  assert.equal(commit.next(p(4, [a, b])), null);
  // Fixed-count scripts may finish without another unselect prompt. Both choices
  // have already been explicitly approved before either response is sent.
  commit.begin(p(5, [a, b]), { promptId: 5, materialIds: ['0', '1'] });
  commit.next(
    p(6, [
      { ...b, id: '0' },
      { ...a, id: '1', selected: true },
    ]),
  );
  assert.equal(commit.next({ id: 7, kind: 'zones', options: [] }), null);
  assert.equal(commit.active, false);
});

test('changed material candidates stop a draft before it can finish a partial group', () => {
  const commit = new MaterialCommit(),
    a = { id: '0', code: 1, controller: 0, location: 4, sequence: 0 },
    b = { id: '1', code: 2, controller: 0, location: 4, sequence: 1 };
  const p = (id, options) => ({ id, kind: 'unselect', options, canFinish: true });
  commit.begin(p(1, [a, b]), { promptId: 1, materialIds: ['0', '1'] });
  assert.equal(commit.next(p(2, [{ ...a, selected: true }])), null);
  assert.match(commit.takeNotice(), /条件已更新/);
  assert.equal(commit.active, false);
});
