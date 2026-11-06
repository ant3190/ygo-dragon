import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  DoorOpen,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Star,
  Users,
} from 'lucide-react';
import { api } from '../lib';
import { CardImage, EmptyState } from '../components';
import type { Send } from '../main';
import type { Deck, Opponent, Room } from '../types';
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
  const [selected, setSelected] = useState(
      () => localStorage.getItem('dragon-active-deck') || decks[0]?.id || '',
    ),
    [opponents, setOpponents] = useState<Opponent[]>([]),
    [opponentId, setOpponent] = useState('Dragun'),
    [search, setSearch] = useState(''),
    [difficulty, setDifficulty] = useState('all'),
    [roomId, setRoomId] = useState(''),
    [roomName, setRoomName] = useState(''),
    [rooms, setRooms] = useState<Room[]>([]),
    [pending, setPending] = useState(false),
    [loadError, setLoadError] = useState(''),
    [favorites, setFavorites] = useState<string[]>(() => {
      try {
        return JSON.parse(localStorage.getItem('dragon-bot-favorites') || '["Dragun"]');
      } catch {
        return ['Dragun'];
      }
    });
  const online = mode === 'online',
    deck = decks.find((d) => d.id === selected) || decks[0],
    bot = opponents.find((o) => o.id === opponentId),
    valid = ready && connected && !!deck;
  const refresh = () => {
    setPending(true);
    void api('/rooms')
      .then((data) => setRooms(data.rooms))
      .catch((e) => notify(e.message))
      .finally(() => setPending(false));
  };
  useEffect(() => {
    if (online) {
      refresh();
      const t = setInterval(refresh, 10000);
      return () => clearInterval(t);
    }
    setLoadError('');
    void api('/opponents')
      .then((data) => setOpponents(data.opponents))
      .catch((e) => setLoadError(e.message));
  }, [online]);
  useEffect(() => {
    if (deck) localStorage.setItem('dragon-active-deck', deck.id);
  }, [deck?.id]);
  const visible = opponents
    .filter(
      (o) =>
        `${o.name} ${o.description} ${o.command}`.toLowerCase().includes(search.toLowerCase()) &&
        (difficulty === 'all' || difficulty === 'favorite'
          ? difficulty !== 'favorite' || favorites.includes(o.id)
          : o.tags.includes(difficulty)),
    )
    .sort((a, b) => Number(favorites.includes(b.id)) - Number(favorites.includes(a.id)));
  const favorite = (id: string) => {
    const next = favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id];
    setFavorites(next);
    localStorage.setItem('dragon-bot-favorites', JSON.stringify(next));
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{online ? '联机对战' : '单人对战'}</h1>
          <p>{online ? '双方进入同一个房间，准备后开始。' : '选择对手，然后确认出战卡组。'}</p>
        </div>
        {room && (
          <button className="button secondary" onClick={() => send({ type: 'leave' })}>
            <DoorOpen size={16} />
            离开房间
          </button>
        )}
      </div>
      {room ? (
        <section className="room-panel">
          <div className="room-title">
            <h2>{room.name}</h2>
            {room.mode === 'online' && (
              <button
                className="text-button mono"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(room.id)
                    .then(() => notify('房间码已复制'))
                    .catch(() => notify(room.id))
                }
              >
                {room.id}
                <Copy size={15} />
              </button>
            )}
          </div>
          <div className="room-seats">
            {[0, 1].map((i) => (
              <div className={`room-seat ${room.players[i]?.ready ? 'is-ready' : ''}`} key={i}>
                <span className="seat-number">{String(i + 1).padStart(2, '0')}</span>
                <h3>
                  {room.players[i]?.name ||
                    (i === 1 && room.mode === 'solo' ? room.opponent || 'AI 对手' : '等待对手')}
                </h3>
                <span className="muted small">
                  {room.players[i]
                    ? i === seat
                      ? '你'
                      : i === 0
                        ? '房主'
                        : '挑战者'
                    : room.mode === 'solo'
                      ? 'WindBot'
                      : '分享房间码邀请朋友'}
                </span>
                <span className="seat-ready">
                  {room.players[i]?.ready ? (
                    <>
                      <Check size={14} />
                      已准备
                    </>
                  ) : room.players[i] ? (
                    '准备中'
                  ) : room.mode === 'solo' ? (
                    '正在连接'
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
                value={deck?.id || ''}
                disabled={room.players[seat]?.ready || room.started}
                onChange={(e) => setSelected(e.target.value)}
              >
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            {!room.started && (
              <>
                <button
                  className="button secondary"
                  disabled={!valid}
                  onClick={() =>
                    send({ type: 'ready', deckId: deck?.id, ready: !room.players[seat]?.ready })
                  }
                >
                  {room.players[seat]?.ready ? '取消准备' : '准备'}
                </button>
                {seat === 0 && (
                  <button
                    className="button primary"
                    disabled={!room.players.every((p) => p?.ready)}
                    onClick={() => send({ type: 'start' })}
                  >
                    开始对战
                    <ArrowRight size={16} />
                  </button>
                )}
              </>
            )}
            {room.started && (
              <a className="button primary" href="#duel">
                返回对战
                <ArrowRight size={16} />
              </a>
            )}
          </div>
        </section>
      ) : online ? (
        <div className="online-layout">
          <section>
            <div className="section-heading">
              <h2>开放房间</h2>
              <button className="text-button" onClick={refresh}>
                {pending ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
                刷新
              </button>
            </div>
            {rooms.length ? (
              rooms.map((r) => (
                <div className="room-row" key={r.id}>
                  <Users size={19} />
                  <div>
                    <b>{r.name}</b>
                    <small className="mono muted">{r.id}</small>
                  </div>
                  <span className="muted small">{r.players.filter(Boolean).length}/2</span>
                  <button
                    className="button secondary"
                    disabled={r.players.every(Boolean)}
                    onClick={() => send({ type: 'join', roomId: r.id })}
                  >
                    加入
                  </button>
                </div>
              ))
            ) : (
              <EmptyState title="没有开放的房间" text="创建房间后，把房间码分享给朋友。" />
            )}
          </section>
          <aside className="match-setup">
            <h2>创建房间</h2>
            <label>
              房间名称
              <input
                value={roomName}
                onChange={(e) => setRoomName(e.target.value)}
                maxLength={32}
                placeholder="我的房间"
              />
            </label>
            <button
              className="button primary"
              disabled={!connected || !ready}
              onClick={() => send({ type: 'create', roomName })}
            >
              <Plus size={16} />
              创建
            </button>
            <div className="divider-label">加入好友房间</div>
            <label>
              房间码
              <input
                className="mono"
                value={roomId}
                maxLength={8}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                placeholder="8 位房间码"
              />
            </label>
            <button
              className="button secondary"
              disabled={!connected || roomId.length !== 8}
              onClick={() => send({ type: 'join', roomId })}
            >
              加入房间
              <ArrowRight size={16} />
            </button>
          </aside>
        </div>
      ) : (
        <div className="opponent-layout">
          <section className="opponent-browser">
            <div className="opponent-toolbar">
              <label className="search-input">
                <Search size={17} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索对手或卡组"
                  aria-label="搜索 AI 对手"
                />
              </label>
              <span className="muted small">{visible.length} 位对手</span>
            </div>
            <div className="filter-tabs" role="group" aria-label="对手分类">
              {[
                ['all', '全部'],
                ['favorite', '收藏'],
                ['AI_LV1', '入门'],
                ['AI_LV2', '简单'],
                ['AI_LV3', '进阶'],
                ['AI_LV4', '竞技'],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={difficulty === id ? 'active' : ''}
                  aria-pressed={difficulty === id}
                  onClick={() => setDifficulty(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="opponent-list">
              {visible.map((o) => (
                <div className={`opponent-row ${o.id === opponentId ? 'selected' : ''}`} key={o.id}>
                  <button className="opponent-select" onClick={() => setOpponent(o.id)}>
                    <span className="opponent-monogram">
                      {o.name.includes('我太帅') ? '帅' : o.name.slice(0, 1)}
                    </span>
                    <span>
                      <strong>{o.name}</strong>
                      <small>{o.description}</small>
                    </span>
                    {o.id === opponentId && <Check size={18} />}
                  </button>
                  <button
                    className={`icon-button favorite-button ${favorites.includes(o.id) ? 'is-favorite' : ''}`}
                    aria-label={`${favorites.includes(o.id) ? '取消收藏' : '收藏'}${o.name}`}
                    onClick={() => favorite(o.id)}
                  >
                    <Star size={15} fill={favorites.includes(o.id) ? 'currentColor' : 'none'} />
                  </button>
                </div>
              ))}
            </div>
            {loadError && <EmptyState title="无法读取对手列表" text={loadError} />}
            <p className="opponent-source small muted">
              对手表参考 MDPro3 的 WindBot 配置。服务器返回的昵称可能与对手表不同。
            </p>
          </section>
          <aside className="solo-ready">
            <div className="solo-deck-cover">
              <CardImage code={deck?.cover || deck?.main[0]} />
            </div>
            <label>
              出战卡组
              <select value={deck?.id || ''} onChange={(e) => setSelected(e.target.value)}>
                {decks.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <a className="text-button" href="#decks">
              编辑卡组
              <ChevronRightIcon />
            </a>
            <div className="solo-opponent">
              <span>对手</span>
              <b>{bot?.name || '请选择对手'}</b>
              <small>{bot?.description}</small>
            </div>
            <div className="solo-rule">
              <span>Master Rule 5</span>
              <span>8000 LP</span>
            </div>
            <button
              className="button primary"
              disabled={!valid || !bot}
              onClick={() => send({ type: 'solo', deckId: deck?.id, opponentId: bot?.id })}
            >
              开始对战
              <ArrowRight size={18} />
            </button>
            {!connected && <p className="small warning-text">正在恢复连接</p>}
            {!ready && <p className="small muted">卡库准备完成后即可开始</p>}
            <details className="local-practice-option">
              <summary>离线基础练习</summary>
              <p>无需外部服务器，使用本地基础出牌策略。</p>
              <button
                className="text-button"
                disabled={!valid}
                onClick={() => send({ type: 'practice', deckId: deck?.id })}
              >
                开始基础练习
                <ArrowRight size={14} />
              </button>
            </details>
          </aside>
        </div>
      )}
    </>
  );
}
function ChevronRightIcon() {
  return <ArrowRight size={13} />;
}
