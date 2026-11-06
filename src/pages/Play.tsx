import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  DoorOpen,
  LoaderCircle,
  Plus,
  RefreshCw,
  Swords,
  Users,
} from 'lucide-react';
import { api } from '../lib';
import { DeckTile, EmptyState } from '../components';
import type { Send } from '../main';
import type { Deck, Room } from '../types';

export function Play({
  mode,
  decks,
  room,
  connected,
  ready,
  seat,
  send,
  notify,
}: {
  mode: string;
  decks: Deck[];
  room: Room | null;
  connected: boolean;
  ready: boolean;
  seat: number;
  send: Send;
  notify: (text: string) => void;
}) {
  const [selected, setSelected] = useState(decks[0]?.id || ''),
    [botDeck, setBotDeck] = useState('starter-dark'),
    [rooms, setRooms] = useState<Room[]>([]),
    [roomId, setRoomId] = useState(''),
    [roomName, setRoomName] = useState(''),
    [pending, setPending] = useState(false);
  const online = mode === 'online';
  const refresh = () => {
    setPending(true);
    void api('/rooms')
      .then((data) => setRooms(data.rooms))
      .catch((e) => notify(e.message))
      .finally(() => setPending(false));
  };
  useEffect(() => {
    if (!selected && decks[0]) setSelected(decks[0].id);
  }, [decks]);
  useEffect(() => {
    if (!online || room) return;
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  }, [online, room?.id]);
  const valid = ready && connected && !!selected;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {online ? 'GOOD DUELS, GOOD COMPANY' : 'ONE MORE TURN, ONE MORE POSSIBILITY'}
          </span>
          <h1>
            {online ? '联机对战' : '单人对战'}
            <span className="title-dot">.</span>
          </h1>
          <p>{online ? '同一个房间，同一场精彩的决斗。' : '用一次练习，让每一步更有把握。'}</p>
        </div>
        <span className="quiet-label">
          {online ? <Users size={17} /> : <Swords size={17} />}
          {online ? '好友房间' : '基础练习对手'}
        </span>
      </div>
      {room ? (
        <section className="room-panel panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">DUEL ROOM</span>
              <h2>{room.name}</h2>
            </div>
            <button className="button secondary" onClick={() => send({ type: 'leave' })}>
              <DoorOpen size={16} />
              离开房间
            </button>
          </div>
          <div className="room-code">
            <span>房间码</span>
            <strong>{room.id}</strong>
            <button
              className="icon-button"
              aria-label="复制房间码"
              onClick={() => {
                void navigator.clipboard
                  .writeText(room.id)
                  .then(() => notify('房间码已复制'))
                  .catch(() => notify(`房间码：${room.id}`));
              }}
            >
              <Copy size={18} />
            </button>
          </div>
          <div className="room-seats">
            {[0, 1].map((i) => (
              <div className={`room-seat ${room.players[i]?.ready ? 'is-ready' : ''}`} key={i}>
                <span className="avatar large">{room.players[i]?.name.slice(0, 1) || '+'}</span>
                <h3>{room.players[i]?.name || '等待决斗者加入'}</h3>
                <p>
                  {room.players[i]
                    ? `${i === 0 ? '房主' : '挑战者'}${i === seat ? ' · 你' : ''}`
                    : '分享房间码邀请朋友'}
                </p>
                <span className="badge">
                  {room.players[i]?.ready ? (
                    <>
                      <Check size={13} />
                      已准备
                    </>
                  ) : room.players[i] ? (
                    room.players[i]!.connected ? (
                      '准备中'
                    ) : (
                      '已断线 · 等待重连'
                    )
                  ) : (
                    '空位'
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="room-controls">
            <label>
              出战卡组
              <select
                value={selected}
                disabled={room.players[seat]?.ready || room.started}
                onChange={(e) => setSelected(e.target.value)}
              >
                {decks.map((d) => (
                  <option value={d.id} key={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            {!room.started && (
              <>
                <button
                  className={`button ${room.players[seat]?.ready ? 'secondary' : 'primary'}`}
                  disabled={!valid}
                  onClick={() =>
                    send({ type: 'ready', deckId: selected, ready: !room.players[seat]?.ready })
                  }
                >
                  {room.players[seat]?.ready ? '取消准备' : '准备决斗'}
                  <Check size={16} />
                </button>
                {seat === 0 && (
                  <button
                    className="button primary"
                    disabled={!room.players.every((p) => p?.ready)}
                    onClick={() => send({ type: 'start' })}
                  >
                    开始对战
                    <ArrowRight size={17} />
                  </button>
                )}
              </>
            )}
            {room.started && (
              <a className="button primary" href="#duel">
                返回对局
                <ArrowRight size={17} />
              </a>
            )}
          </div>
        </section>
      ) : (
        <div className="play-layout">
          <section>
            <div className="section-heading">
              <h2>选择出战卡组</h2>
              <a href="#decks" className="text-button">
                管理卡组
                <ArrowRight size={15} />
              </a>
            </div>
            <div className="play-decks">
              {decks.map((d) => (
                <DeckTile
                  key={d.id}
                  deck={d}
                  selected={selected === d.id}
                  onClick={() => setSelected(d.id)}
                />
              ))}
            </div>
            {!decks.length && (
              <EmptyState
                title="先准备一副卡组"
                text="资源准备完成后会提供练习卡组，也可以导入自己的 YDK。"
              >
                <a href="#decks" className="button secondary">
                  前往卡组编辑
                </a>
              </EmptyState>
            )}
          </section>
          <aside className="match-setup panel">
            <span className="eyebrow">{online ? 'CREATE OR JOIN' : 'PRACTICE SETUP'}</span>
            <h2>{online ? '准备好交锋了吗' : '进入练习'}</h2>
            {online ? (
              <>
                <label>
                  房间名称
                  <input
                    value={roomName}
                    maxLength={32}
                    onChange={(e) => setRoomName(e.target.value)}
                    placeholder="我的决斗房间"
                  />
                </label>
                <button
                  className="button primary"
                  disabled={!connected || !ready}
                  onClick={() => send({ type: 'create', roomName })}
                >
                  <Plus size={17} />
                  创建房间
                </button>
                <div className="divider-label">或加入好友房间</div>
                <label>
                  房间码
                  <input
                    value={roomId}
                    onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                    maxLength={8}
                    placeholder="输入 8 位房间码"
                    className="mono"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && roomId.length === 8) send({ type: 'join', roomId });
                    }}
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={!connected || !ready || roomId.length !== 8}
                  onClick={() => send({ type: 'join', roomId })}
                >
                  加入房间
                  <ArrowRight size={16} />
                </button>
              </>
            ) : (
              <>
                <div className="setup-rule">
                  <span>规则</span>
                  <b>OCG / Master Rule 5</b>
                </div>
                <div className="setup-rule">
                  <span>初始生命值</span>
                  <b className="mono">8,000 LP</b>
                </div>
                <div className="setup-rule">
                  <span>先后手</span>
                  <b>我方先攻</b>
                </div>
                <label>
                  练习对手卡组
                  <select value={botDeck} onChange={(e) => setBotDeck(e.target.value)}>
                    {decks.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="small muted">
                  基础对手用于练习召唤、魔法与战斗。复杂展开建议使用联机对战。
                </p>
                <button
                  className="button primary"
                  disabled={!valid}
                  onClick={() => send({ type: 'solo', deckId: selected, botDeckId: botDeck })}
                >
                  <Swords size={17} />
                  开始单人对战
                  <ArrowRight size={17} />
                </button>
              </>
            )}
            {!ready && <p className="warning-text small">资源正在准备，完成后即可开始。</p>}
            {!connected && <p className="warning-text small">正在重新连接服务…</p>}
          </aside>
        </div>
      )}
      {online && !room && (
        <section className="available-rooms">
          <div className="section-heading">
            <h2>
              开放房间 <span>{rooms.length}</span>
            </h2>
            <button className="text-button" onClick={refresh}>
              {pending ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}刷新
            </button>
          </div>
          {rooms.length ? (
            rooms.map((r) => (
              <div className="room-row" key={r.id}>
                <Users size={20} />
                <div>
                  <b>{r.name}</b>
                  <small className="mono muted">{r.id}</small>
                </div>
                <span className="muted">{r.players.filter(Boolean).length} / 2</span>
                <button
                  className="button secondary compact"
                  disabled={r.players.every(Boolean)}
                  onClick={() => send({ type: 'join', roomId: r.id })}
                >
                  加入
                  <ArrowRight size={15} />
                </button>
              </div>
            ))
          ) : (
            <EmptyState title="还没有开放的房间" text="创建一个房间，把房间码分享给朋友。" />
          )}
        </section>
      )}
    </>
  );
}
