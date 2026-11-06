import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { OcgMessageType as M } from 'ocgcore-wasm';
import {
  packet,
  utf16,
  joinPacket,
  deckPacket,
  PacketStream,
  readGame,
  legacyResponse,
} from './protocol.mjs';
import { makePrompt } from './prompts.mjs';
import { DuelModel, motionDuration } from './duel-model.mjs';
import { visibleState } from './visibility.mjs';
import { SelectionReset } from './selection-reset.mjs';
import { MaterialCommit } from './material-commit.mjs';

// A persistent upstream socket belongs to one local room, independent of browser reconnects.
export class RemoteDuel extends EventEmitter {
  serial = 0;
  human = 0;
  pending = null;
  started = false;
  closed = false;
  selectionReset = new SelectionReset();
  materialCommit = new MaterialCommit();
  constructor({ config, catalog, deck, bot, name }) {
    super();
    Object.assign(this, { config, catalog, deck, bot, name });
    this.model = new DuelModel(catalog, [
      { deck: deck.main.length, extra: deck.extra.length },
      { deck: 40, extra: 0 },
    ]);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.aiServer).hostname);
    const proxy = !local && (process.env.HTTPS_PROXY || process.env.https_proxy);
    this.socket = new WebSocket(config.aiServer, {
      agent: proxy ? new HttpsProxyAgent(proxy) : undefined,
      handshakeTimeout: 12000,
    });
    this.stream = new PacketStream();
    this.socket.on('open', () => {
      const password = `NF,NC,TI0#${randomBytes(4).toString('hex')}`;
      for (const b of joinPacket(name, password, config.aiVersion)) this.socket.send(b);
      this.send();
    });
    this.socket.on('message', (data) => {
      try {
        for (const p of this.stream.read(data)) this.receive(p);
      } catch (e) {
        this.fail(e.message);
      }
    });
    this.socket.on('error', (e) => this.fail(`AI 服务器连接失败：${e.message}`));
    this.socket.on('close', () => {
      if (!this.closed && !this.model.state.ended) this.fail('AI 服务器已断开连接，请重新开始对局');
    });
    this.timeout = setTimeout(() => this.fail('等待 AI 进入房间超时，请换一个对手或重试'), 30000);
  }
  emitMessage(value) {
    this.emit('message', value);
  }
  write(type, data) {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(packet(type, data));
  }
  fail(message) {
    if (this.closed) return;
    clearTimeout(this.timeout);
    this.closed = true;
    this.emitMessage({ type: 'fatal', message });
    this.socket.terminate();
  }
  receive({ type, data }) {
    if (type === 18) {
      this.write(2, deckPacket(this.deck).subarray(3));
      this.write(34);
      return;
    }
    if (type === 19) {
      if (!this.requested) {
        this.requested = true;
        this.write(22, utf16(this.bot.command ? `/ai ${this.bot.command}` : '/ai'));
      }
      return;
    }
    if (type === 32) {
      const player = data[40];
      const name = data.subarray(0, 40).toString('utf16le').replace(/\0.*$/s, '');
      if (player === 1) {
        this.opponent = name;
        this.emitMessage({ type: 'opponent', name });
      }
      return;
    }
    if (type === 33) {
      const seat = data[0] >> 4,
        status = data[0] & 15;
      if (seat === 1 && status === 9 && !this.startSent) {
        this.startSent = true;
        this.write(37);
      }
      return;
    }
    if (type === 3) {
      this.choice(
        '猜拳',
        [
          ['石头', 1],
          ['剪刀', 2],
          ['布', 3],
        ],
        3,
      );
      return;
    }
    if (type === 4) {
      this.choice(
        '选择先后手',
        [
          ['先攻', 1],
          ['后攻', 0],
        ],
        4,
      );
      return;
    }
    if (type === 24) {
      this.write(21);
      return;
    }
    if (type === 25) {
      const text = data.subarray(2).toString('utf16le').replace(/\0.*$/s, '');
      this.event('server', { text });
      if (/找不到|未找到|not found|创建失败|添加.*失败/i.test(text)) this.fail(text);
      return;
    }
    if (type === 2) {
      const errorType = data[0],
        code = data.length >= 8 ? data.readUInt32LE(4) : 0;
      this.fail(
        errorType === 4
          ? `服务器要求的协议版本不同（${code}）`
          : `AI 服务器拒绝了卡组或房间请求（${errorType}/${code}）`,
      );
      return;
    }
    if (type !== 1) return;
    const m = readGame(data);
    if (m.type === M.START) {
      this.human = m.playerType & 1;
      this.started = true;
      clearTimeout(this.timeout);
      if (this.human) {
        m.lp.reverse();
        m.sizes.reverse();
      }
      this.model.apply(m);
      this.send();
      return;
    }
    const normalize = (value) => {
      if (!value || typeof value !== 'object') return;
      for (const [k, v] of Object.entries(value)) {
        if (
          ['player', 'controller', 'triggering_controller'].includes(k) &&
          typeof v === 'number' &&
          v < 2
        )
          value[k] = v ^ this.human;
        else if (typeof v === 'object') normalize(v);
      }
    };
    normalize(m);
    if (m.type === M.RETRY) {
      this.selectionReset.stop();
      this.materialCommit.stop();
      this.pending = this.lastPending;
      this.emitMessage({
        type: 'input-error',
        player: 0,
        message: '服务器拒绝了该组合，请重新选择',
      });
      this.send();
      return;
    }
    const next = makePrompt(m, this.catalog, ++this.serial);
    if (next) {
      this.pending = next;
      const undo = this.materialCommit.next(next.prompt) || this.selectionReset.next(next.prompt);
      if (undo) {
        this.response(undo);
        return;
      }
      const notice = this.materialCommit.takeNotice() || this.selectionReset.takeNotice();
      if (notice) this.emitMessage({ type: 'input-error', player: 0, message: notice });
      if (next.prompt.kind === 'chain' && !next.prompt.options.length && next.prompt.canCancel) {
        this.response({ promptId: next.prompt.id, cancel: true });
        return;
      }
      if (this.hint && ['cards', 'sum', 'unselect'].includes(next.prompt.kind))
        next.prompt.title = this.hint;
      this.send();
      return;
    }
    if (m.type === M.HINT && m.hint_type === 3) this.hint = this.catalog.description(m.value);
    const motion = this.model.apply(m);
    if (motion)
      this.emitMessage({
        type: 'frame',
        viewer: 0,
        state: visibleState(this.model.state, 0),
        motion,
        duration: motionDuration(motion),
      });
    const e = { player: m.player, code: m.code, amount: m.amount, phase: m.phase };
    if (m.type === M.NEW_TURN)
      this.event('turn', { player: m.player, turn: this.model.state.turn });
    if (m.type === M.NEW_PHASE) this.event('phase', { phase: m.phase });
    if (m.type === M.DRAW) this.event('draw', { player: m.player, count: m.drawn.length });
    if ([M.SUMMONING, M.SPSUMMONING, M.FLIPSUMMONING].includes(m.type))
      this.event('summon', { code: m.code, player: m.controller });
    if (m.type === M.CHAINING) this.event('chain', { code: m.code, index: m.chain_size });
    if ([M.DAMAGE, M.PAY_LPCOST, M.RECOVER].includes(m.type))
      this.event(m.type === M.RECOVER ? 'recover' : 'damage', e);
    if (m.type === M.WIN) {
      this.pending = null;
      this.event('win', { winner: this.model.state.winner });
      this.send();
    }
    if (m.type === M.CONFIRM_CARDS && m.player === 0)
      this.event('reveal', { cards: m.cards, player: 0 });
  }
  choice(title, options, type) {
    clearTimeout(this.timeout);
    const id = ++this.serial;
    this.pending = {
      prompt: {
        id,
        player: 0,
        kind: 'choice',
        title,
        min: 1,
        max: 1,
        canCancel: false,
        options: options.map(([label, value], i) => ({ id: String(i), label, value })),
      },
      resolve: (input) => {
        if (input.promptId !== id || input.ids?.length !== 1) throw new Error('选项已过期');
        const item = this.pending.prompt.options.find((o) => o.id === input.ids[0]);
        if (!item) throw new Error('选项无效');
        return { wireType: type, value: item.value };
      },
    };
    this.send();
  }
  event(type, data) {
    this.emitMessage({
      type: 'event',
      viewers: [0],
      event: { type, id: ++this.serial, at: Date.now(), ...data },
    });
  }
  send() {
    this.emitMessage({
      type: 'view',
      viewer: 0,
      state: visibleState(this.model.state, 0),
      prompt: this.pending?.prompt || null,
    });
  }
  response(input) {
    if (!this.pending) return;
    try {
      input = this.selectionReset.begin(this.pending.prompt, input);
      if (input) input = this.materialCommit.begin(this.pending.prompt, input);
      if (!input) return this.send();
      const response = this.pending.resolve(input);
      if (response.wireType) this.write(response.wireType, Buffer.from([response.value]));
      else this.write(1, legacyResponse(response, this.human));
      this.lastPending = this.pending;
      this.pending = null;
      this.send();
    } catch (e) {
      this.emitMessage({ type: 'input-error', player: 0, message: e.message });
    }
  }
  postMessage(m) {
    if (m.type === 'response') this.response(m.input);
    if (m.type === 'snapshot') this.send();
    if (m.type === 'surrender') {
      this.write(20);
      this.model.state.ended = true;
      this.model.state.winner = 1;
      this.pending = null;
      this.send();
    }
    if (m.type === 'close') this.terminate();
  }
  terminate() {
    clearTimeout(this.timeout);
    this.closed = true;
    this.socket?.close();
    return Promise.resolve(0);
  }
}
