import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Flag,
  Info,
  Layers3,
  List,
  LoaderCircle,
  Menu,
  RotateCcw,
  Search,
  Settings2,
  Shield,
  Sparkles,
  Swords,
  X,
} from 'lucide-react';
import { CardDetail, CardImage, Modal } from '../components';
import { locationLabel, phases, sumValid, useCard } from '../lib';
import { useCardMotion } from '../duel/motion';
import type { Send } from '../main';
import type {
  DuelState,
  FieldCard,
  GameEvent,
  Motion,
  Option,
  Prompt,
  ResponseInput,
  Room,
  Settings,
} from '../types';
const spot = (c: Partial<FieldCard>) => `${c.controller}-${c.location}-${c.sequence}`;
const same = (a: Partial<FieldCard>, b: Partial<FieldCard>) =>
  a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;
const multiKinds = ['cards', 'sum', 'sort', 'attributes'];
function cardKey(c: FieldCard) {
  return c.uid || `hidden-${spot(c)}`;
}
function optionKey(o: Option) {
  return `${spot(o)}-${o.code || o.label}-${o.action ?? ''}`;
}
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
  motion,
  animating,
  fatal,
  inputEpoch,
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
  motion: Motion | null;
  animating: boolean;
  fatal: string;
  inputEpoch: number;
}) {
  const root = useRef<HTMLDivElement>(null),
    [inspect, setInspect] = useState(0),
    [active, setActive] = useState<FieldCard | null>(null),
    [anchor, setAnchor] = useState({ x: 0, y: 0 }),
    [selected, setSelected] = useState<string[]>([]),
    [submitting, setSubmitting] = useState(false),
    [browse, setBrowse] = useState<{ player: number; location: number } | null>(null),
    [phaseOpen, setPhaseOpen] = useState(false),
    [phaseConfirm, setPhaseConfirm] = useState<Option | null>(null),
    [menuOpen, setMenuOpen] = useState(false),
    [confirmLeave, setConfirmLeave] = useState(false),
    [showInfo, setShowInfo] = useState(false),
    [logOpen, setLogOpen] = useState(false),
    [held, setHeld] = useState<'all' | 'off' | null>(null),
    [collapsed, setCollapsed] = useState(false);
  const lastResponse = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    lastPrompt = useRef<Prompt | null>(null);
  const locked = !connected || submitting || animating || state.ended || !!fatal;
  useCardMotion(root, state, motion, settings.motion);
  useEffect(() => {
    if (!prompt) {
      setActive(null);
      return;
    }
    setSubmitting(false);
    setSelected([]);
    setActive(null);
    setPhaseOpen(false);
    setPhaseConfirm(null);
    if (prompt.kind !== 'unselect' || lastPrompt.current?.kind !== 'unselect') {
      const fieldOnly =
        ['cards', 'sum', 'unselect', 'chain'].includes(prompt.kind) &&
        prompt.options.length > 0 &&
        prompt.options.every((o) => o.location === 4 || o.location === 8);
      setCollapsed(fieldOnly);
    }
    lastPrompt.current = prompt;
  }, [prompt?.id]);
  useEffect(() => {
    setSubmitting(false);
  }, [inputEpoch]);
  const respond = useCallback(
    (input: Omit<ResponseInput, 'promptId'>) => {
      if (!prompt || locked) return;
      setSubmitting(true);
      setActive(null);
      setBrowse(null);
      setPhaseOpen(false);
      send({ type: 'response', input: { promptId: prompt.id, ...input } });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setSubmitting(false), 4000);
    },
    [prompt, locked, send],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  const effectiveChain = held || settings.chain;
  useEffect(() => {
    if (
      !prompt ||
      locked ||
      prompt.kind !== 'chain' ||
      !prompt.canCancel ||
      lastResponse.current === prompt.id
    )
      return;
    if (effectiveChain === 'off' || (effectiveChain === 'auto' && prompt.specialCount === 0)) {
      lastResponse.current = prompt.id;
      respond({ cancel: true });
    }
  }, [prompt?.id, effectiveChain, locked]);
  const options = prompt?.options || [],
    selectedOptions =
      prompt?.kind === 'unselect'
        ? options.filter((o) => !!o.selected !== selected.includes(o.id))
        : options.filter((o) => selected.includes(o.id));
  const canConfirm =
    !!prompt &&
    (prompt.kind === 'unselect'
      ? !!prompt.canFinish || selected.length > 0
      : selected.length >= prompt.min &&
        selected.length <= prompt.max &&
        (prompt.kind !== 'sum' ||
          sumValid(
            [...(prompt.mandatory || []), ...selectedOptions],
            prompt.amount || 0,
            prompt.greater,
          )));
  const choose = (option: Option) => {
    if (locked) return;
    if (prompt?.kind === 'unselect') {
      setSelected((old) =>
        old.includes(option.id) ? old.filter((id) => id !== option.id) : [...old, option.id],
      );
      return;
    }
    setSelected((old) =>
      old.includes(option.id)
        ? old.filter((id) => id !== option.id)
        : prompt?.max === 1
          ? [option.id]
          : old.length < (prompt?.max || 1)
            ? [...old, option.id]
            : old,
    );
  };
  const resetSelection = () => {
    setSelected([]);
    if (prompt?.kind === 'unselect' && options.some((o) => o.selected)) respond({ clear: true });
  };
  const cancel = () => {
    if (prompt?.kind === 'unselect') {
      setSelected([]);
      if (options.some((o) => o.selected)) respond({ clear: true, cancelAll: true });
      else if (prompt.canCancel) respond({ cancel: true });
    } else if (prompt?.canCancel) respond({ cancel: true });
    else resetSelection();
  };
  const back = useCallback(() => {
    if (showInfo) {
      setShowInfo(false);
      return;
    }
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    if (browse) {
      setBrowse(null);
      return;
    }
    if (phaseOpen) {
      setPhaseOpen(false);
      setPhaseConfirm(null);
      return;
    }
    if (active) {
      setActive(null);
      return;
    }
    if (locked) return;
    if (selected.length) {
      setSelected((old) => old.slice(0, -1));
      return;
    }
    if (prompt?.kind === 'unselect') {
      const last = prompt.options.filter((o) => o.selected).at(-1);
      if (last) {
        setSelected([last.id]);
        return;
      }
    }
    if (prompt?.canCancel && !locked) respond({ cancel: true });
  }, [showInfo, menuOpen, browse, phaseOpen, active, prompt, selected, locked, respond]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        back();
      }
      if (e.key === 'Enter' && !e.repeat && canConfirm && !locked) {
        e.preventDefault();
        respond(prompt?.kind === 'unselect' ? { materialIds: selected } : { ids: selected });
      }
    };
    const release = () => setHeld(null);
    window.addEventListener('keydown', key);
    window.addEventListener('pointerup', release);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('blur', release);
    };
  }, [back, canConfirm, locked, prompt, selected, respond]);
  const activate = (card: FieldCard, event: React.MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (card.code) setInspect(card.code);
    const option = prompt?.kind !== 'actions' ? options.find((o) => same(o, card)) : undefined;
    if (option) {
      choose(option);
      return;
    }
    if (prompt?.kind === 'actions' && options.some((o) => same(o, card)) && !locked) {
      const rect = event.currentTarget.getBoundingClientRect();
      setAnchor({ x: rect.left + rect.width / 2, y: rect.top });
      setActive(card);
    } else setActive(null);
  };
  const actions =
      prompt?.kind === 'actions' && active ? options.filter((o) => same(o, active)) : [],
    phaseActions = prompt?.kind === 'actions' ? options.filter((o) => o.phase) : [];
  const label = (player: number) =>
    player === seat
      ? room?.players[seat]?.name || settings.name
      : room?.players[1 - seat]?.name || room?.opponent || 'AI 对手';
  const mine = state.players[seat],
    other = state.players[1 - seat];
  const selectCount = prompt?.kind === 'unselect' ? selectedOptions.length : selected.length;
  const clickBlank = (player: number, location: number, sequence: number) => {
    const option =
      prompt?.kind === 'zones' &&
      options.find((o) => same(o, { controller: player, location, sequence }));
    if (option) choose(option);
    else setActive(null);
  };
  const tile = (player: number, location: number, sequence: number) => {
    const card = state.players[player].zones[location]?.[sequence],
      option =
        prompt && prompt.kind !== 'actions'
          ? options.find((o) => same(o, { controller: player, location, sequence }))
          : undefined;
    const chosen = option && selectedOptions.some((o) => o.id === option.id),
      usable =
        prompt?.kind === 'actions' &&
        options.some((o) => same(o, { controller: player, location, sequence }));
    return (
      <button
        key={`${player}-${location}-${sequence}`}
        className={`md-zone ${player === seat ? 'own' : 'opponent'} ${option ? 'selectable' : ''} ${chosen ? 'chosen' : ''} ${active && same(active, { controller: player, location, sequence }) ? 'active' : ''}`}
        data-zone-key={`${player}-${location}-${sequence}`}
        data-card-spot={card ? spot(card) : undefined}
        aria-label={`${player === seat ? '我方' : '对方'}${location === 4 ? '怪兽' : '魔法陷阱'}区 ${sequence + 1}${card?.code ? `，卡片 ${card.code}` : ''}`}
        onClick={(e) =>
          card
            ? activate({ ...card, controller: player, location, sequence }, e)
            : clickBlank(player, location, sequence)
        }
        onPointerEnter={() => {
          if (card?.code) setInspect(card.code);
        }}
      >
        {card ? (
          <>
            <div className="md-motion-card" data-motion-key={cardKey(card)}>
              <div
                className="md-card-rotation"
                style={{
                  transform: `rotate(${(player === seat ? 0 : 180) + (card.position & 12 ? -90 : 0)}deg)`,
                }}
              >
                <CardImage code={card.code} back={!card.code || !(card.position & 5)} />
              </div>
            </div>
            {location === 4 && !!(card.position & 5) && (
              <span className="md-atk">
                <b className={card.position & 12 ? 'muted-stat' : ''}>{stat(card.attack)}</b>
                <small className={card.position & 12 ? 'primary-stat' : ''}>
                  {card.link?.rating ? `LINK ${card.link.rating}` : stat(card.defense)}
                </small>
              </span>
            )}
            {!!card.overlayCards?.length && (
              <span className="md-materials">{card.overlayCards.length}</span>
            )}
          </>
        ) : (
          <span className="md-zone-corners">
            <small>{location === 4 ? (sequence > 4 ? 'EX' : 'M') : 'S/T'}</small>
          </span>
        )}
        {chosen && (
          <span className="md-selected-mark">
            <Check size={16} />
          </span>
        )}
        {usable && !option && <span className="md-action-dot" />}
      </button>
    );
  };
  const pile = (player: number, location: number, name: string) => {
    const cards = state.players[player].zones[location] || [],
      top = cards.filter(Boolean).at(-1),
      eligible = options.some((o) => o.controller === player && o.location === location);
    return (
      <button
        className={`md-pile ${player === seat ? 'own' : 'opponent'} ${eligible ? 'selectable' : ''}`}
        aria-label={`查看${player === seat ? '我方' : '对方'}${name}，${cards.filter(Boolean).length}张`}
        data-zone-key={`${player}-${location}`}
        onClick={() => {
          setBrowse({ player, location });
          setActive(null);
        }}
      >
        <span className="md-pile-card">
          {top ? (
            <div className="md-motion-card" data-motion-key={cardKey(top)}>
              <div
                className="md-card-rotation"
                style={{ transform: `rotate(${player === seat ? 0 : 180}deg)` }}
              >
                <CardImage
                  code={top.code}
                  back={location === 1 || !top.code || !!(top.position & 10)}
                />
              </div>
            </div>
          ) : (
            <Layers3 size={19} strokeWidth={1} />
          )}
        </span>
        <span>
          {name}
          <b>{cards.filter(Boolean).length}</b>
        </span>
      </button>
    );
  };
  const fieldSide = (player: number, opponent: boolean) => (
    <div className={`md-field-half ${opponent ? 'upper' : 'lower'}`}>
      <div className="md-five md-spells">
        {Array.from({ length: 5 }, (_, i) => (opponent ? 4 - i : i)).map((i) => tile(player, 8, i))}
      </div>
      <div className="md-five md-monsters">
        {Array.from({ length: 5 }, (_, i) => (opponent ? 4 - i : i)).map((i) => tile(player, 4, i))}
      </div>
      <div className="md-side md-deck">{pile(player, 1, '卡组')}</div>
      <div className="md-side md-extra">{pile(player, 64, '额外')}</div>
      <div className="md-side md-grave">{pile(player, 16, '墓地')}</div>
      <div className="md-side md-field-spell">{tile(player, 8, 5)}</div>
      <div className="md-side md-banished">{pile(player, 32, '除外')}</div>
    </div>
  );
  return (
    <div
      ref={root}
      className={`md-duel ${locked ? 'locked' : ''}`}
      onContextMenu={(e) => {
        e.preventDefault();
        back();
      }}
      onPointerDown={(e) => {
        if (e.button === 0) setHeld('all');
        if (e.button === 2) setHeld('off');
      }}
    >
      <aside className="md-inspector">
        <div className="md-system">
          <button
            className="icon-button"
            aria-label="对战菜单"
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <Menu size={20} />
          </button>
          <span>DRAGON</span>
          <button
            className="icon-button"
            aria-label="显示卡片信息"
            onClick={() => setShowInfo(true)}
          >
            <Info size={18} />
          </button>
        </div>
        <CardDetail code={inspect} />
        <div className="md-own-life">
          <PlayerLife name={label(seat)} lp={mine.lp} own motion={settings.motion} />
        </div>
      </aside>
      <main
        className="md-play-area"
        onClick={(e) => {
          if (e.target === e.currentTarget) setActive(null);
        }}
      >
        <header className="md-opponent-head">
          <span className="md-room-label">
            {room?.source || '自由对战'}
            {room?.mode === 'online' && ` · ${room.id}`}
          </span>
          <PlayerLife name={label(1 - seat)} lp={other.lp} own={false} motion={settings.motion} />
        </header>
        <div className="md-opponent-hand" aria-label={`对方手牌 ${other.zones[2]?.length || 0} 张`}>
          {other.zones[2]?.map((c, i) => (
            <span
              className="md-motion-card"
              data-motion-key={c ? cardKey(c) : `opp-${i}`}
              data-hand-player={1 - seat}
              key={c ? cardKey(c) : i}
            >
              <CardImage back />
            </span>
          ))}
        </div>
        <section className="md-table" aria-label="对战场地">
          <div className="md-mat-divider" />
          {fieldSide(1 - seat, true)}
          <div className="md-extra-row">
            {[5, 6].map((seq, i) => {
              const opposite = seq === 5 ? 6 : 5;
              const otherCard = other.zones[4]?.[opposite];
              const oppAvailable =
                prompt?.kind === 'zones' &&
                options.some((o) =>
                  same(o, { controller: 1 - seat, location: 4, sequence: opposite }),
                );
              return (
                <div className={`md-extra-slot extra-${i}`} key={seq}>
                  {otherCard || oppAvailable ? tile(1 - seat, 4, opposite) : tile(seat, 4, seq)}
                </div>
              );
            })}
          </div>
          {fieldSide(seat, false)}
          <span className="md-mat-sign">D</span>
          <AttackLine root={root} motion={motion} seat={seat} />
        </section>
        <div className="md-hand" aria-label="我方手牌">
          {mine.zones[2]?.map(
            (card, i) =>
              card && (
                <button
                  className={`md-hand-card ${options.some((o) => same(o, card)) ? 'actionable' : ''} ${active && same(active, card) ? 'active' : ''} ${selectedOptions.some((o) => same(o, card)) ? 'chosen' : ''}`}
                  key={cardKey(card)}
                  aria-label={`手牌 ${card.code || i}`}
                  title={card.code ? `卡片 ${card.code}` : '未知卡片'}
                  onClick={(e) => activate(card, e)}
                  onPointerEnter={() => {
                    if (card.code) setInspect(card.code);
                  }}
                >
                  <span
                    className="md-motion-card"
                    data-motion-key={cardKey(card)}
                    data-hand-player={seat}
                  >
                    <CardImage code={card.code} />
                  </span>
                  {selectedOptions.some((o) => same(o, card)) && (
                    <span className="md-selected-mark">
                      <Check size={16} />
                    </span>
                  )}
                </button>
              ),
          )}
        </div>
        <div className="md-status-line" role="status">
          {fatal ? (
            <span className="danger-text">{fatal}</span>
          ) : !connected ? (
            '连接已断开，正在恢复'
          ) : animating ? (
            <>
              <LoaderCircle size={13} className="spin" />
              效果处理中
            </>
          ) : (
            prompt?.title || (!state.turn ? '正在邀请 AI 对手' : '等待对方操作')
          )}
        </div>
        <div className="md-bottom-tools">
          <button className="icon-button" aria-label="卡片详情" onClick={() => setShowInfo(true)}>
            <Info size={20} />
          </button>
          <button
            className={`icon-button ${logOpen ? 'active' : ''}`}
            aria-label="决斗记录"
            onClick={() => setLogOpen(!logOpen)}
          >
            <List size={20} />
          </button>
          <div className="md-chain-switch" role="group" aria-label="连锁询问">
            {[
              ['off', '跳过'],
              ['auto', '自动'],
              ['all', '全时点'],
            ].map(([id, text]) => (
              <button
                key={id}
                className={effectiveChain === id ? 'active' : ''}
                aria-pressed={effectiveChain === id}
                onClick={() => onSettings({ ...settings, chain: id as Settings['chain'] })}
                title="按住左键临时全时点，按住右键临时跳过"
              >
                {text}
              </button>
            ))}
          </div>
        </div>
        <button
          className={`md-phase-wheel ${state.turnPlayer === seat ? 'own-turn' : ''}`}
          aria-label="切换阶段"
          disabled={!phaseActions.length || locked}
          onClick={() => {
            setPhaseOpen(!phaseOpen);
            setActive(null);
          }}
        >
          <span>TURN {state.turn}</span>
          <b>{phases[state.phase] || '准备中'}</b>
          <ChevronRightSmall />
        </button>
        {phaseOpen && (
          <div className="md-phase-menu">
            <div>
              <h3>{phaseConfirm ? '确认结束回合？' : '切换阶段'}</h3>
              <button
                className="icon-button"
                aria-label="关闭阶段菜单"
                onClick={() => {
                  setPhaseOpen(false);
                  setPhaseConfirm(null);
                }}
              >
                <X size={15} />
              </button>
            </div>
            {phaseConfirm ? (
              <div className="button-group">
                <button className="button secondary" onClick={() => setPhaseConfirm(null)}>
                  返回
                </button>
                <button
                  className="button primary"
                  onClick={() => respond({ ids: [phaseConfirm.id] })}
                >
                  结束回合
                  <Check size={15} />
                </button>
              </div>
            ) : (
              phaseActions.map((o) => (
                <button
                  key={o.id}
                  onClick={() =>
                    o.phase === 'end' && settings.confirmEnd
                      ? setPhaseConfirm(o)
                      : respond({ ids: [o.id] })
                  }
                >
                  {o.label}
                  <ArrowRight size={16} />
                </button>
              ))
            )}
          </div>
        )}
        {motion?.type === 'turn' && (
          <div className="md-turn-cue" key={`${state.turn}-${state.turnPlayer}`}>
            {state.turnPlayer === seat ? '你的回合' : '对方回合'}
          </div>
        )}
        {motion?.type === 'chain' && (
          <div className="md-chain-cue" key={`chain-${motion.index}`}>
            <span>连锁 {motion.index}</span>
            <CardName code={motion.code} />
          </div>
        )}
        {state.chain.length > 0 && (
          <div className="md-chain-stack">
            {state.chain.map((c) => (
              <div key={c.index}>
                <span>{c.index}</span>
                <CardName code={c.code} />
              </div>
            ))}
          </div>
        )}
        {browse && (
          <div className="md-browser">
            <div className="md-drawer-heading">
              <h3>
                {browse.player === seat ? '我方' : '对方'} · {locationLabel[browse.location]}
              </h3>
              <button
                className="icon-button"
                aria-label="关闭区域列表"
                onClick={() => setBrowse(null)}
              >
                <X size={17} />
              </button>
            </div>
            <div className="md-browse-cards">
              {state.players[browse.player].zones[browse.location]
                ?.filter((c): c is FieldCard => !!c)
                .map((c, i) => (
                  <button
                    key={cardKey(c)}
                    className={`${options.some((o) => same(o, c)) ? 'eligible' : ''} ${selectedOptions.some((o) => same(o, c)) ? 'selected' : ''}`}
                    onClick={(e) => activate(c, e)}
                    onPointerEnter={() => {
                      if (c.code) setInspect(c.code);
                    }}
                  >
                    <CardImage code={c.code} back={!c.code} />
                    <small>{c.code ? <CardName code={c.code} /> : '未知卡片'}</small>
                  </button>
                ))}
            </div>
            {!state.players[browse.player].zones[browse.location]?.length && (
              <p className="muted">这个区域没有卡片</p>
            )}
          </div>
        )}
        {prompt && prompt.kind !== 'actions' && !state.ended && (
          <Selection
            prompt={prompt}
            seat={seat}
            selected={selected}
            choose={choose}
            reset={resetSelection}
            cancel={cancel}
            respond={respond}
            locked={locked}
            canConfirm={canConfirm}
            count={selectCount}
            collapsed={collapsed}
            onCollapse={() => setCollapsed(!collapsed)}
            inspect={setInspect}
          />
        )}
        {logOpen && (
          <aside className="md-log">
            <div className="md-drawer-heading">
              <h3>决斗记录</h3>
              <button
                className="icon-button"
                aria-label="关闭记录"
                onClick={() => setLogOpen(false)}
              >
                <X size={17} />
              </button>
            </div>
            <div>
              {events.map((e) => (
                <EventLine key={e.id} event={e} seat={seat} />
              ))}
            </div>
          </aside>
        )}
        {fatal && (
          <div className="md-fatal">
            <p>{fatal}</p>
            <button className="button secondary" onClick={() => send({ type: 'leave' })}>
              返回单人界面
            </button>
          </div>
        )}
      </main>
      {actions.length > 0 && (
        <div
          className="md-actions"
          style={{
            left: `clamp(12px, ${anchor.x - actions.length * 34}px, calc(100vw - ${actions.length * 68 + 12}px))`,
            top: Math.max(65, anchor.y - 92),
          }}
        >
          {actions.map((o) => (
            <button key={o.id} disabled={locked} onClick={() => respond({ ids: [o.id] })}>
              <span>
                <ActionIcon action={o.action} />
              </span>
              <b>{o.label}</b>
            </button>
          ))}
        </div>
      )}
      {menuOpen && (
        <div className="md-menu">
          <div className="md-drawer-heading">
            <h3>对战菜单</h3>
            <button
              className="icon-button"
              aria-label="关闭对战菜单"
              onClick={() => setMenuOpen(false)}
            >
              <X size={17} />
            </button>
          </div>
          <a href={room?.mode === 'online' ? '#online' : '#solo'}>
            <ArrowLeft size={17} />
            暂时返回大厅
          </a>
          <button
            onClick={() => {
              setMenuOpen(false);
              setShowInfo(true);
            }}
          >
            <Info size={17} />
            查看卡片
          </button>
          <button
            onClick={() => {
              if (!state.ended && !confirmLeave) {
                setConfirmLeave(true);
                return;
              }
              setMenuOpen(false);
              send({ type: 'leave' });
            }}
            className="danger-text"
          >
            <Flag size={17} />
            {state.ended ? '离开对战' : confirmLeave ? '确认认输并离开' : '认输并离开'}
          </button>
        </div>
      )}
      {showInfo && (
        <Modal title="卡片详情" className="info-modal" onClose={() => setShowInfo(false)}>
          <CardDetail code={inspect} />
        </Modal>
      )}
      {state.ended && (
        <div className="md-result">
          <span>对战结束</span>
          <h2>{state.winner === null ? '平局' : state.winner === seat ? '胜利' : '败北'}</h2>
          <button className="button primary" onClick={() => send({ type: 'leave' })}>
            返回大厅
            <ArrowRight size={17} />
          </button>
          <button className="text-button" onClick={() => setLogOpen(!logOpen)}>
            查看记录
          </button>
        </div>
      )}
    </div>
  );
}
function ActionIcon({ action }: { action?: number }) {
  return action === 10 ? (
    <Swords size={24} />
  ) : action === 5 ? (
    <Sparkles size={24} />
  ) : action === 3 || action === 4 ? (
    <Layers3 size={24} />
  ) : action === 2 ? (
    <RotateCcw size={24} />
  ) : (
    <ArrowUpIcon />
  );
}
function ArrowUpIcon() {
  return <ArrowRight size={25} style={{ transform: 'rotate(-90deg)' }} />;
}
function ChevronRightSmall() {
  return <ArrowRight size={15} />;
}
function CardName({ code }: { code?: number }) {
  const card = useCard(code);
  return <>{card?.name || `卡片 ${code || ''}`}</>;
}
function stat(n?: number) {
  return n === undefined || n < 0 || n > 2147483647 ? '?' : n;
}
function PlayerLife({
  name,
  lp,
  own,
  motion,
}: {
  name: string;
  lp: number;
  own: boolean;
  motion: Settings['motion'];
}) {
  const [value, setValue] = useState(lp),
    valueRef = useRef(lp);
  useEffect(() => {
    if (motion === 'none' || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setValue(lp);
      valueRef.current = lp;
      return;
    }
    const before = valueRef.current,
      start = performance.now();
    let request = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (motion === 'quick' ? 140 : 320));
      const next = Math.round(before + (lp - before) * (1 - (1 - t) ** 3));
      setValue(next);
      valueRef.current = next;
      if (t < 1) request = requestAnimationFrame(tick);
    };
    request = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(request);
  }, [lp, motion]);
  return (
    <div className={`md-player-life ${own ? 'own' : 'opponent'}`}>
      <span className="md-player-initial">{name.slice(0, 1)}</span>
      <div>
        <strong>{name}</strong>
        <span className="md-life-value">
          <small>LP</small>
          {value.toLocaleString()}
        </span>
      </div>
      <span className="md-life-rule" />
    </div>
  );
}
function AttackLine({
  root,
  motion,
  seat,
}: {
  root: React.RefObject<HTMLElement | null>;
  motion: Motion | null;
  seat: number;
}) {
  const [line, setLine] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    w: number;
    h: number;
  } | null>(null);
  useEffect(() => {
    if (motion?.type !== 'attack' || !motion.from) {
      setLine(null);
      return;
    }
    const table = root.current?.querySelector('.md-table'),
      from = root.current?.querySelector(`[data-zone-key="${spot(motion.from)}"]`),
      to = motion.to?.location
        ? root.current?.querySelector(`[data-zone-key="${spot(motion.to)}"]`)
        : root.current?.querySelector(
            motion.from.controller === seat
              ? '.md-opponent-head .md-player-life'
              : '.md-own-life .md-player-life',
          );
    if (!table || !from || !to) return;
    const t = table.getBoundingClientRect(),
      a = from.getBoundingClientRect(),
      b = to.getBoundingClientRect();
    setLine({
      x1: a.left + a.width / 2 - t.left,
      y1: a.top + a.height / 2 - t.top,
      x2: b.left + b.width / 2 - t.left,
      y2: b.top + b.height / 2 - t.top,
      w: t.width,
      h: t.height,
    });
  }, [motion]);
  return line ? (
    <svg className="md-attack-line" viewBox={`0 0 ${line.w} ${line.h}`} aria-hidden="true">
      <defs>
        <marker id="attack-tip" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
          <path d="M0 0 L5 2.5 L0 5" fill="none" stroke="currentColor" />
        </marker>
      </defs>
      <path d={`M${line.x1},${line.y1} L${line.x2},${line.y2}`} markerEnd="url(#attack-tip)" />
    </svg>
  ) : null;
}
function Selection({
  prompt: p,
  seat,
  selected,
  choose,
  reset,
  cancel,
  respond,
  locked,
  canConfirm,
  count,
  collapsed,
  onCollapse,
  inspect,
}: {
  prompt: Prompt;
  seat: number;
  selected: string[];
  choose: (o: Option) => void;
  reset: () => void;
  cancel: () => void;
  respond: (i: Omit<ResponseInput, 'promptId'>) => void;
  locked: boolean;
  canConfirm: boolean;
  count: number;
  collapsed: boolean;
  onCollapse: () => void;
  inspect: (code: number) => void;
}) {
  const [search, setSearch] = useState(''),
    [counts, setCounts] = useState<number[]>([]);
  const incremental = p.kind === 'unselect';
  useEffect(() => {
    setCounts(p.options.map(() => 0));
    if (p.kind !== 'unselect') setSearch('');
  }, [p.id]);
  const visible = p.options
    .filter((o) =>
      `${o.label} ${o.code || ''} ${o.description || ''}`
        .toLowerCase()
        .includes(search.toLowerCase()),
    )
    .slice(0, 160);
  const footer = (
    <div className="md-selection-footer">
      <div>
        {(p.canCancel || (incremental && (count > 0 || p.options.some((o) => o.selected)))) && (
          <button className="button secondary" disabled={locked} onClick={cancel}>
            {p.kind === 'chain' ? '不连锁' : '取消'}
          </button>
        )}
        <button
          className="text-button"
          onClick={() => {
            reset();
            setCounts(p.options.map(() => 0));
          }}
          disabled={locked}
        >
          <RotateCcw size={14} />
          重选
        </button>
      </div>
      <span>
        {incremental
          ? `已选 ${count} 张`
          : `${count} / ${p.min === p.max ? p.max : `${p.min}–${p.max}`}`}
      </span>
      <button
        className="button primary"
        disabled={
          locked ||
          (p.kind === 'counter' ? counts.reduce((a, b) => a + b, 0) !== p.amount : !canConfirm)
        }
        onClick={() =>
          respond(
            incremental
              ? { materialIds: selected }
              : p.kind === 'counter'
                ? { counts }
                : { ids: selected },
          )
        }
      >
        {locked ? <LoaderCircle size={16} className="spin" /> : <Check size={16} />}确认
        {incremental ? '素材' : ''}
      </button>
    </div>
  );
  if (p.kind === 'zones')
    return (
      <div className="md-zone-prompt">
        <div>
          <h3>{p.title}</h3>
          <p>点击场上高亮的区域</p>
        </div>
        {footer}
      </div>
    );
  if (p.kind === 'yesno')
    return (
      <div className="md-effect-question" role="dialog" aria-label={p.title}>
        <h3>{p.title}</h3>
        <div>
          <button
            className="button secondary"
            disabled={locked}
            onClick={() => respond({ ids: [p.options[1].id] })}
          >
            否
          </button>
          <button
            className="button primary"
            disabled={locked}
            onClick={() => respond({ ids: [p.options[0].id] })}
          >
            是<Check size={16} />
          </button>
        </div>
      </div>
    );
  const buckets = new Map<string, Option[]>();
  for (const o of visible) {
    const key = o.location
      ? `${o.controller === seat ? '我方' : '对方'} · ${locationLabel[o.location] || '卡片'}`
      : '';
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(o);
  }
  return (
    <section
      className={`md-selection ${p.kind === 'chain' && p.options.length <= 2 ? 'compact' : ''} ${collapsed ? 'collapsed' : ''}`}
      style={
        {
          '--selection-width': `${Math.min(920, Math.max(500, p.options.length * 112 + 42))}px`,
        } as React.CSSProperties
      }
      role="dialog"
      aria-label={p.title}
    >
      <div className="md-drawer-heading">
        <h3>
          {p.title}
          {p.kind === 'sum' && <small>数值 {p.amount}</small>}
        </h3>
        <button
          className="icon-button"
          aria-label={collapsed ? '展开候选卡片' : '收起候选卡片'}
          onClick={onCollapse}
        >
          {collapsed ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      </div>
      {!collapsed && (
        <>
          {p.kind === 'announce' && (
            <label className="search-input">
              <Search size={17} />
              <input
                aria-label="搜索宣言卡片"
                placeholder="搜索卡名或密码"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          )}
          {!!p.mandatory?.length && (
            <p className="md-mandatory">
              必选：
              {p.mandatory.map((o, i) => (
                <span key={i}>
                  「<CardName code={o.code} />」
                </span>
              ))}
            </p>
          )}
          <div
            className={`md-candidates ${visible.some((o) => o.code) ? 'has-cards' : 'text-only'}`}
            onWheel={(e) => {
              const el = e.currentTarget;
              if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && el.scrollWidth > el.clientWidth + 2) {
                el.scrollLeft += e.deltaY;
              }
            }}
          >
            {[...buckets].map(([title, items]) => (
              <div className="md-candidate-group" key={title}>
                {title && <h4>{title}</h4>}
                <div>
                  {items.map((o) => {
                    const chosen = incremental
                      ? !!o.selected !== selected.includes(o.id)
                      : selected.includes(o.id);
                    return p.kind === 'counter' ? (
                      <div className="md-counter" key={optionKey(o)}>
                        <CardImage code={o.code} />
                        <label>
                          <CardName code={o.code} />
                          <input
                            type="number"
                            min={0}
                            max={o.capacity}
                            value={counts[Number(o.id)] || 0}
                            onChange={(e) =>
                              setCounts((old) =>
                                p.options.map((x, i) =>
                                  i === Number(o.id)
                                    ? Math.max(0, Math.min(o.capacity || 0, Number(e.target.value)))
                                    : old[i] || 0,
                                ),
                              )
                            }
                          />
                        </label>
                      </div>
                    ) : (
                      <button
                        className={`md-candidate ${o.controller === seat || o.controller === undefined ? 'own' : 'opponent'} ${chosen ? 'selected' : ''} ${o.code ? 'with-card' : ''}`}
                        key={optionKey(o)}
                        disabled={locked}
                        onClick={() => choose(o)}
                        onPointerEnter={() => {
                          if (o.code) inspect(o.code);
                        }}
                      >
                        {o.code && <CardImage code={o.code} />}
                        <span className="md-candidate-label">
                          {p.kind === 'chain' ? (
                            <>
                              <CardName code={o.code} />
                              {o.description && <small>{o.description}</small>}
                            </>
                          ) : (
                            o.label
                          )}
                        </span>
                        {chosen && (
                          <span className="md-selected-mark">
                            {p.kind === 'sort' ? selected.indexOf(o.id) + 1 : <Check size={15} />}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
      {footer}
    </section>
  );
}
function EventLine({ event: e, seat }: { event: GameEvent; seat: number }) {
  const player = e.player === seat ? '我方' : '对方';
  let text: React.ReactNode = '';
  if (e.type === 'turn') text = `${player}回合 · ${e.turn}`;
  if (e.type === 'phase') text = `${phases[e.phase || 0] || '阶段切换'}`;
  if (e.type === 'draw') text = `${player}抽 ${e.count} 张卡`;
  if (e.type === 'summon')
    text = (
      <>
        {player}召唤「
        <CardName code={e.code} />」
      </>
    );
  if (e.type === 'damage') text = `${player} LP −${e.amount}`;
  if (e.type === 'recover') text = `${player} LP +${e.amount}`;
  if (e.type === 'chain')
    text = (
      <>
        连锁「
        <CardName code={e.code} />」
      </>
    );
  if (e.type === 'win') text = e.winner === seat ? '我方胜利' : '对战结束';
  if (e.type === 'server') text = e.text;
  if (e.type === 'attack') text = '宣言攻击';
  if (e.type === 'reveal')
    text = (
      <>
        展示{' '}
        {e.cards?.map((c, i) => (
          <span key={i}>
            「<CardName code={c.code} />」
          </span>
        ))}
      </>
    );
  return text ? (
    <div className={`md-event ${e.type}`}>
      <p>{text}</p>
    </div>
  ) : null;
}
