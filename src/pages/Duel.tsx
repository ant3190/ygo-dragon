import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clock3,
  Flag,
  Info,
  Layers3,
  List,
  LoaderCircle,
  Minus,
  RotateCcw,
  Swords,
  WifiOff,
  X,
} from 'lucide-react';
import { CardDetail, CardImage, Modal } from '../components';
import { locationLabel, phases, sumValid, useCard } from '../lib';
import type { Send } from '../main';
import type {
  DuelState,
  FieldCard,
  GameEvent,
  Option,
  Prompt,
  ResponseInput,
  Room,
  Settings,
} from '../types';

const sameSpot = (a: Partial<FieldCard>, b: Partial<FieldCard>) =>
  a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;
export function Duel({
  state,
  prompt,
  room,
  seat,
  events,
  connected,
  settings,
  onSettings,
  send,
  notify,
}: {
  state: DuelState;
  prompt: Prompt | null;
  room: Room | null;
  seat: number;
  events: GameEvent[];
  connected: boolean;
  settings: Settings;
  onSettings: (s: Settings) => void;
  send: Send;
  notify: (s: string) => void;
}) {
  const [inspect, setInspect] = useState(0),
    [active, setActive] = useState<FieldCard | null>(null),
    [selected, setSelected] = useState<string[]>([]),
    [submitting, setSubmitting] = useState(false),
    [pile, setPile] = useState<{ title: string; cards: (FieldCard | null)[] } | null>(null),
    [confirm, setConfirm] = useState<{ title: string; action: () => void } | null>(null),
    [showLog, setShowLog] = useState(false),
    [showInfo, setShowInfo] = useState(false);
  const lastAuto = useRef(0),
    responseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    setSelected([]);
    setSubmitting(false);
  }, [prompt?.id]);
  const respond = (input: Omit<ResponseInput, 'promptId'>) => {
    if (!prompt || submitting || !connected) return;
    setSubmitting(true);
    send({ type: 'response', input: { promptId: prompt.id, ...input } });
    clearTimeout(responseTimer.current);
    responseTimer.current = setTimeout(() => setSubmitting(false), 2500);
  };
  useEffect(() => {
    if (
      prompt?.kind === 'chain' &&
      prompt.canCancel &&
      (settings.chain === 'off' || (settings.chain === 'auto' && prompt.specialCount === 0)) &&
      lastAuto.current !== prompt.id
    ) {
      lastAuto.current = prompt.id;
      respond({ cancel: true });
    }
  }, [prompt?.id, settings.chain]);
  useEffect(() => () => clearTimeout(responseTimer.current), []);
  const choose = (id: string) =>
    setSelected((old) =>
      old.includes(id)
        ? old.filter((v) => v !== id)
        : prompt && old.length < prompt.max
          ? [...old, id]
          : prompt?.max === 1
            ? [id]
            : old,
    );
  const actions =
    prompt?.kind === 'actions' ? prompt.options.filter((o) => active && sameSpot(o, active)) : [];
  const phaseActions = prompt?.kind === 'actions' ? prompt.options.filter((o) => o.phase) : [];
  const mine = state.players[seat],
    theirs = state.players[1 - seat];
  const name = (player: number) =>
    room?.players[player]?.name || (player === seat ? settings.name : '练习对手');
  function clickCard(card: FieldCard) {
    setActive(card);
    if (card.code) setInspect(card.code);
    if (prompt?.kind === 'zones') {
      const option = prompt.options.find((o) => sameSpot(o, card));
      if (option) choose(option.id);
    }
  }
  function clickZone(controller: number, location: number, sequence: number) {
    const option =
      prompt?.kind === 'zones' &&
      prompt.options.find((o) => sameSpot(o, { controller, location, sequence }));
    if (option) choose(option.id);
  }
  function clearSelection() {
    if (prompt?.kind === 'unselect') respond({ clear: true });
    else setSelected([]);
  }
  const zone = (controller: number, location: number, sequence: number, label = '') => {
    const card = state.players[controller].zones[location]?.[sequence],
      option =
        prompt?.kind === 'zones'
          ? prompt.options.find((o) => sameSpot(o, { controller, location, sequence }))
          : null;
    return (
      <button
        key={`${controller}-${location}-${sequence}`}
        className={`field-zone ${controller === seat ? 'own' : 'opponent'} ${option ? 'available' : ''} ${option && selected.includes(option.id) ? 'chosen' : ''} ${card && active && sameSpot(card, active) ? 'active' : ''}`}
        aria-label={
          card?.code
            ? `查看卡片 ${card.code}`
            : `${controller === seat ? '我方' : '对方'}${label || locationLabel[location]} ${sequence + 1}`
        }
        onClick={() => (card ? clickCard(card) : clickZone(controller, location, sequence))}
        onContextMenu={(e) => {
          if (prompt?.kind === 'zones') {
            e.preventDefault();
            clearSelection();
          }
        }}
      >
        {card ? (
          <>
            <div className={`field-card ${card.position & 12 ? 'defense' : ''}`}>
              <CardImage code={card.code} back={!card.code || !(card.position & 5)} />
            </div>
            {location === 4 && !!(card.position & 5) && (
              <span className="field-card-stats">
                <b>{card.attack ?? '?'}</b>
                <span>/</span>
                <span>{card.link?.rating ? `L${card.link.rating}` : (card.defense ?? '?')}</span>
              </span>
            )}
            {!!card.overlayCards?.length && (
              <span className="material-count">{card.overlayCards.length}</span>
            )}
          </>
        ) : (
          <span className="zone-label">
            {label || (location === 4 ? 'M' : 'S / T')}
            {!label && <small>{sequence + 1}</small>}
          </span>
        )}
        {option && (
          <span className="zone-select-mark">
            {selected.includes(option.id) ? <Check size={15} /> : <PlusMark />}
          </span>
        )}
      </button>
    );
  };
  const pileButton = (controller: number, location: number, label: string) => {
    const cards = state.players[controller].zones[location] || [],
      top = cards.filter(Boolean).at(-1);
    return (
      <button
        className={`field-pile ${controller === seat ? 'own' : 'opponent'}`}
        onClick={() =>
          setPile({ title: `${controller === seat ? '我方' : '对方'} · ${label}`, cards })
        }
        aria-label={`查看${controller === seat ? '我方' : '对方'}${label}，${cards.filter(Boolean).length}张`}
      >
        <span className="pile-card">
          {cards.length ? (
            <CardImage
              code={top?.code}
              back={location === 1 || !top?.code || !!((top.position || 0) & 10)}
            />
          ) : (
            <Layers3 size={22} strokeWidth={1} />
          )}
        </span>
        <span className="pile-label">
          {label}
          <b>{cards.filter(Boolean).length}</b>
        </span>
      </button>
    );
  };
  const row = (player: number, location: number, left: React.ReactNode, right: React.ReactNode) => (
    <div className="field-row" key={`${player}-${location}`}>
      {left}
      {Array.from({ length: 5 }, (_, i) => (player === seat ? i : 4 - i)).map((i) =>
        zone(player, location, i),
      )}
      {right}
    </div>
  );
  const phaseButton = (option: Option) => (
    <button
      key={option.id}
      className={`button ${option.phase === 'end' ? 'primary' : 'secondary'}`}
      disabled={submitting || !connected}
      onClick={() =>
        option.phase === 'end' && settings.confirmEnd
          ? setConfirm({ title: '结束当前回合？', action: () => respond({ ids: [option.id] }) })
          : respond({ ids: [option.id] })
      }
    >
      {option.label}
      <ArrowRight size={15} />
    </button>
  );
  return (
    <div
      className="duel-screen"
      onContextMenu={(e) => {
        if (prompt && prompt.kind !== 'actions') {
          e.preventDefault();
          clearSelection();
        }
      }}
    >
      <header className="duel-topbar">
        <a href={room?.mode === 'online' ? '#online' : '#home'} className="text-button">
          <ArrowLeft size={17} />
          大厅
        </a>
        <span className="duel-wordmark">
          DRAGON<span>/ DUEL</span>
        </span>
        <div className="duel-topbar-actions">
          <span className="small muted mono">{room?.id}</span>
          <button
            className="icon-button info-toggle"
            aria-label="查看卡片信息"
            onClick={() => setShowInfo(!showInfo)}
          >
            <Info size={18} />
          </button>
          <button
            className="icon-button"
            aria-label="查看对局记录"
            onClick={() => setShowLog(true)}
          >
            <List size={18} />
          </button>
          <button
            className="text-button danger-text"
            onClick={() =>
              setConfirm({
                title: state.ended ? '离开当前对局？' : '确认认输并离开？',
                action: () => send({ type: 'leave' }),
              })
            }
          >
            <Flag size={15} />
            {state.ended ? '离开' : '认输'}
          </button>
        </div>
      </header>
      {!connected && (
        <div className="duel-reconnect" role="status">
          <WifiOff size={15} />
          连接中断，正在恢复当前对局…
        </div>
      )}
      <div className="duel-layout">
        <aside className="duel-inspector">
          <CardDetail code={inspect || active?.code}>
            <div className="inspector-actions">
              {actions.length ? (
                actions.map((o) => (
                  <button
                    key={o.id}
                    className="button secondary"
                    disabled={submitting || !connected}
                    onClick={() => respond({ ids: [o.id] })}
                  >
                    {o.label}
                    <ArrowRight size={15} />
                  </button>
                ))
              ) : (
                <p className="small muted">
                  {prompt?.kind === 'actions'
                    ? '点击手牌或场上的卡片，查看可用行动。'
                    : '根据当前提示选择卡片或区域。'}
                </p>
              )}
            </div>
          </CardDetail>
        </aside>
        <section className="duel-arena">
          <div className="duel-scoreboard">
            <div className="player-score own">
              <span className="player-avatar">{name(seat).slice(0, 1)}</span>
              <div>
                <b>{name(seat)}</b>
                <span className="lp-value mono">
                  {mine.lp.toLocaleString()}
                  <small>LP</small>
                </span>
                <div className="lp-track">
                  <span style={{ width: `${Math.min(100, mine.lp / 80)}%` }} />
                </div>
              </div>
            </div>
            <div className="turn-info">
              <span className="eyebrow">TURN {String(state.turn).padStart(2, '0')}</span>
              <b>{state.turnPlayer === seat ? '你的回合' : '对方回合'}</b>
              <small>{phases[state.phase] || '阶段处理中'}</small>
            </div>
            <div className="player-score opponent">
              <div>
                <b>{name(1 - seat)}</b>
                <span className="lp-value mono">
                  {theirs.lp.toLocaleString()}
                  <small>LP</small>
                </span>
                <div className="lp-track">
                  <span style={{ width: `${Math.min(100, theirs.lp / 80)}%` }} />
                </div>
              </div>
              <span className="player-avatar">{name(1 - seat).slice(0, 1)}</span>
            </div>
          </div>
          <div className="opponent-hand" aria-label={`对方手牌 ${theirs.zones[2]?.length || 0} 张`}>
            {theirs.zones[2]?.map((_, i) => (
              <span key={i}>
                <CardImage back />
              </span>
            ))}
            <small>{theirs.zones[2]?.length || 0} 张手牌</small>
          </div>
          <div className="duel-field">
            <div className="field-owner-label opponent">
              <span />
              对方场地
            </div>
            {row(1 - seat, 8, zone(1 - seat, 8, 5, '场地'), pileButton(1 - seat, 64, '额外'))}
            {row(1 - seat, 4, pileButton(1 - seat, 1, '卡组'), pileButton(1 - seat, 16, '墓地'))}
            <div className="extra-zone-row">
              <div className="field-caption">MASTER RULE 5</div>
              <div className="extra-zone-slot">
                {state.players[seat].zones[4]?.[5] ? (
                  zone(seat, 4, 5, 'EX')
                ) : state.players[1 - seat].zones[4]?.[6] ? (
                  zone(1 - seat, 4, 6, 'EX')
                ) : (
                  <>
                    {zone(seat, 4, 5, 'EX')}
                    {prompt?.kind === 'zones' &&
                      prompt.options.some((o) =>
                        sameSpot(o, { controller: 1 - seat, location: 4, sequence: 6 }),
                      ) &&
                      zone(1 - seat, 4, 6, 'EX')}
                  </>
                )}
              </div>
              <span className="field-axis">DRAGON</span>
              <div className="extra-zone-slot">
                {state.players[seat].zones[4]?.[6] ? (
                  zone(seat, 4, 6, 'EX')
                ) : state.players[1 - seat].zones[4]?.[5] ? (
                  zone(1 - seat, 4, 5, 'EX')
                ) : (
                  <>
                    {zone(seat, 4, 6, 'EX')}
                    {prompt?.kind === 'zones' &&
                      prompt.options.some((o) =>
                        sameSpot(o, { controller: 1 - seat, location: 4, sequence: 5 }),
                      ) &&
                      zone(1 - seat, 4, 5, 'EX')}
                  </>
                )}
              </div>
              <div className="banished-piles">
                {[1 - seat, seat].map((player) => (
                  <button
                    key={player}
                    className={`banished-count ${player === seat ? 'own' : 'opponent'}`}
                    onClick={() =>
                      setPile({
                        title: `${player === seat ? '我方' : '对方'} · 除外`,
                        cards: state.players[player].zones[32] || [],
                      })
                    }
                  >
                    除外 <b>{state.players[player].zones[32]?.length || 0}</b>
                  </button>
                ))}
              </div>
            </div>
            {row(seat, 4, pileButton(seat, 64, '额外'), pileButton(seat, 16, '墓地'))}
            {row(seat, 8, zone(seat, 8, 5, '场地'), pileButton(seat, 1, '卡组'))}
            <div className="field-owner-label own">
              <span />
              我方场地
            </div>
          </div>
          <div className="my-hand" aria-label="我方手牌">
            {mine.zones[2]?.map(
              (card, i) =>
                card && (
                  <button
                    key={`${i}-${card.code}`}
                    className={`hand-card ${active && sameSpot(active, card) ? 'active' : ''} ${prompt?.kind === 'actions' && prompt.options.some((o) => sameSpot(o, card)) ? 'playable' : ''}`}
                    onClick={() => clickCard(card)}
                    title="点击查看可用行动"
                  >
                    <CardImage code={card.code} />
                    {prompt?.kind === 'actions' &&
                      prompt.options.some((o) => sameSpot(o, card)) && (
                        <span className="playable-dot" />
                      )}
                  </button>
                ),
            )}
          </div>
          <div className="arena-controls">
            <div className="chain-modes" role="group" aria-label="连锁询问模式">
              {[
                ['off', '跳过'],
                ['auto', '自动'],
                ['all', '全时点'],
              ].map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={settings.chain === value}
                  className={settings.chain === value ? 'active' : ''}
                  onClick={() => onSettings({ ...settings, chain: value as Settings['chain'] })}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="turn-status">
              {submitting ? <LoaderCircle size={14} className="spin" /> : <Clock3 size={14} />}
              <span>
                {state.ended
                  ? '对局结束'
                  : prompt?.title || (state.turnPlayer === seat ? '等待效果处理' : '对方正在操作')}
              </span>
            </div>
            <button className="text-button" onClick={() => setShowLog(true)}>
              <List size={15} />
              记录
            </button>
          </div>
          {!!actions.length && (
            <div className="mobile-card-actions">
              {actions.map((o) => (
                <button
                  key={o.id}
                  className="button secondary"
                  onClick={() => respond({ ids: [o.id] })}
                  disabled={submitting || !connected}
                >
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {!!phaseActions.length && (
            <div className="mobile-phase-actions">{phaseActions.map(phaseButton)}</div>
          )}
        </section>
        <aside className="duel-action-pane">
          <div className="section-heading">
            <h3>当前阶段</h3>
            <Swords size={16} />
          </div>
          <div className="phase-steps">
            {[
              [1, '抽卡'],
              [2, '准备'],
              [4, '主要 1'],
              [16, '战斗'],
              [256, '主要 2'],
              [512, '结束'],
            ].map(([phase, label]) => (
              <span
                key={phase}
                className={
                  state.phase === phase || (phase === 16 && state.phase >= 8 && state.phase <= 128)
                    ? 'active'
                    : ''
                }
              >
                {label}
              </span>
            ))}
          </div>
          <div className="phase-actions">
            {phaseActions.map(phaseButton)}
            {!phaseActions.length && (
              <p className="small muted">
                {prompt ? '完成当前选择后继续' : state.ended ? '对局已结束' : '等待对方操作'}
              </p>
            )}
          </div>
          {!!state.chain.length && (
            <div className="chain-stack">
              <h3>连锁</h3>
              {state.chain.map((c) => (
                <div key={c.index}>
                  <span className="chain-number">{c.index}</span>
                  <CardName code={c.code} />
                </div>
              ))}
            </div>
          )}
          <div className="duel-log-preview">
            <div className="section-heading">
              <h3>决斗记录</h3>
              <button
                className="icon-button"
                aria-label="展开对局记录"
                onClick={() => setShowLog(true)}
              >
                <List size={16} />
              </button>
            </div>
            {events.slice(-7).map((e) => (
              <EventLine key={e.id} event={e} seat={seat} />
            ))}
          </div>
        </aside>
      </div>
      {prompt && prompt.kind !== 'actions' && !state.ended && (
        <Selection
          key={prompt.id}
          prompt={prompt}
          seat={seat}
          selected={selected}
          choose={choose}
          clear={clearSelection}
          respond={respond}
          busy={submitting || !connected}
          inspect={setInspect}
        />
      )}
      {state.ended && (
        <div className="duel-result">
          <span className="eyebrow">DUEL FINISHED</span>
          <h2>{state.winner === null ? '平局' : state.winner === seat ? '胜利' : '对局结束'}</h2>
          <p>
            {state.winner === seat
              ? '漂亮的决策，值得再来一场。'
              : '每一场决斗，都是下一次的起点。'}
          </p>
          <button className="button primary" onClick={() => send({ type: 'leave' })}>
            返回大厅
            <ArrowRight size={17} />
          </button>
          <button className="text-button" onClick={() => setShowLog(true)}>
            查看决斗记录
          </button>
        </div>
      )}
      {pile && (
        <Modal title={pile.title} className="pile-modal" onClose={() => setPile(null)}>
          <div className="pile-card-list">
            {pile.cards
              .filter((c): c is FieldCard => !!c)
              .map((card, i) => (
                <button
                  className="pile-list-card"
                  key={i}
                  onClick={() => {
                    if (card.code) {
                      setInspect(card.code);
                      setShowInfo(true);
                    }
                  }}
                >
                  <CardImage code={card.code} back={!card.code} />
                  <span>{card.code ? <CardName code={card.code} /> : '未知卡片'}</span>
                </button>
              ))}
          </div>
          {!pile.cards.length && <p className="muted">这个区域没有卡片。</p>}
          <p className="small muted">点击卡片查看效果。隐藏的卡片只显示卡背。</p>
        </Modal>
      )}
      {showInfo && (
        <Modal title="卡片详情" className="info-modal" onClose={() => setShowInfo(false)}>
          <CardDetail code={inspect} />
        </Modal>
      )}
      {showLog && (
        <Modal title="决斗记录" className="log-modal" onClose={() => setShowLog(false)}>
          <div className="full-log">
            {events.map((e) => (
              <EventLine key={e.id} event={e} seat={seat} />
            ))}
          </div>
        </Modal>
      )}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="muted">
            {confirm.title.includes('回合')
              ? '确认后将继续处理结束阶段的效果。'
              : '你可以在大厅重新开始一场对局。'}
          </p>
          <div className="modal-actions">
            <button className="button secondary" onClick={() => setConfirm(null)}>
              取消
            </button>
            <button
              className="button primary"
              onClick={() => {
                confirm.action();
                setConfirm(null);
              }}
            >
              确认
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
function PlusMark() {
  return <span>＋</span>;
}
function CardName({ code }: { code?: number }) {
  const card = useCard(code);
  return <>{card?.name || (code ? `卡片 ${code}` : '未知卡片')}</>;
}
function EventLine({ event: e, seat }: { event: GameEvent; seat: number }) {
  const player = e.player === seat ? '我方' : '对方';
  let text: React.ReactNode = '';
  if (e.type === 'turn') text = `${player}回合 · TURN ${e.turn}`;
  if (e.type === 'phase') text = `进入${phases[e.phase || 0] || '下一'}阶段`;
  if (e.type === 'summon')
    text = (
      <>
        {player}召唤「
        <CardName code={e.code} />」
      </>
    );
  if (e.type === 'draw') text = `${player}抽 ${e.count} 张卡`;
  if (e.type === 'damage') text = `${player} LP −${e.amount}`;
  if (e.type === 'recover') text = `${player} LP ＋${e.amount}`;
  if (e.type === 'chain')
    text = (
      <>
        连锁发动「
        <CardName code={e.code} />」
      </>
    );
  if (e.type === 'resolve') text = '连锁处理中';
  if (e.type === 'attack') text = '宣言攻击';
  if (e.type === 'reveal')
    text = (
      <>
        展示：
        {e.cards?.map((card, i) => (
          <span key={i}>
            「<CardName code={card.code} />」
          </span>
        ))}
      </>
    );
  if (e.type === 'win') text = e.winner === seat ? '我方获得胜利' : '对局结束';
  return text ? (
    <div className={`event-line event-${e.type}`}>
      <span className="event-dot" />
      <p>{text}</p>
    </div>
  ) : null;
}
function Selection({
  prompt: p,
  seat,
  selected,
  choose,
  clear,
  respond,
  busy,
  inspect,
}: {
  prompt: Prompt;
  seat: number;
  selected: string[];
  choose: (id: string) => void;
  clear: () => void;
  respond: (input: Omit<ResponseInput, 'promptId'>) => void;
  busy: boolean;
  inspect: (code: number) => void;
}) {
  const [search, setSearch] = useState(''),
    [counts, setCounts] = useState(p.options.map(() => 0));
  const incremental = p.kind === 'unselect',
    visible = p.options
      .filter((o) => !search || `${o.label} ${o.code}`.includes(search))
      .slice(0, 100);
  const valid =
    selected.length >= p.min &&
    selected.length <= p.max &&
    (p.kind !== 'sum' ||
      sumValid(
        [...(p.mandatory || []), ...p.options.filter((o) => selected.includes(o.id))],
        p.amount || 0,
        p.greater,
      ));
  if (p.kind === 'zones')
    return (
      <div className="zone-prompt-bar">
        <div>
          <b>{p.title}</b>
          <span className="muted small">
            点击高亮区域 · 已选 {selected.length} / {p.max}
          </span>
        </div>
        <button className="button secondary" onClick={clear} disabled={busy}>
          重选
        </button>
        <button
          className="button primary"
          disabled={!valid || busy}
          onClick={() => respond({ ids: selected })}
        >
          确认区域
          <Check size={17} />
        </button>
      </div>
    );
  if (p.kind === 'yesno')
    return (
      <div className="effect-prompt" role="dialog" aria-label={p.title}>
        <div className="effect-prompt-title">
          <span className="connection-dot" />
          <h3>{p.title}</h3>
        </div>
        <div className="button-group">
          {[...p.options].reverse().map((o, i) => (
            <button
              key={o.id}
              className={`button ${i === 0 ? 'secondary' : 'primary'}`}
              disabled={busy}
              onClick={() => respond({ ids: [o.id] })}
            >
              {i === 0 ? '不发动 / 否' : '发动 / 是'}
            </button>
          ))}
        </div>
      </div>
    );
  return (
    <div className="selection-overlay">
      <div
        className="selection-dialog"
        role="dialog"
        aria-label={p.title}
        aria-modal="true"
        onContextMenu={(e) => {
          e.preventDefault();
          clear();
        }}
      >
        <div className="selection-heading">
          <div>
            <span className="eyebrow">
              {incremental
                ? 'SELECT MATERIALS'
                : p.kind === 'chain'
                  ? 'CHAIN RESPONSE'
                  : 'MAKE YOUR CHOICE'}
            </span>
            <h2>{p.title}</h2>
          </div>
          <div className="selection-count">
            {incremental ? p.options.filter((o) => o.selected).length : selected.length}
            <span>
              {' '}
              已选{!incremental && ` / ${p.min === p.max ? p.max : `${p.min}–${p.max}`}`}
            </span>
          </div>
        </div>
        {p.kind === 'announce' && (
          <label className="search-input">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索卡名或密码"
              aria-label="搜索宣言卡片"
            />
          </label>
        )}
        {!!p.mandatory?.length && (
          <p className="small muted">
            必选素材：
            {p.mandatory.map((o, i) => (
              <span key={i}>
                「<CardName code={o.code} />」{' '}
              </span>
            ))}
          </p>
        )}
        <div
          className={`selection-options ${visible.some((o) => o.code) ? 'has-cards' : 'text-options'}`}
        >
          {visible.map((o, i) =>
            p.kind === 'counter' ? (
              <div className="counter-option" key={o.id}>
                <CardImage code={o.code} />
                <span>
                  <CardName code={o.code} />
                </span>
                <label>
                  移除数量
                  <input
                    type="number"
                    min={0}
                    max={o.capacity}
                    value={counts[i]}
                    onChange={(e) =>
                      setCounts((old) =>
                        old.map((v, j) =>
                          j === i
                            ? Math.max(0, Math.min(o.capacity || 0, Number(e.target.value)))
                            : v,
                        ),
                      )
                    }
                  />
                </label>
              </div>
            ) : (
              <button
                key={o.id}
                className={`selection-option ${o.controller === undefined || o.controller === seat ? 'own' : 'opponent'} ${(incremental ? o.selected : selected.includes(o.id)) ? 'selected' : ''} ${o.code ? 'with-card' : ''}`}
                disabled={busy}
                onClick={() => {
                  if (o.code) inspect(o.code);
                  if (incremental) respond({ ids: [o.id] });
                  else choose(o.id);
                }}
              >
                {o.code && <CardImage code={o.code} />}
                <span className="selection-option-label">
                  {p.kind === 'actions' || p.kind === 'chain' ? (
                    <>
                      <CardName code={o.code} />
                      <small>{o.description || o.label}</small>
                    </>
                  ) : (
                    o.label
                  )}
                </span>
                {o.location && (
                  <small className="selection-source">
                    {o.controller === seat ? '我方' : '对方'} · {locationLabel[o.location]}
                  </small>
                )}
                <span className="selection-check">
                  {p.kind === 'sort' && selected.includes(o.id) ? (
                    selected.indexOf(o.id) + 1
                  ) : (
                    <Check size={13} />
                  )}
                </span>
              </button>
            ),
          )}
        </div>
        {p.kind === 'sum' && (
          <p className="selection-hint">目标数值：{p.amount} · 确认前可自由增减素材。</p>
        )}
        {p.kind === 'sort' && (
          <p className="selection-hint">按需要的顺序点击卡片，确认后提交顺序。</p>
        )}
        {incremental && (
          <p className="selection-hint">点击可连续选择或撤回素材，满足条件后统一确认。</p>
        )}
        <div className="selection-footer">
          <div className="button-group">
            {p.canCancel && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => respond({ cancel: true })}
              >
                {p.kind === 'chain' ? '不连锁' : '取消'}
              </button>
            )}
            <button className="text-button" disabled={busy} onClick={clear}>
              <RotateCcw size={15} />
              清空选择
            </button>
          </div>
          <button
            className="button primary"
            disabled={
              busy ||
              (incremental
                ? !p.canFinish
                : p.kind === 'counter'
                  ? counts.reduce((a, b) => a + b, 0) !== p.amount
                  : !valid)
            }
            onClick={() =>
              respond(
                incremental
                  ? { finish: true }
                  : p.kind === 'counter'
                    ? { counts }
                    : { ids: selected },
              )
            }
          >
            {busy ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}确认
            {incremental ? '素材' : '选择'}
          </button>
        </div>
      </div>
    </div>
  );
}
