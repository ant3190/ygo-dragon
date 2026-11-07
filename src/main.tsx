import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  CircleHelp,
  Layers3,
  LoaderCircle,
  Settings2,
  Swords,
  Users,
  WifiOff,
  X,
} from 'lucide-react';
import { api } from './lib';
import { CardImage, Modal } from './components';
import { Decks } from './pages/Decks';
import { Play } from './pages/Play';
import { SettingsPage } from './pages/Settings';
import { Duel } from './pages/Duel';
import { Opening } from './duel/Opening';
import { useDuelPlayback } from './duel/playback';
import { useHash } from './lib';
import type { Deck, GameEvent, ResourceStatus, Room, Settings } from './types';
import './styles.css';
import './duel/duel.css';
import './duel/field.css';
import './duel/effects.css';

const defaults: Settings = {
  name: '决斗者',
  motion: 'normal',
  accent: 'blue',
  confirmEnd: true,
  chain: 'auto',
};
function savedSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem('dragon-settings') || '{}');
    if ((saved.interfaceVersion || 0) < 3 && saved.accent === 'amber') saved.accent = 'blue';
    return { ...defaults, ...saved };
  } catch {
    return defaults;
  }
}
const navigation = [
  { id: 'home', label: '大厅' },
  { id: 'decks', label: '卡组' },
  { id: 'solo', label: '单人' },
  { id: 'online', label: '联机' },
];
export type Send = (message: Record<string, unknown>) => void;
function App() {
  const route = useHash(),
    [settings, setSettings] = useState(savedSettings),
    [decks, setDecks] = useState<Deck[]>([]),
    [resources, setResources] = useState<ResourceStatus>({
      phase: 'loading',
      ready: false,
      cards: 0,
      images: 0,
      done: 0,
      total: 0,
      errors: [],
    });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [connected, setConnected] = useState(false),
    [room, setRoom] = useState<Room | null>(null),
    [roomSeat, setRoomSeat] = useState(0),
    [events, setEvents] = useState<GameEvent[]>([]),
    [toast, setToast] = useState(''),
    [help, setHelp] = useState(false),
    [fatal, setFatal] = useState(''),
    [inputEpoch, setInputEpoch] = useState(0);
  const socket = useRef<WebSocket | null>(null),
    playback = useDuelPlayback(settings.motion),
    receiver = useRef(playback);
  receiver.current = playback;
  const notify = (text: string) => setToast(text);
  const refresh = async () => {
    try {
      const data = await api('/bootstrap');
      setDecks(data.decks);
      setResources(data.resources);
      setRoom(data.room);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  useEffect(() => {
    if (resources.ready && !decks.length) void refresh();
  }, [resources.ready]);
  useEffect(() => {
    document.documentElement.dataset.accent = settings.accent;
    document.documentElement.dataset.motion = settings.motion;
    try {
      localStorage.setItem('dragon-settings', JSON.stringify({ ...settings, interfaceVersion: 3 }));
    } catch {}
  }, [settings]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (loading || error) return;
    let disposed = false,
      retry: ReturnType<typeof setTimeout>,
      attempts = 0;
    function connect() {
      const ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/socket`,
      );
      socket.current = ws;
      ws.onopen = () => {
        attempts = 0;
        setConnected(true);
      };
      ws.onclose = () => {
        setConnected(false);
        if (!disposed) retry = setTimeout(connect, Math.min(15000, 800 * 2 ** attempts++));
      };
      ws.onmessage = (event) => {
        try {
          const m = JSON.parse(event.data);
          if (m.type === 'room') {
            setRoom(m.room);
            setRoomSeat(m.seat);
          }
          if (m.type === 'frame' || m.type === 'view') {
            const entering = !receiver.current.game;
            receiver.current.receive(m);
            if (entering) location.hash = 'duel';
          }
          if (m.type === 'event') setEvents((old) => [...old, m.event].slice(-160));
          if (m.type === 'history') setEvents(m.events);
          if (m.type === 'left') {
            receiver.current.reset();
            setRoom(null);
            setEvents([]);
            setFatal('');
            location.hash = 'home';
          }
          if (m.type === 'resources') setResources(m.status);
          if (m.type === 'error') {
            setInputEpoch((n) => n + 1);
            notify(m.message);
          }
          if (m.type === 'fatal') {
            setFatal(m.message);
            notify(m.message);
          }
        } catch {}
      };
    }
    connect();
    return () => {
      disposed = true;
      clearTimeout(retry);
      socket.current?.close();
    };
  }, [loading, error]);
  const send: Send = (message) => {
    if (socket.current?.readyState !== WebSocket.OPEN) {
      notify('正在恢复连接，请稍后重试');
      return;
    }
    if (message.type === 'solo' || message.type === 'practice') {
      setFatal('');
      setEvents([]);
    }
    socket.current.send(JSON.stringify({ ...message, name: settings.name }));
  };
  const inDuel = route === 'duel' && !!playback.game;
  return (
    <div className={`application ${inDuel ? 'playing' : ''}`}>
      {!inDuel && (
        <header className="appbar">
          <a href="#home" className="brand">
            <img src="/dragon.svg" alt="" />
            <span>DRAGON</span>
          </a>
          <nav aria-label="主导航">
            {navigation.map((item) => (
              <a
                key={item.id}
                className={route === item.id ? 'current' : ''}
                href={`#${item.id}`}
                aria-current={route === item.id ? 'page' : undefined}
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="appbar-tools">
            <span className="service-state">
              <i className={connected ? 'connected' : ''} />
              {connected ? '已连接' : '连接中'}
            </span>
            <button className="icon-button" aria-label="操作帮助" onClick={() => setHelp(true)}>
              <CircleHelp size={18} />
            </button>
            <a className="icon-button" aria-label="设置" href="#settings">
              <Settings2 size={19} />
            </a>
          </div>
        </header>
      )}
      {loading ? (
        <div className="loading-page">
          <LoaderCircle className="spin" />
          <p>正在连接本地服务</p>
        </div>
      ) : error ? (
        <div className="loading-page">
          <WifiOff />
          <h2>无法连接本地服务</h2>
          <p>{error}</p>
          <button
            className="button primary"
            onClick={() => {
              setLoading(true);
              void refresh();
            }}
          >
            重新连接
          </button>
        </div>
      ) : inDuel && playback.game?.opening ? (
        <Opening
          opening={playback.game.opening}
          prompt={playback.prompt}
          room={room}
          name={settings.name}
          connected={connected}
          send={send}
          fatal={fatal}
          inputEpoch={inputEpoch}
        />
      ) : inDuel ? (
        <Duel
          state={playback.game!}
          prompt={playback.prompt}
          motion={playback.motion}
          animating={playback.busy}
          room={room}
          seat={playback.seat}
          events={events}
          connected={connected}
          settings={settings}
          onSettings={setSettings}
          send={send}
          notify={notify}
          fatal={fatal}
          inputEpoch={inputEpoch}
        />
      ) : (
        <main className={`page page-${route}`}>
          {route === 'decks' ? (
            <Decks decks={decks} refresh={refresh} notify={notify} ready={resources.ready} />
          ) : route === 'solo' || route === 'online' ? (
            <Play
              mode={route}
              decks={decks}
              room={room}
              connected={connected}
              ready={resources.ready}
              seat={roomSeat}
              send={send}
              notify={notify}
            />
          ) : route === 'settings' ? (
            <SettingsPage
              settings={settings}
              onChange={setSettings}
              resources={resources}
              decks={decks}
              notify={notify}
            />
          ) : (
            <Home
              decks={decks}
              ready={resources.ready}
              resume={!!playback.game || !!room}
              game={!!playback.game}
            />
          )}
        </main>
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button className="icon-button" aria-label="关闭提示" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {help && (
        <Modal title="操作说明" onClose={() => setHelp(false)}>
          <div className="help-content">
            <p>
              <b>左键</b>
              ：点击卡片显示行动；选择对象或素材时可直接点场上的高亮卡片。再次点击已选卡片撤回选择，最后按「确认」。
            </p>
            <p>
              <b>右键 / Esc</b>
              ：先关闭当前卡片菜单或浏览列表，再撤回最近一次选择。没有已选项目时，取消规则允许取消的操作。
            </p>
            <p>
              <b>阶段与连锁</b>：点击右下阶段按钮选择下一阶段。连锁开关为「自动 / 全时点 /
              跳过」；按住左键临时全时点，按住右键临时跳过。
            </p>
            <p>
              <b>卡组编辑</b>：双击或点击加号添加；右键移除；支持拖放和 YDK 导入导出。
            </p>
            <p>
              <b>单人对战</b>：选择 WindBot
              对手和自己的卡组后开始。浏览器断线后，本机服务会保留与对战服务器的连接。
            </p>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Home({
  decks,
  ready,
  resume,
  game,
}: {
  decks: Deck[];
  ready: boolean;
  resume: boolean;
  game: boolean;
}) {
  const [chosen, setChosen] = useState(() => localStorage.getItem('dragon-active-deck') || '');
  const deck = decks.find((d) => d.id === chosen) || decks[0];
  const select = (id: string) => {
    setChosen(id);
    localStorage.setItem('dragon-active-deck', id);
  };
  return (
    <div className="game-lobby">
      <div className="lobby-title">
        <div>
          <h1>决斗</h1>
        </div>
        <span>Master Rule 5</span>
      </div>
      {resume && (
        <a className="resume-line" href={game ? '#duel' : '#online'}>
          <Swords size={18} />
          返回当前对局
          <ArrowRight size={17} />
        </a>
      )}
      <div className="lobby-main">
        <section className="equipped-deck">
          <div className="equipped-heading">
            <span>出战卡组</span>
            <a className="text-button" href="#decks">
              编辑
              <ChevronRight size={16} />
            </a>
          </div>
          <div className="equipped-content">
            <div className="equipped-cover">
              <CardImage code={deck?.cover || deck?.main[0]} eager />
            </div>
            <div className="equipped-info">
              <h2>{deck?.name || '还没有卡组'}</h2>
              <div className="deck-composition">
                <span>
                  主卡组 <b>{deck?.main.length || 0}</b>
                </span>
                <span>
                  额外 <b>{deck?.extra.length || 0}</b>
                </span>
                <span>
                  副卡组 <b>{deck?.side.length || 0}</b>
                </span>
              </div>
              <label className="lobby-deck-select">
                切换卡组
                <select value={deck?.id || ''} onChange={(e) => select(e.target.value)}>
                  {decks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <span className={`deck-readiness ${ready ? 'is-ready' : ''}`}>
                <i />
                {ready ? '卡库已就绪' : '正在准备卡库'}
              </span>
            </div>
          </div>
        </section>
        <section className="duel-destinations" aria-label="选择对战方式">
          <a className="destination primary-destination" href="#solo">
            <span className="destination-number">01</span>
            <div>
              <h2>单人对战</h2>
              <p>选择 AI 对手</p>
            </div>
            <Swords className="destination-icon" size={34} strokeWidth={1} />
            <ArrowRight size={21} />
          </a>
          <a className="destination" href="#online">
            <span className="destination-number">02</span>
            <div>
              <h2>联机对战</h2>
              <p>创建或加入房间</p>
            </div>
            <Users className="destination-icon" size={31} strokeWidth={1} />
            <ArrowRight size={21} />
          </a>
          <a className="destination compact-destination" href="#decks">
            <Layers3 size={20} />
            <h3>卡组管理</h3>
            <span>{decks.length} 副卡组</span>
            <ChevronRight size={18} />
          </a>
        </section>
      </div>
      <section className="recent-decks">
        <div className="section-heading">
          <h2>卡组</h2>
          <a className="text-button" href="#decks">
            全部
            <ChevronRight size={15} />
          </a>
        </div>
        <div className="deck-shortcuts">
          {decks.slice(0, 5).map((d) => (
            <button
              className={d.id === deck?.id ? 'selected' : ''}
              key={d.id}
              onClick={() => select(d.id)}
            >
              <div>
                <CardImage code={d.cover || d.main[0]} />
              </div>
              <span>
                {d.name}
                <small>
                  {d.main.length} / {d.extra.length}
                </small>
              </span>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
      </section>
      <footer className="lobby-foot">
        <span>YGO Dragon</span>
        <button
          className="text-button"
          onClick={() => {
            location.hash = 'settings';
          }}
        >
          资源与设置
          <Settings2 size={14} />
        </button>
      </footer>
    </div>
  );
}
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="loading-page">
        <h1>界面出现问题</h1>
        <p>{this.state.error}</p>
        <button className="button primary" onClick={() => location.reload()}>
          重新加载
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
