import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { WebSocketServer, WebSocket } from 'ws';
import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from './config.mjs';
import { Resources } from './resources.mjs';
import { Catalog } from './catalog.mjs';
import { makeStarters } from './starters.mjs';
import { parseYdk, validateDeck } from '../shared/decks.mjs';
import { RemoteDuel } from './remote-duel.mjs';
import opponents from './data/ai-opponents.json' with { type: 'json' };

const config = loadConfig(),
  resources = await new Resources(config).init();
const catalog = new Catalog(resources.snapshot.database, path.join(config.data, 'strings.conf'));
resources.on('database', () => catalog.reload());
const store = new DatabaseSync(path.join(config.data, 'players.sqlite'));
store.exec(
  "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS players (id TEXT PRIMARY KEY, decks TEXT NOT NULL DEFAULT '[]')",
);
const sessions = new Map(),
  rooms = new Map();
const json = (res, data, status = 200) => {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(data));
};
const encode = (value) =>
  JSON.stringify(value, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
const send = (socket, value) => {
  if (socket.readyState === WebSocket.OPEN) socket.send(encode(value));
};
function cookie(req) {
  return /(?:^|;\s*)dragon=([a-f0-9-]{36})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
}
function session(req, res) {
  let id = cookie(req);
  if (!id) {
    id = randomUUID();
    res?.setHeader(
      'Set-Cookie',
      `dragon=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted ? '; Secure' : ''}`,
    );
  }
  if (!sessions.has(id)) {
    store.prepare('INSERT OR IGNORE INTO players(id) VALUES (?)').run(id);
    sessions.set(id, { id, sockets: new Set(), room: null, seat: null, name: '决斗者' });
  }
  return sessions.get(id);
}
function decksFor(user) {
  return [
    ...makeStarters(catalog),
    ...JSON.parse(store.prepare('SELECT decks FROM players WHERE id=?').get(user.id).decks),
  ];
}
async function body(req) {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 256 * 1024) throw new Error('请求内容过大');
  }
  try {
    return JSON.parse(text || '{}');
  } catch {
    throw new Error('请求格式无效');
  }
}
function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try {
    return (
      new URL(req.headers.origin).host === req.headers.host ||
      config.origins.includes(req.headers.origin)
    );
  } catch {
    return false;
  }
}
function getDeck(user, id) {
  const deck = decksFor(user).find((d) => d.id === id);
  if (!deck) throw new Error('请先保存并选择卡组');
  const errors = validateDeck(deck, (id) => catalog.get(id));
  if (errors.length) throw new Error(errors.join('；'));
  return deck;
}
function publicRoom(room) {
  return {
    id: room.id,
    name: room.name,
    mode: room.mode,
    started: !!room.worker,
    ended: !!room.ended,
    opponent: room.opponent,
    source:
      room.mode === 'solo' ? 'WindBot' : room.mode === 'practice' ? '离线基础练习' : undefined,
    players: room.players.map((p, seat) =>
      p ? { name: p.name, ready: room.ready[seat], connected: p.sockets.size > 0, seat } : null,
    ),
  };
}
function broadcastRoom(room) {
  for (const p of room.players)
    if (p)
      for (const ws of p.sockets) send(ws, { type: 'room', room: publicRoom(room), seat: p.seat });
}
function createRoom(user, mode, name) {
  if (user.room) throw new Error('请先离开当前房间');
  if (rooms.size >= 32) throw new Error('房间已满，请稍后再试');
  const room = {
    id: randomBytes(4).toString('hex').toUpperCase(),
    name: String(name || `${user.name}的房间`).slice(0, 32),
    mode,
    players: [user, null],
    ready: [false, false],
    decks: [null, null],
    views: [null, null],
    created: Date.now(),
    events: [[], []],
  };
  user.room = room.id;
  user.seat = 0;
  rooms.set(room.id, room);
  return room;
}
function leave(user) {
  const room = rooms.get(user.room);
  user.room = null;
  const seat = user.seat;
  user.seat = null;
  if (!room) return;
  if (room.worker && !room.ended) room.worker.postMessage({ type: 'surrender', player: seat });
  room.players[seat] = null;
  room.ready[seat] = false;
  room.decks[seat] = null;
  if (!room.players.some(Boolean) || room.mode === 'solo' || room.mode === 'practice') {
    room.worker?.terminate();
    rooms.delete(room.id);
  } else broadcastRoom(room);
}
function start(room) {
  if (!resources.status.ready) throw new Error('本地资源尚未准备好，请到设置查看进度');
  if (room.worker) throw new Error('对局已开始');
  const worker =
    room.mode === 'solo'
      ? new RemoteDuel({
          config,
          catalog,
          deck: room.decks[0],
          bot: room.bot,
          name: room.players[0].name,
        })
      : new Worker(new URL('./duel-worker.mjs', import.meta.url), {
          workerData: {
            snapshot: resources.snapshot,
            strings: path.join(config.data, 'strings.conf'),
            decks: room.decks,
            bot: room.mode === 'practice' ? 1 : -1,
          },
          resourceLimits: { maxOldGenerationSizeMb: 256 },
        });
  room.worker = worker;
  room.started = Date.now();
  broadcastRoom(room);
  let timer = setTimeout(() => fail('规则核心响应超时'), 15000);
  const fail = (message) => {
    clearTimeout(timer);
    room.ended = true;
    room.error = message;
    for (const p of room.players)
      if (p) for (const ws of p.sockets) send(ws, { type: 'fatal', message });
    worker.terminate();
  };
  worker.on('message', (message) => {
    if (message.type === 'frame') {
      for (const ws of room.players[message.viewer]?.sockets || []) send(ws, message);
      return;
    }
    if (message.type === 'opponent') {
      room.opponent = message.name;
      broadcastRoom(room);
      return;
    }
    if (message.type === 'view') {
      clearTimeout(timer);
      room.views[message.viewer] = message;
      if (message.state.ended && !room.ended) {
        room.ended = true;
        broadcastRoom(room);
      }
      for (const ws of room.players[message.viewer]?.sockets || []) send(ws, message);
    }
    if (message.type === 'event')
      for (const seat of message.viewers) {
        room.events[seat].push(message.event);
        room.events[seat] = room.events[seat].slice(-100);
        for (const ws of room.players[seat]?.sockets || [])
          send(ws, { type: 'event', event: message.event });
      }
    if (message.type === 'input-error') {
      clearTimeout(timer);
      for (const ws of room.players[message.player]?.sockets || [])
        send(ws, { type: 'error', message: message.message });
    }
    if (message.type === 'fatal') fail(message.message);
    if (message.type === 'core-warning') console.warn(`[core ${room.id}] ${message.message}`);
  });
  worker.on('error', (e) => fail(`规则核心异常：${e.message}`));
  worker.on('exit', (code) => {
    clearTimeout(timer);
    if (code && !room.ended) fail('规则核心已停止');
  });
  room.respond = (player, input) => {
    clearTimeout(timer);
    timer = setTimeout(() => fail('规则核心响应超时'), 15000);
    worker.postMessage({ type: 'response', player, input });
  };
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost'),
      route = url.pathname,
      method = req.method;
    if (method !== 'GET' && !sameOrigin(req)) return json(res, { error: '不允许跨站请求' }, 403);
    if (route === '/api/health')
      return json(res, { ok: true, ready: resources.status.ready, version: '0.2.0' });
    if (/^\/api\/images\/\d+\.jpg$/.test(route)) {
      try {
        const code = Number(route.match(/(\d+)\.jpg$/)[1]);
        if (!catalog.get(code)) return json(res, { error: '卡号不在本地卡库中' }, 404);
        const file = await resources.image(code),
          info = await stat(file);
        const tag = `"${info.size}-${Math.trunc(info.mtimeMs)}"`;
        if (req.headers['if-none-match'] === tag) {
          res.writeHead(304);
          return res.end();
        }
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': info.size,
          'Cache-Control': 'public, max-age=86400',
          ETag: tag,
          'X-Content-Type-Options': 'nosniff',
        });
        createReadStream(file).pipe(res);
      } catch (e) {
        json(res, { error: e.message }, e.missing ? 404 : 503);
      }
      return;
    }
    if (route.startsWith('/api/')) {
      const user = session(req, res);
      if (route === '/api/bootstrap')
        return json(res, {
          decks: decksFor(user),
          resources: resources.status,
          room: rooms.has(user.room) ? publicRoom(rooms.get(user.room)) : null,
        });
      if (route === '/api/opponents') return json(res, { opponents, server: config.aiServer });
      if (route === '/api/cards')
        return json(
          res,
          catalog.search({
            q: url.searchParams.get('q') || '',
            type: url.searchParams.get('type') || 'all',
            offset: Number(url.searchParams.get('offset')) || 0,
            limit: Number(url.searchParams.get('limit')) || 60,
          }),
        );
      if (/^\/api\/cards\/\d+$/.test(route)) {
        const card = catalog.get(Number(route.split('/').pop()));
        return json(res, card || { error: '找不到卡片' }, card ? 200 : 404);
      }
      if (route === '/api/decks' && method === 'POST') {
        const input = await body(req),
          deck = input.ydk !== undefined ? { ...parseYdk(input.ydk), name: input.name } : input;
        if (
          !['main', 'extra', 'side'].every(
            (k) =>
              Array.isArray(deck[k]) &&
              deck[k].length <= 60 &&
              deck[k].every((n) => Number.isSafeInteger(n) && n > 0 && n <= 0xffffffff),
          ) ||
          deck.main.length + deck.extra.length + deck.side.length > 90
        )
          throw new Error('卡组格式或容量无效');
        const saved = JSON.parse(
          store.prepare('SELECT decks FROM players WHERE id=?').get(user.id).decks,
        );
        if (saved.length >= 100 && !saved.some((d) => d.id === input.id))
          throw new Error('最多保存 100 副卡组');
        const id =
          typeof input.id === 'string' && saved.some((d) => d.id === input.id)
            ? input.id
            : randomUUID();
        const result = {
          id,
          name: String(deck.name || '未命名卡组').slice(0, 60),
          main: deck.main,
          extra: deck.extra,
          side: deck.side,
          cover: deck.cover || deck.main[0],
          updatedAt: Date.now(),
        };
        const next = [result, ...saved.filter((d) => d.id !== id)];
        store.prepare('UPDATE players SET decks=? WHERE id=?').run(JSON.stringify(next), user.id);
        return json(res, { deck: result, errors: validateDeck(result, (id) => catalog.get(id)) });
      }
      if (route.startsWith('/api/decks/') && method === 'DELETE') {
        const id = route.split('/').pop(),
          saved = JSON.parse(
            store.prepare('SELECT decks FROM players WHERE id=?').get(user.id).decks,
          );
        store
          .prepare('UPDATE players SET decks=? WHERE id=?')
          .run(JSON.stringify(saved.filter((d) => d.id !== id)), user.id);
        return json(res, { ok: true });
      }
      if (route === '/api/resources/status')
        return json(res, {
          ...resources.status,
          dataDir: config.data,
          scriptsVersion: resources.scripts?.sha,
          sources: { database: config.database, images: config.images },
          interval: config.interval,
          autoUpdate: config.autoUpdate,
        });
      if (route === '/api/resources/sync' && method === 'POST') {
        const input = await body(req);
        if (input.verify)
          for (const key of ['cards.cdb', 'strings.conf', 'lflist.conf'])
            if (resources.records[key]) resources.records[key].checked = 0;
        void resources.sync(!!input.verify, true).catch(console.error);
        return json(res, { ok: true });
      }
      if (route === '/api/resources/images' && method === 'POST') {
        const input = await body(req);
        if (resources.bulkRunning) throw new Error('已有卡图任务正在进行');
        const codes = input.all
          ? [...catalog.cards.keys()]
          : [...new Set((input.codes || []).map(Number))];
        if (!codes.length || codes.some((id) => !catalog.get(id)))
          throw new Error('没有有效的卡片');
        void resources.prefetch(codes, !!input.retry).catch(console.error);
        return json(res, { ok: true });
      }
      if (route === '/api/rooms')
        return json(res, {
          rooms: [...rooms.values()]
            .filter((r) => r.mode === 'online' && !r.worker)
            .map(publicRoom),
        });
      return json(res, { error: '接口不存在' }, 404);
    }
    if (method !== 'GET' && method !== 'HEAD') return json(res, { error: '方法不支持' }, 405);
    const candidate = path.resolve(root, '.' + decodeURIComponent(route));
    if (!candidate.startsWith(root + path.sep) && candidate !== root)
      return json(res, { error: '路径无效' }, 400);
    const file = (await stat(candidate).catch(() => null))?.isFile()
      ? candidate
      : path.join(root, 'index.html');
    const info = await stat(file).catch(() => null);
    if (!info)
      return json(res, { error: '前端尚未构建，请运行 npm run build 或 npm run dev' }, 503);
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': file.includes('/assets/')
        ? 'public, max-age=31536000, immutable'
        : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    if (method === 'HEAD') res.end();
    else createReadStream(file).pipe(res);
  } catch (e) {
    if (!res.headersSent) json(res, { error: e.message }, 400);
    else res.destroy();
  }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
server.on('upgrade', (req, socket, head) => {
  if (req.url?.split('?')[0] !== '/socket' || !sameOrigin(req) || !cookie(req)) {
    socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
    return;
  }
  const user = session(req);
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, user));
});
wss.on('connection', (ws, user) => {
  user.sockets.add(ws);
  ws.alive = true;
  ws.on('pong', () => (ws.alive = true));
  let count = 0,
    last = Date.now();
  const existing = rooms.get(user.room);
  if (existing) {
    broadcastRoom(existing);
    if (existing.views[user.seat]) send(ws, existing.views[user.seat]);
    send(ws, { type: 'history', events: existing.events[user.seat] });
  }
  send(ws, { type: 'connected' });
  ws.on('message', (raw) => {
    try {
      if (Date.now() - last > 1000) {
        count = 0;
        last = Date.now();
      }
      if (++count > 30) throw new Error('操作太频繁');
      const m = JSON.parse(String(raw));
      if (m.name) user.name = String(m.name).trim().slice(0, 20) || '决斗者';
      if (m.type === 'create') {
        const room = createRoom(user, 'online', m.roomName);
        broadcastRoom(room);
      }
      if (m.type === 'solo' || m.type === 'practice') {
        const deck = getDeck(user, m.deckId);
        const bot = opponents.find((o) => o.id === (m.opponentId || 'Dragun'));
        if (m.type === 'solo' && !bot) throw new Error('请选择有效的 AI 对手');
        const room = createRoom(user, m.type, m.type === 'solo' ? '单人对战' : '本地练习');
        room.bot = bot;
        room.opponent = m.type === 'solo' ? bot?.name : '基础练习对手';
        room.decks = [
          deck,
          m.type === 'practice' ? getDeck(user, m.botDeckId || 'starter-dark') : null,
        ];
        room.ready = [true, true];
        try {
          start(room);
        } catch (e) {
          leave(user);
          throw e;
        }
      }
      if (m.type === 'join') {
        if (user.room) throw new Error('请先离开当前房间');
        const room = rooms.get(String(m.roomId).toUpperCase());
        if (!room || room.mode !== 'online' || room.worker)
          throw new Error('房间不存在或对局已开始');
        const seat = room.players.findIndex((p) => !p);
        if (seat < 0) throw new Error('房间已满');
        room.players[seat] = user;
        user.room = room.id;
        user.seat = seat;
        broadcastRoom(room);
      }
      const room = rooms.get(user.room);
      if (m.type === 'ready') {
        if (!room || room.worker) throw new Error('房间状态已改变');
        room.decks[user.seat] = getDeck(user, m.deckId);
        room.ready[user.seat] = !!m.ready;
        broadcastRoom(room);
      }
      if (m.type === 'start') {
        if (!room || user.seat !== 0) throw new Error('只有房主可以开始');
        if (!room.players.every(Boolean) || !room.ready.every(Boolean))
          throw new Error('请等待双方准备');
        start(room);
      }
      if (m.type === 'response') {
        if (!room?.worker || room.ended || room.views[user.seat]?.prompt?.id !== m.input?.promptId)
          throw new Error('操作已过期');
        room.respond(user.seat, m.input);
      }
      if (m.type === 'surrender')
        room?.worker?.postMessage({ type: 'surrender', player: user.seat });
      if (m.type === 'leave') {
        leave(user);
        for (const socket of user.sockets) send(socket, { type: 'left' });
      }
      if (m.type === 'chat' && room) {
        const text = String(m.text || '')
          .trim()
          .slice(0, 300);
        if (text)
          for (const p of room.players)
            if (p)
              for (const socket of p.sockets)
                send(socket, { type: 'chat', name: user.name, text, at: Date.now() });
      }
    } catch (e) {
      send(ws, { type: 'error', message: e.message });
    }
  });
  ws.on('close', () => {
    user.sockets.delete(ws);
    const room = rooms.get(user.room);
    if (room) broadcastRoom(room);
  });
  ws.on('error', () => {});
});
const sweep = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.alive) ws.terminate();
    else {
      ws.alive = false;
      ws.ping();
    }
  }
  for (const room of rooms.values())
    if (
      (!room.players.some((p) => p?.sockets.size) && Date.now() - room.created > 5 * 60000) ||
      (room.ended && Date.now() - room.started > 3600000)
    ) {
      for (const p of room.players)
        if (p) {
          p.room = null;
          p.seat = null;
        }
      room.worker?.terminate();
      rooms.delete(room.id);
    }
}, 30000);
sweep.unref();
resources.on('status', (status) => {
  const now = Date.now();
  if (now - (resources.lastBroadcast || 0) < 250 && status.phase === 'downloading') return;
  resources.lastBroadcast = now;
  for (const ws of wss.clients) send(ws, { type: 'resources', status });
});
server.listen(config.port, config.host, () =>
  console.log(`YGO Dragon → http://localhost:${config.port}`),
);
if (config.autoUpdate || !resources.status.ready)
  void resources
    .sync()
    .then(() => catalog.reload())
    .catch(console.error);
const update = setInterval(() => {
  if (config.autoUpdate)
    void resources
      .sync()
      .then(() => catalog.reload())
      .catch(console.error);
}, config.interval);
update.unref();
function shutdown() {
  for (const room of rooms.values()) room.worker?.terminate();
  for (const ws of wss.clients) ws.close();
  server.close();
  clearInterval(sweep);
  clearInterval(update);
  store.close();
  resources.meta.close();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
