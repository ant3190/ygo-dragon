import test from 'node:test';
import assert from 'node:assert/strict';
import { makeStarters } from '../server/starters.mjs';
import { validateDeck } from '../shared/decks.mjs';
test('starter generation excludes tokens and produces legal forty-card decks', () => {
  const cards = new Map();
  for (let i = 1; i <= 20; i++)
    cards.set(i, { id: i, name: String(i), type: 0x11, level: 4, atk: 1800, alias: 0 });
  cards.set(30, { id: 30, name: 'token', type: 0x4011, level: 4, atk: 2000, alias: 0 });
  for (const id of [89631139, 46986414])
    cards.set(id, { id, name: 'boss', type: 0x11, level: 8, atk: 3000, alias: 0 });
  for (const id of [83764718, 53129443, 5318639, 44095762, 97077563])
    cards.set(id, { id, name: 'spell', type: 2 });
  const catalog = { cards, get: (id) => cards.get(id) },
    decks = makeStarters(catalog);
  assert.equal(decks.length, 2);
  for (const deck of decks) {
    assert(!deck.main.includes(30));
    assert.deepEqual(validateDeck(deck, catalog.get), []);
  }
});
