import assert from 'node:assert/strict';
import { RemoteDuel } from '../server/remote-duel.mjs';
import { chooseBot } from '../server/bot.mjs';

// An independent, synthetic public-card fixture. This script does not import fs,
// load configuration files, or read saved decks, player profiles or credentials.
const ids = [
  43096270, 69247929, 11091375, 4148264, 14575467, 18108166, 24639891, 47226949, 47894537, 74852097,
  81823360, 11224103, 66788016,
];
const deck = { main: [...ids.flatMap((id) => [id, id, id]), 41392891], extra: [], side: [] };
const config = {
  aiServer: process.env.YGO_AI_SERVER || 'wss://koishi.momobako.com:7211',
  aiVersion: Number(process.env.YGO_AI_VERSION || 4962),
};
assert.equal(deck.main.length, 40);
if (!process.argv.includes('--connect')) {
  console.log(
    JSON.stringify(
      {
        destination: config.aiServer,
        nickname: 'Protocol QA',
        opponentCommand: '/ai Dragun',
        publicTestCardIds: deck.main,
        readsSavedDecks: false,
        readsPlayerProfiles: false,
        networkStarted: false,
      },
      null,
      2,
    ),
  );
  console.log('To run this explicit public-fixture integration test: npm run test:ai -- --connect');
} else {
  const card = (code) => ({
    id: code,
    name: `Public card ${code}`,
    type: 17,
    atk: 2000,
    def: 1000,
    level: 4,
    alias: 0,
    setcode: '0',
    race: '1',
    attribute: 16,
    strings: [],
  });
  const catalog = {
    get: card,
    cards: new Map(deck.main.map((id) => [id, card(id)])),
    description: () => '',
  };
  let actions = 0,
    turns = 0,
    ended = false;
  const remote = new RemoteDuel({
    config,
    catalog,
    deck,
    bot: { command: 'Dragun' },
    name: 'Protocol QA',
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('public fixture duel timed out')), 180000);
    function finish(error) {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      void remote.terminate();
      error ? reject(error) : resolve();
    }
    remote.on('message', (m) => {
      try {
        if (m.type === 'fatal' || m.type === 'input-error') return finish(new Error(m.message));
        if (m.type === 'opponent') console.log(`opponent: ${m.name}`);
        if (m.type !== 'view') return;
        if (m.state.turn !== turns) {
          turns = m.state.turn;
          console.log(`turn ${turns}; LP ${m.state.players.map((p) => p.lp).join(' / ')}`);
        }
        if (m.state.ended) {
          assert(turns >= 2);
          console.log(
            `public fixture: ended, winner ${m.state.winner}, ${actions} validated responses`,
          );
          finish();
          return;
        }
        if (m.prompt) {
          if (++actions > 1000) throw new Error('response loop');
          remote.response(chooseBot(m.prompt, catalog, m.state));
        }
      } catch (e) {
        finish(e);
      }
    });
  });
}
