import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { OcgMessageType as M } from 'ocgcore-wasm';
import { RemoteDuel } from '../server/remote-duel.mjs';
import { packet, PacketStream, utf16 } from '../server/protocol.mjs';
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};
const bytes = (...parts) =>
  Buffer.concat(parts.map((p) => (Array.isArray(p) ? Buffer.from(p) : p)));
const card = (code, sequence) => bytes(u32(code), [1, 4, sequence, 1]);
// All traffic stays on loopback; these synthetic ids are not loaded from any saved deck.
test(
  'local WindBot wire bridge: chosen opponent, first/second player, multi-select, undo, end',
  { timeout: 7000 },
  async (t) => {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await once(server, 'listening');
    t.after(() => {
      for (const client of server.clients) client.terminate();
      server.close();
    });
    const received = [],
      views = [],
      frames = [];
    let step = 0,
      rpsRound = 0,
      querySeen = false,
      finished;
    const done = new Promise((resolve, reject) => {
      finished = { resolve, reject };
    });
    server.on('connection', (ws) => {
      const stream = new PacketStream();
      const game = (...parts) => ws.send(packet(1, bytes(...parts)));
      const unselect = (available, selected, cancel = false) =>
        game(
          [
            M.SELECT_UNSELECT_CARD,
            1,
            selected.length ? 1 : 0,
            cancel ? 1 : 0,
            1,
            3,
            available.length,
          ],
          ...available,
          [selected.length],
          ...selected,
        );
      ws.on('message', (raw) => {
        try {
          for (const p of stream.read(raw)) {
            received.push(p);
            if (p.type === 18) {
              assert.equal(p.data.readUInt16LE(), 4962);
              const bundle = bytes(
                packet(18),
                packet(19, Buffer.from([0x10])),
                packet(32, bytes(utf16('测试 WindBot', 40), [1])),
                packet(33, Buffer.from([0x19])),
              );
              ws.send(bundle.subarray(0, 1));
              ws.send(bundle.subarray(1));
            }
            if (p.type === 2) {
              assert.equal(p.data.readUInt32LE(), 3);
              assert.deepEqual([...p.data.subarray(8)], [...bytes(u32(1), u32(2), u32(3))]);
            }
            if (p.type === 22) {
              assert.equal(p.data.toString('utf16le').replace(/\0.*$/s, ''), '/ai Dragun');
              querySeen = true;
            }
            if (p.type === 37) ws.send(packet(3));
            if (p.type === 3) {
              assert.equal(p.data[0], 2, 'the stone button must send rock=2');
              if (++rpsRound === 1) ws.send(bytes(packet(5, Buffer.from([2, 2])), packet(3)));
              else ws.send(bytes(packet(5, Buffer.from([2, 1])), packet(4)));
            }
            if (p.type === 4) {
              assert.equal(p.data[0], 1);
              game([M.START, 1, 5], u32(8000), u32(8000), [40, 0, 0, 0, 3, 0, 0, 0]);
              game([M.DRAW, 0, 1], u32(999));
              game([M.NEW_TURN, 1]);
              game([M.SELECT_PLACE, 1, 1], u32(0xffffffff ^ (1 << 2)));
            }
            if (p.type === 1) {
              if (step === 0) {
                assert.deepEqual([...p.data], [1, 4, 2]);
                game([M.SELECT_CARD, 1, 1, 2, 2, 3], card(1, 0), card(2, 1), card(3, 2));
              } else if (step === 1) {
                assert.deepEqual([...p.data], [2, 0, 2]);
                unselect([card(3, 2)], [card(1, 0), card(2, 1)]);
              } else if (step === 2) {
                assert.deepEqual([...p.data], [1, 1]);
                unselect([card(3, 2), card(1, 0)], [card(2, 1)]);
              } else if (step === 3) {
                assert.deepEqual([...p.data], [1, 2]);
                unselect([card(3, 2), card(1, 0), card(2, 1)], [], true);
              } else if (step === 4) {
                assert.equal(p.data.readInt32LE(), -1);
                unselect([card(1, 0), card(2, 1)], [], true);
              } else if (step === 5) {
                assert.deepEqual([...p.data], [1, 0]);
                unselect([card(2, 1)], [card(1, 0)]);
              } else if (step === 6) {
                assert.deepEqual([...p.data], [1, 0]);
                // A fixed-count summon can proceed without a final finish prompt.
                game([M.SELECT_PLACE, 1, 1], u32(0xffffffff ^ (1 << 2)));
              } else if (step === 7) {
                assert.deepEqual([...p.data], [1, 4, 2]);
                game([M.DAMAGE, 1], u32(1000));
                game([M.WIN, 1, 0]);
              }
              step++;
            }
          }
        } catch (e) {
          finished.reject(e);
        }
      });
    });
    const remote = new RemoteDuel({
      config: { aiServer: `ws://127.0.0.1:${server.address().port}`, aiVersion: 4962 },
      catalog: { get: (code) => ({ id: code, name: `test ${code}` }), description: () => '' },
      deck: { main: [1, 2, 3], extra: [], side: [] },
      bot: { command: 'Dragun' },
      name: '本地测试',
    });
    t.after(() => remote.terminate());
    remote.on('message', (m) => {
      try {
        if (m.type === 'fatal' || m.type === 'input-error') throw new Error(m.message);
        if (m.type === 'frame') frames.push(structuredClone(m));
        if (m.type !== 'view') return;
        views.push(structuredClone(m));
        assert(m.state.players[1].zones[2].every((c) => !c.code));
        if (m.state.ended) {
          assert.equal(m.state.winner, 0);
          assert.equal(m.state.players[0].lp, 7000);
          finished.resolve();
          return;
        }
        const p = m.prompt;
        if (!p) return;
        if (['choice', 'rps', 'turn-order'].includes(p.kind))
          remote.response({ promptId: p.id, ids: ['0'] });
        if (p.kind === 'zones') {
          assert.equal(p.options[0].controller, 0);
          remote.response({ promptId: p.id, ids: ['0'] });
        }
        if (p.kind === 'cards') {
          assert.equal(p.min, 2);
          remote.response({ promptId: p.id, ids: ['0', '2'] });
        }
        if (p.kind === 'unselect')
          remote.response(
            step >= 5
              ? { promptId: p.id, materialIds: ['0', '1'] }
              : { promptId: p.id, clear: true, cancelAll: true },
          );
      } catch (e) {
        finished.reject(e);
      }
    });
    await done;
    assert(querySeen);
    assert.equal(step, 8);
    assert.equal(rpsRound, 2);
    assert.deepEqual(
      frames.filter((f) => f.motion.type === 'rps').map((f) => f.state.opening.outcome),
      ['draw', 'win'],
    );
    assert(
      views.some(
        (v) =>
          v.state.opening?.stage === 'rps-wait' &&
          v.state.opening.mine === 2 &&
          v.state.opening.opponent === undefined,
      ),
    );
    assert(views.some((v) => v.prompt?.kind === 'turn-order'));
    assert(views.some((v) => v.state.turn > 0 && !v.state.opening));
    assert(frames.some((f) => f.motion.type === 'draw'));
    assert(views.some((v) => v.prompt?.kind === 'unselect'));
    assert(received.some((p) => p.type === 34));
  },
);
