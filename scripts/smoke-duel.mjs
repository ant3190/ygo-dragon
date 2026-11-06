import { Worker } from 'node:worker_threads';
import path from 'node:path';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.mjs';
import { Resources } from '../server/resources.mjs';
import { Catalog } from '../server/catalog.mjs';
import { makeStarters } from '../server/starters.mjs';
import { chooseBot } from '../server/bot.mjs';
import { validateDeck } from '../shared/decks.mjs';

const config = loadConfig(),
  resources = await new Resources(config).init();
if (!resources.status.ready) {
  console.error('请先运行 npm run resources:sync');
  process.exit(1);
}
const catalog = new Catalog(resources.snapshot.database, path.join(config.data, 'strings.conf')),
  decks = makeStarters(catalog);
for (const deck of decks)
  assert.deepEqual(
    validateDeck(deck, (id) => catalog.get(id)),
    [],
    `invalid starter: ${deck.name}`,
  );
for (let run = 0; run < 4; run++)
  await new Promise((resolve, reject) => {
    let turns = 0,
      actions = 0,
      finished = false;
    const types = new Set();
    const worker = new Worker(new URL('../server/duel-worker.mjs', import.meta.url), {
      workerData: {
        snapshot: resources.snapshot,
        strings: path.join(config.data, 'strings.conf'),
        decks: [decks[run % 2], decks[(run + 1) % 2]],
        bot: -1,
      },
    });
    const timer = setTimeout(() => done(new Error('smoke timeout')), 45000);
    function done(error) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else {
        console.log(
          `duel ${run + 1}: ${turns} turns, ${actions} validated responses; ${[...types].join(', ')}`,
        );
        resolve();
      }
    }
    worker.on('error', done);
    worker.on('message', (m) => {
      try {
        if (m.type === 'fatal' || m.type === 'input-error')
          return done(new Error(`${m.type}: ${m.message}`));
        if (m.type === 'core-warning') console.warn('core:', m.message);
        if (m.type !== 'view') return;
        turns = m.state.turn;
        for (const card of m.state.players[1 - m.viewer].zones[2])
          assert(!card?.code, 'opponent hand leaked');
        for (const card of m.state.players[m.viewer].zones[1])
          assert(!card?.code, 'deck order leaked');
        if (m.state.ended) {
          assert(turns >= 2);
          return done();
        }
        if (m.prompt) {
          actions++;
          if (actions > 1200) return done(new Error('bot loop'));
          types.add(m.prompt.kind);
          worker.postMessage({
            type: 'response',
            player: m.viewer,
            input: chooseBot(m.prompt, catalog, m.state),
          });
        }
      } catch (e) {
        done(e);
      }
    });
  });
resources.meta.close();
