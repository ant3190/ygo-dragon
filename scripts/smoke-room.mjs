import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
const base = 'http://127.0.0.1:18099';
const server = spawn(process.execPath, ['server/index.mjs'], {
  env: { ...process.env, YGO_PORT: '18099', YGO_HOST: '127.0.0.1', YGO_AUTO_UPDATE: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '';
server.stdout.on('data', (c) => (logs += c));
server.stderr.on('data', (c) => (logs += c));
const sockets = [];
function waitFor(ws, predicate, timeout = 12000) {
  const found = ws.messages.find(predicate);
  if (found) return Promise.resolve(found);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error('room test timeout: ' + JSON.stringify(ws.messages.slice(-3))));
    }, timeout);
    function handler(raw) {
      const m = JSON.parse(String(raw));
      if (predicate(m)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(m);
      }
    }
    ws.on('message', handler);
  });
}
const send = (ws, m) => ws.send(JSON.stringify(m));
async function connect(cookie) {
  const ws = new WebSocket(base.replace('http:', 'ws:') + '/socket', {
    headers: { Cookie: cookie, Origin: base },
  });
  ws.messages = [];
  ws.on('message', (raw) => ws.messages.push(JSON.parse(String(raw))));
  sockets.push(ws);
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  await waitFor(ws, (m) => m.type === 'connected');
  return ws;
}
try {
  let boot;
  for (let i = 0; i < 60; i++) {
    try {
      boot = await fetch(base + '/api/bootstrap');
      if (boot.ok) break;
    } catch {}
    await delay(150);
  }
  assert(boot?.ok, logs);
  const cookie0 = boot.headers.get('set-cookie').split(';')[0],
    data = await boot.json();
  assert(data.resources.ready, 'prepare resources first');
  const second = await fetch(base + '/api/bootstrap'),
    cookie1 = second.headers.get('set-cookie').split(';')[0];
  const [a, b] = await Promise.all([connect(cookie0), connect(cookie1)]);
  send(a, { type: 'create', name: 'QA Host', roomName: 'Integration test' });
  const host = await waitFor(a, (m) => m.type === 'room');
  assert.equal(host.seat, 0);
  send(b, { type: 'join', name: 'QA Guest', roomId: host.room.id });
  await waitFor(b, (m) => m.type === 'room' && m.seat === 1);
  send(a, { type: 'ready', deckId: 'starter-blue', ready: true });
  send(b, { type: 'ready', deckId: 'starter-dark', ready: true });
  await waitFor(a, (m) => m.type === 'room' && m.room.players.every((p) => p?.ready));
  send(a, { type: 'start' });
  const [v0, v1] = await Promise.all([
    waitFor(a, (m) => m.type === 'view' && m.prompt),
    waitFor(b, (m) => m.type === 'view'),
  ]);
  assert.equal(v0.state.turn, 1);
  assert.equal(v1.prompt, null);
  assert(v0.state.players[0].zones[2].every((c) => c.code));
  assert(v1.state.players[0].zones[2].every((c) => !c.code));
  send(b, { type: 'response', input: { promptId: v0.prompt.id, ids: [v0.prompt.options[0].id] } });
  await waitFor(b, (m) => m.type === 'error' && m.message.includes('过期'));
  a.close();
  await new Promise((resolve) => a.once('close', resolve));
  const reconnected = await connect(cookie0);
  const restored = await waitFor(reconnected, (m) => m.type === 'view');
  assert.equal(restored.prompt.id, v0.prompt.id);
  send(reconnected, { type: 'surrender' });
  const end = await waitFor(b, (m) => m.type === 'view' && m.state.ended);
  assert.equal(end.state.winner, 1);
  send(reconnected, { type: 'leave' });
  send(b, { type: 'leave' });
  await waitFor(b, (m) => m.type === 'left');
  console.log(
    'room: create / join / ready / real core / seat isolation / reconnect / surrender / leave passed',
  );
} finally {
  for (const ws of sockets) ws.terminate();
  server.kill('SIGTERM');
}
