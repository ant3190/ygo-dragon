import test from 'node:test';
import assert from 'node:assert/strict';
import { OcgMessageType as M, OcgResponseType as R } from 'ocgcore-wasm';
import { makePrompt, fieldPlaces, sumValid } from '../server/prompts.mjs';
import { visibleState } from '../server/visibility.mjs';
import { parseYdk, encodeYdk, validateDeck } from '../shared/decks.mjs';
const catalog = { get: (code) => ({ name: String(code) }), description: () => 'test' };
test('multi-selection requires explicit valid confirmation and rejects stale/duplicate options', () => {
  const { resolve } = makePrompt(
    {
      type: M.SELECT_CARD,
      player: 0,
      min: 2,
      max: 3,
      can_cancel: false,
      selects: [{ code: 1 }, { code: 2 }, { code: 3 }],
    },
    catalog,
    7,
  );
  assert.throws(() => resolve({ promptId: 6, ids: ['0', '1'] }), /过期/);
  assert.throws(() => resolve({ promptId: 7, ids: ['0'] }), /请选择/);
  assert.throws(() => resolve({ promptId: 7, ids: ['0', '0'] }), /无效/);
  assert.throws(() => resolve({ promptId: 7, cancel: true }), /不能取消/);
  assert.deepEqual(resolve({ promptId: 7, ids: ['0', '2'] }), {
    type: R.SELECT_CARD,
    indicies: [0, 2],
  });
});
test('incremental material selection distinguishes finishing from cancellation', () => {
  const { resolve } = makePrompt(
    {
      type: M.SELECT_UNSELECT_CARD,
      player: 0,
      min: 1,
      max: 5,
      can_finish: true,
      can_cancel: false,
      select_cards: [{ code: 1 }],
      unselect_cards: [{ code: 2 }],
    },
    catalog,
    3,
  );
  assert.throws(() => resolve({ promptId: 3, cancel: true }), /不能取消/);
  assert.deepEqual(resolve({ promptId: 3, finish: true }), {
    type: R.SELECT_UNSELECT_CARD,
    index: null,
  });
  assert.deepEqual(resolve({ promptId: 3, ids: ['1'] }), {
    type: R.SELECT_UNSELECT_CARD,
    index: 1,
  });
});
test('double tribute counts as two releases without requiring two cards', () => {
  const { resolve } = makePrompt(
    {
      type: M.SELECT_TRIBUTE,
      player: 0,
      min: 2,
      max: 2,
      can_cancel: true,
      selects: [
        { code: 1, release_param: 2 },
        { code: 2, release_param: 1 },
      ],
    },
    catalog,
    1,
  );
  assert.deepEqual(resolve({ promptId: 1, ids: ['0'] }).indicies, [0]);
  assert.throws(() => resolve({ promptId: 1, ids: ['1'] }), /数量不足/);
});
test('sum selection handles alternate values and mandatory materials', () => {
  assert.equal(sumValid([{ amount: 2 | (5 << 16) }, { amount: 3 }], 8), true);
  assert.equal(sumValid([{ amount: 2 }, { amount: 3 }], 8), false);
  const p = makePrompt(
    {
      type: M.SELECT_SUM,
      player: 0,
      min: 1,
      max: 2,
      amount: 8,
      select_max: 0,
      selects_must: [{ code: 1, amount: 3 }],
      selects: [{ code: 2, amount: 5 }],
    },
    catalog,
    1,
  );
  assert.deepEqual(p.resolve({ promptId: 1, ids: ['0'] }), {
    type: R.SELECT_SUM,
    indicies: [0, 1],
  });
});
test('field mask decodes both controllers including extra monster zones', () => {
  const places = fieldPlaces((0xffffffff ^ (1 << 5) ^ (1 << 17)) >>> 0, 1);
  assert.deepEqual(
    places.map((p) => [p.player, p.location, p.sequence]),
    [
      [1, 4, 5],
      [0, 4, 1],
    ],
  );
});
test('private hand, deck order, set cards and face-down banished cards stay private', () => {
  const card = (controller, location, position = 8) => ({
    code: 123,
    controller,
    location,
    sequence: 0,
    position,
    attack: 2000,
  });
  const state = {
    players: [0, 1].map((player) => ({
      player,
      lp: 8000,
      zones: Object.fromEntries(
        [1, 2, 4, 8, 16, 32, 64].map((loc) => [loc, [card(player, loc, loc === 16 ? 1 : 8)]]),
      ),
    })),
  };
  const view = visibleState(state, 0);
  for (const location of [1, 2, 4, 8, 32, 64])
    assert.equal(view.players[1].zones[location][0].code, undefined);
  assert.equal(view.players[1].zones[16][0].code, 123);
  assert.equal(view.players[0].zones[2][0].code, 123);
  assert.equal(view.players[0].zones[1][0].code, undefined);
  assert.equal(state.players[1].zones[2][0].code, 123);
});
test('YDK roundtrip and malformed input validation', () => {
  const deck = { main: [1, 2], extra: [3], side: [4] };
  assert.deepEqual(parseYdk(encodeYdk(deck)), deck);
  assert.throws(() => parseYdk('#main\n4294967296'), /范围/);
  assert.throws(() => parseYdk('<html>wrong</html>'), /无法识别/);
  assert(validateDeck(deck).some((e) => e.includes('40')));
  assert(
    validateDeck({ main: Array(40).fill(1), extra: [], side: [] }).some((e) => e.includes('3')),
  );
});
