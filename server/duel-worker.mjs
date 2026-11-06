import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import createCore, {
  OcgMessageType as M,
  OcgDuelMode,
  OcgQueryFlags as Q,
  OcgProcessResult,
} from 'ocgcore-wasm';
import { Catalog, coreCard } from './catalog.mjs';
import { makePrompt } from './prompts.mjs';
import { visibleState } from './visibility.mjs';
import { chooseBot } from './bot.mjs';

const catalog = new Catalog(workerData.snapshot.database, workerData.strings);
const core = await createCore({ sync: true });
const state = {
  turn: 0,
  turnPlayer: 0,
  phase: 1,
  chain: [],
  ended: false,
  winner: null,
  players: [0, 1].map((player) => ({ player, lp: 8000, zones: {} })),
};
let pending = null,
  serial = 0,
  closed = false,
  botTimer,
  lastResponse,
  lastPending,
  clearing = false;
const scripts = new Map();
function script(name) {
  if (scripts.has(name)) return scripts.get(name);
  if (name.includes('..') || path.isAbsolute(name)) return null;
  for (const dir of ['', 'official', 'unofficial', 'pre-release', 'pre-errata']) {
    try {
      const text = readFileSync(path.join(workerData.snapshot.scripts, dir, name), 'utf8');
      scripts.set(name, text);
      return text;
    } catch {}
  }
  return null;
}
const handle = core.createDuel({
  flags: OcgDuelMode.MODE_MR5,
  seed: Array.from({ length: 4 }, () => randomBytes(8).readBigUInt64LE()),
  team1: { drawCountPerTurn: 1, startingDrawCount: 5, startingLP: 8000 },
  team2: { drawCountPerTurn: 1, startingDrawCount: 5, startingLP: 8000 },
  cardReader: (code) => coreCard(catalog.get(code)),
  scriptReader: script,
  errorHandler: (type, text) =>
    parentPort.postMessage({ type: 'core-warning', message: String(text).slice(0, 1000) }),
});
if (!handle) throw new Error('规则核心初始化失败');
for (const name of ['constant.lua', 'utility.lua'])
  if (!core.loadScript(handle, name, script(name))) throw new Error(`规则脚本加载失败：${name}`);
// Shuffle deck order once on the server. The client never animates or reorders the hand.
function shuffled(cards) {
  const out = [...cards];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBytes(4).readUInt32LE() % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
for (let team = 0; team < 2; team++) {
  const deck = workerData.decks[team];
  for (const [location, codes] of [
    [1, shuffled(deck.main)],
    [64, deck.extra],
  ])
    for (const code of codes)
      core.duelNewCard(handle, {
        code,
        team,
        controller: team,
        duelist: 0,
        location,
        sequence: 1,
        position: 8,
      });
}
const flags =
  Q.CODE |
  Q.POSITION |
  Q.ATTACK |
  Q.DEFENSE |
  Q.LEVEL |
  Q.RANK |
  Q.OVERLAY_CARD |
  Q.COUNTERS |
  Q.IS_PUBLIC |
  Q.LINK;
function refresh() {
  const field = core.duelQueryField(handle);
  for (let player = 0; player < 2; player++) {
    state.players[player].lp = field.players[player].lp;
    for (const location of [1, 2, 4, 8, 16, 32, 64])
      state.players[player].zones[location] = core
        .duelQueryLocation(handle, { controller: player, location, flags })
        .map((card, sequence) => card && { ...card, controller: player, location, sequence });
  }
}
function send() {
  refresh();
  for (let viewer = 0; viewer < 2; viewer++)
    parentPort.postMessage({
      type: 'view',
      viewer,
      state: visibleState(state, viewer),
      prompt: pending?.prompt.player === viewer ? pending.prompt : null,
    });
}
function event(type, info = {}, viewers = [0, 1]) {
  parentPort.postMessage({
    type: 'event',
    viewers,
    event: { type, id: ++serial, at: Date.now(), ...info },
  });
}
function processMessages(messages) {
  for (const m of messages) {
    const next = makePrompt(m, catalog, ++serial);
    if (next) {
      pending = next;
      continue;
    }
    if (m.type === M.RETRY) {
      if (!lastPending) throw new Error('规则核心未提供可恢复的选择');
      pending = lastPending;
      clearing = false;
      parentPort.postMessage({
        type: 'input-error',
        player: pending.prompt.player,
        message: '该组合不满足卡片效果的条件，请调整后重新确认',
      });
    }
    if (m.type === M.NEW_TURN) {
      state.turn++;
      state.turnPlayer = m.player;
      event('turn', { player: m.player, turn: state.turn });
    }
    if (m.type === M.NEW_PHASE) {
      state.phase = m.phase;
      event('phase', { phase: m.phase });
    }
    if (m.type === M.WIN) {
      state.ended = true;
      state.winner = m.player < 2 ? m.player : null;
      event('win', { winner: state.winner, reason: m.reason });
    }
    if (m.type === M.CHAINING) {
      const item = { code: m.code, controller: m.controller, index: m.chain_size };
      state.chain.push(item);
      event('chain', item);
    }
    if (m.type === M.CHAIN_END) state.chain = [];
    if (m.type === M.CHAIN_SOLVING) event('resolve', { index: m.chain_size });
    if ([M.SUMMONING, M.SPSUMMONING, M.FLIPSUMMONING].includes(m.type))
      event('summon', { code: m.code, player: m.controller });
    if (m.type === M.ATTACK) event('attack', { from: m.attacker, to: m.defender });
    if (m.type === M.DAMAGE || m.type === M.RECOVER || m.type === M.PAY_LPCOST)
      event(m.type === M.RECOVER ? 'recover' : 'damage', { player: m.player, amount: m.amount });
    if (m.type === M.DRAW) event('draw', { player: m.player, count: m.drawn.length });
    // Revealed cards are transient information. Never forward the raw core message stream.
    if ([M.CONFIRM_CARDS, M.CONFIRM_DECKTOP, M.CONFIRM_EXTRATOP].includes(m.type))
      event(
        'reveal',
        {
          player: m.player,
          cards: m.cards.map((c) => ({
            code: c.code,
            controller: c.controller,
            location: c.location,
            sequence: c.sequence,
          })),
        },
        m.type === M.CONFIRM_CARDS ? [m.player] : [0, 1],
      );
  }
}
function pump() {
  if (closed || state.ended) return;
  const started = Date.now();
  for (let step = 0; step < 10000; step++) {
    const status = core.duelProcess(handle);
    processMessages(core.duelGetMessage(handle));
    if (state.ended || status === OcgProcessResult.END) {
      state.ended = true;
      send();
      return;
    }
    if (status === OcgProcessResult.WAITING) {
      if (!pending) throw new Error('规则核心等待未支持的响应');
      if (clearing && pending.prompt.kind === 'unselect') {
        const option = pending.prompt.options.find((o) => o.selected);
        if (option) {
          reply(pending.prompt.player, { promptId: pending.prompt.id, ids: [option.id] });
          return;
        }
      }
      clearing = false;
      if (
        pending.prompt.kind === 'chain' &&
        !pending.prompt.options.length &&
        pending.prompt.canCancel
      ) {
        reply(pending.prompt.player, { promptId: pending.prompt.id, cancel: true });
        return;
      }
      send();
      if (workerData.bot === pending.prompt.player)
        botTimer = setTimeout(
          () => reply(pending.prompt.player, chooseBot(pending.prompt, catalog, state)),
          450,
        );
      return;
    }
    if (Date.now() - started > 5000) throw new Error('规则处理超时');
  }
  throw new Error('规则处理步数超限');
}
function reply(player, input) {
  if (!pending || pending.prompt.player !== player || state.ended) return;
  try {
    if (input.clear && input.promptId === pending.prompt.id && pending.prompt.kind === 'unselect') {
      clearing = true;
      const option = pending.prompt.options.find((o) => o.selected);
      if (!option) {
        clearing = false;
        send();
        return;
      }
      input = { promptId: pending.prompt.id, ids: [option.id] };
    }
    lastResponse = pending.resolve(input);
    lastPending = pending;
    pending = null;
    core.duelSetResponse(handle, lastResponse);
    pump();
  } catch (e) {
    parentPort.postMessage({ type: pending ? 'input-error' : 'fatal', player, message: e.message });
  }
}
parentPort.on('message', (m) => {
  if (m.type === 'response') reply(m.player, m.input);
  if (m.type === 'snapshot') send();
  if (m.type === 'surrender' && !state.ended) {
    clearTimeout(botTimer);
    pending = null;
    state.ended = true;
    state.winner = 1 - m.player;
    event('win', { winner: state.winner, reason: 'surrender' });
    send();
  }
  if (m.type === 'close') {
    closed = true;
    clearTimeout(botTimer);
    core.destroyDuel(handle);
    parentPort.close();
  }
});
core.startDuel(handle);
pump();
