import test from 'node:test';
import assert from 'node:assert/strict';
import { OcgRPS, OcgMessageType as M } from 'ocgcore-wasm';
import { rpsChoices, rpsOutcome } from '../shared/rps.mjs';
import { presentationDuration } from '../shared/motion.mjs';
import { makePrompt } from '../server/prompts.mjs';
import { chooseBot } from '../server/bot.mjs';
import { cardAvailability } from '../src/duel/availability.ts';
import { planCardFlights } from '../src/duel/motion-plan.ts';

test('RPS labels follow the actual protocol and all nine results are correct', () => {
  assert.deepEqual(
    rpsChoices.map((c) => c.value),
    [OcgRPS.ROCK, OcgRPS.SCISSORS, OcgRPS.PAPER],
  );
  const catalog = { get: () => null, description: () => '' };
  const pending = makePrompt({ type: M.ROCK_PAPER_SCISSORS, player: 0 }, catalog, 7);
  assert.equal(pending.resolve({ promptId: 7, ids: ['0'] }).value, OcgRPS.ROCK);
  for (const value of [1, 2, 3]) assert.equal(rpsOutcome(value, value), 'draw');
  for (const [win, lose] of [
    [2, 1],
    [1, 3],
    [3, 2],
  ]) {
    assert.equal(rpsOutcome(win, lose), 'win');
    assert.equal(rpsOutcome(lose, win), 'lose');
  }
  assert.equal(rpsOutcome(0, 2), null);
});
test('action frames follow current legality, ownership, effects and pile candidates', () => {
  const card = { controller: 0, location: 2, sequence: 1 };
  const normal = { ...card, id: '0', action: 0, label: '通常召唤' };
  const activate = { ...card, id: '1', action: 5, label: '发动效果' };
  const prompt = { kind: 'actions', options: [normal] };
  assert.equal(cardAvailability(prompt, card).tone, 'blue');
  assert.equal(cardAvailability({ ...prompt, options: [normal, activate] }, card).tone, 'gold');
  assert.equal(
    cardAvailability({ ...prompt, options: [{ ...normal, action: 1 }] }, card).label,
    '可特召',
  );
  assert.equal(cardAvailability(prompt, { ...card, controller: 1 }), undefined);
  assert.equal(cardAvailability({ ...prompt, kind: 'cards' }, card), undefined);
  assert.equal(cardAvailability(null, card), undefined);
  assert.equal(
    cardAvailability({ ...prompt, options: [{ ...normal, phase: 'end' }] }, card),
    undefined,
  );
  assert.equal(
    cardAvailability({ ...prompt, kind: 'chain', options: [activate] }, card).tone,
    'gold',
  );
  assert.equal(
    cardAvailability(
      { ...prompt, options: [{ ...activate, location: 16, sequence: 3 }] },
      { controller: 0, location: 16 },
      true,
    ).tone,
    'gold',
  );
});
test('practice AI pays the tribute requirement with ordinary or double-tribute monsters', () => {
  const catalog = { get: () => ({ name: 'test' }), description: () => '' };
  for (const values of [
    [1, 1, 1],
    [1, 2, 1],
  ]) {
    const pending = makePrompt(
      {
        type: M.SELECT_TRIBUTE,
        player: 0,
        min: 2,
        max: 2,
        can_cancel: false,
        selects: values.map((release_param, i) => ({ code: i + 1, release_param })),
      },
      catalog,
      4,
    );
    const input = chooseBot(pending.prompt, catalog, {});
    assert.doesNotThrow(() => pending.resolve(input));
    assert.equal(input.ids.length, values.includes(2) ? 1 : 2);
  }
});
const box = (left, top, handPlayer) => ({ left, top, width: 70, height: 102, handPlayer });
test('drawing moves only new cards, including the old deck top, without shuffling the hand', () => {
  const before = new Map([
    ['old', box(100, 500, 0)],
    ['decktop', box(600, 400)],
  ]);
  const after = new Map([
    ['old', box(70, 500, 0)],
    ['decktop', box(170, 500, 0)],
    ['new', box(270, 500, 0)],
    ['opponent', box(200, 0, 1)],
  ]);
  const zones = new Map([['0-1', box(600, 400)]]);
  const plan = planCardFlights(before, after, zones, { type: 'draw', player: 0, count: 2 });
  assert.deepEqual(
    plan.map((p) => p.uid),
    ['decktop', 'new'],
  );
  assert.deepEqual(
    plan.map((p) => p.delay),
    [0, 36],
  );
  assert.equal(presentationDuration({ type: 'draw', count: 2 }), 396);
  const many = new Map(Array.from({ length: 10 }, (_, i) => [`draw${i}`, box(70 * i, 500, 0)]));
  const burst = planCardFlights(new Map(), many, zones, { type: 'draw', player: 0, count: 10 });
  assert(
    burst.every(
      (flight) => flight.delay + 360 <= presentationDuration({ type: 'draw', count: 10 }),
    ),
  );
  assert.equal(planCardFlights(before, after, zones, { type: 'shuffle' }).length, 0);
});
test('a move keeps the card identity across different containers and handles hidden piles', () => {
  const before = new Map([
    ['card', box(100, 500, 0)],
    ['other', box(180, 500, 0)],
  ]);
  const after = new Map([
    ['card', box(300, 300)],
    ['other', box(150, 500, 0)],
  ]);
  const zones = new Map([['0-16', box(600, 300)]]);
  const motion = {
    type: 'move',
    uid: 'card',
    from: { controller: 0, location: 2, sequence: 0 },
    to: { controller: 0, location: 4, sequence: 2 },
  };
  assert.deepEqual(
    planCardFlights(before, after, zones, motion).map((p) => [
      p.uid,
      p.from.left,
      p.to.left,
      p.arriving,
    ]),
    [['card', 100, 300, true]],
  );
  const hidden = planCardFlights(before, new Map(), zones, {
    ...motion,
    to: { controller: 0, location: 16 },
  });
  assert.equal(hidden[0].to.left, 600);
  assert.equal(hidden[0].arriving, false);
});
